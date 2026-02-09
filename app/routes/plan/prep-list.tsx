import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	getCurrentWeekStart,
	formatWeekRange,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { generatePrepList, type PrepItem } from '#app/utils/prep-list.server.ts'
import { type Route } from './+types/prep-list.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Prep List | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)

	const weekStart = getCurrentWeekStart()

	const mealPlan = await prisma.mealPlan.findFirst({
		where: { userId, weekStart },
		include: {
			entries: {
				include: {
					recipe: {
						include: { ingredients: true },
					},
				},
			},
		},
	})

	const hasMealPlan = mealPlan && mealPlan.entries.length > 0

	let prepItems: PrepItem[] = []
	if (hasMealPlan) {
		const entries = mealPlan.entries.map((entry) => ({
			recipe: entry.recipe,
			servings: entry.servings,
			date: new Date(entry.date),
			mealType: entry.mealType,
		}))
		prepItems = generatePrepList(entries)
	}

	return {
		prepItems,
		weekLabel: formatWeekRange(weekStart),
		hasMealPlan: !!hasMealPlan,
	}
}

export default function PrepListRoute({ loaderData }: Route.ComponentProps) {
	const { prepItems, weekLabel, hasMealPlan } = loaderData

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="bg-muted/30">
				<div className="container flex items-center gap-3 py-6">
					<Button asChild variant="ghost" size="icon" className="print:hidden">
						<Link to="/plan">
							<Icon name="arrow-left" size="sm" />
						</Link>
					</Button>
					<div className="flex-1">
						<h1 className="text-2xl font-bold">Prep List</h1>
						<p className="text-muted-foreground mt-1 text-sm">{weekLabel}</p>
					</div>
					<div className="flex gap-2 print:hidden">
						<Button asChild variant="ghost" size="sm">
							<Link to="/plan/shopping-list">
								<Icon name="file-text" size="sm" />
								Shopping List
							</Link>
						</Button>
						{prepItems.length > 0 && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => window.print()}
							>
								<Icon name="file-text" size="sm" />
								Print
							</Button>
						)}
					</div>
				</div>
			</div>

			<div className="container py-6">
				{prepItems.length > 0 ? (
					<div>
						<p className="text-muted-foreground mb-3 text-sm">
							{prepItems.length} ingredient
							{prepItems.length !== 1 ? 's' : ''} to prep
						</p>
						<div className="divide-y">
							{prepItems.map((item) => (
								<PrepItemCard key={item.canonicalName} item={item} />
							))}
						</div>
					</div>
				) : (
					<div className="rounded-lg border border-dashed p-8 text-center">
						<div className="bg-muted/50 mx-auto flex size-20 items-center justify-center rounded-full">
							<Icon
								name="file-text"
								className="text-muted-foreground size-10"
							/>
						</div>
						<h3 className="mt-4 font-semibold">No shared ingredients to prep</h3>
						<p className="text-muted-foreground mx-auto mt-2 max-w-sm text-sm">
							{hasMealPlan
								? 'Add 2+ recipes that share ingredients to your meal plan to generate a prep list.'
								: 'Create a meal plan first to see which ingredients you can prep ahead of time.'}
						</p>
					</div>
				)}
			</div>
		</div>
	)
}

function PrepItemCard({ item }: { item: PrepItem }) {
	const [prepped, setPrepped] = useState(false)

	const quantityLabel = [item.totalQuantity, item.totalUnit]
		.filter(Boolean)
		.join(' ')

	const recipeNames = [
		...new Set(item.usedIn.map((usage) => usage.recipeTitle)),
	]

	// Capitalize first letter for display
	const displayName =
		item.ingredientName.charAt(0).toUpperCase() +
		item.ingredientName.slice(1)

	// Show prep method breakdown when any usage has a non-"Whole" method
	const hasRealMethods = item.prepMethods.some((g) => g.method !== 'Whole')

	return (
		<div
			className={`py-3 transition-opacity ${prepped ? 'opacity-50' : ''}`}
		>
			<div className="flex items-start gap-3">
				{/* Checkbox */}
				<button
					type="button"
					aria-label={`Mark ${displayName} as prepped`}
					onClick={() => setPrepped(!prepped)}
					className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border print:hidden ${
						prepped
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-input'
					}`}
				>
					{prepped && <Icon name="check" size="xs" />}
				</button>

				<div className="min-w-0 flex-1">
					{/* Line 1: Ingredient name + quantity inline */}
					<p className="flex items-baseline gap-1">
						<span
							className={`font-medium ${prepped ? 'line-through' : ''}`}
						>
							{displayName}
						</span>
						{quantityLabel && (
							<>
								<span className="text-muted-foreground">·</span>
								<span
									className={`text-muted-foreground text-sm ${prepped ? 'line-through' : ''}`}
								>
									{quantityLabel}
								</span>
							</>
						)}
					</p>

					{/* Line 2+: Prep method breakdown or simple recipe list */}
					{hasRealMethods ? (
						<div className="text-muted-foreground text-sm">
							{item.prepMethods.map((group) => {
								const qty = [group.totalQuantity, group.totalUnit]
									.filter(Boolean)
									.join(' ')
								const label =
									group.method === 'Whole'
										? `${qty ? qty + ' ' : ''}whole`
										: `${group.method}${qty ? ' ' + qty : ''}`
								return (
									<p key={group.method}>
										{label} ({group.recipes.join(', ')})
									</p>
								)
							})}
						</div>
					) : (
						<p className="text-muted-foreground truncate text-sm">
							{recipeNames.join(', ')}
						</p>
					)}

					{/* Line 3: Storage tip */}
					{item.storageTip && (
						<p className="text-muted-foreground mt-0.5 text-xs italic">
							{item.storageTip}
						</p>
					)}
				</div>
			</div>
		</div>
	)
}
