import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	getCurrentWeekStart,
	formatWeekRange,
	formatDayLabel,
	MEAL_TYPE_LABELS,
	type MealType,
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
					<div className="space-y-4">
						<p className="text-muted-foreground text-sm">
							{prepItems.length} shared ingredient
							{prepItems.length !== 1 ? 's' : ''} to prep ahead of time
						</p>
						{prepItems.map((item) => (
							<PrepItemCard key={item.canonicalName} item={item} />
						))}
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
	const [expanded, setExpanded] = useState(false)

	const quantityLabel = [item.totalQuantity, item.totalUnit]
		.filter(Boolean)
		.join(' ')

	return (
		<div
			className={`bg-card rounded-lg border p-4 transition-opacity ${prepped ? 'opacity-50' : ''}`}
		>
			<div className="flex items-start gap-3">
				{/* Checkbox */}
				<button
					type="button"
					aria-label={`Mark ${item.ingredientName} as prepped`}
					onClick={() => setPrepped(!prepped)}
					className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border ${
						prepped
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-input'
					}`}
				>
					{prepped && <Icon name="check" size="xs" />}
				</button>

				<div className="flex-1">
					{/* Header */}
					<div className="flex items-baseline justify-between gap-2">
						<h3
							className={`font-medium ${prepped ? 'line-through' : ''}`}
						>
							{item.ingredientName}
						</h3>
						{quantityLabel && (
							<span className="text-muted-foreground shrink-0 text-sm">
								{quantityLabel}
							</span>
						)}
					</div>

					{/* Usage summary */}
					<p className="text-muted-foreground mt-1 text-sm">
						Used in {item.usedIn.length} meal
						{item.usedIn.length !== 1 ? 's' : ''}
					</p>

					{/* Expandable details */}
					<button
						type="button"
						onClick={() => setExpanded(!expanded)}
						className="text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1 text-xs print:hidden"
					>
						<Icon
							name="chevron-down"
							size="xs"
							className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
						/>
						{expanded ? 'Hide' : 'Show'} details
					</button>

					{/* Expanded recipe attributions */}
					{expanded && (
						<ul className="mt-2 space-y-1 print:hidden">
							{item.usedIn.map((usage, i) => {
								const dayLabel = formatDayLabel(new Date(usage.date))
								const mealLabel =
									MEAL_TYPE_LABELS[usage.mealType as MealType] ??
									usage.mealType
								const perRecipeQty = [usage.quantity, usage.unit]
									.filter(Boolean)
									.join(' ')

								return (
									<li
										key={i}
										className="text-muted-foreground flex items-baseline justify-between text-sm"
									>
										<span>
											{dayLabel} {mealLabel.toLowerCase()}:{' '}
											{usage.recipeTitle}
										</span>
										{perRecipeQty && (
											<span className="shrink-0 text-xs">
												{perRecipeQty}
											</span>
										)}
									</li>
								)
							})}
						</ul>
					)}

					{/* Print-only: always show details */}
					<ul className="mt-2 hidden space-y-1 print:block">
						{item.usedIn.map((usage, i) => {
							const dayLabel = formatDayLabel(new Date(usage.date))
							const mealLabel =
								MEAL_TYPE_LABELS[usage.mealType as MealType] ??
								usage.mealType
							const perRecipeQty = [usage.quantity, usage.unit]
								.filter(Boolean)
								.join(' ')

							return (
								<li
									key={i}
									className="text-muted-foreground flex items-baseline justify-between text-sm"
								>
									<span>
										{dayLabel} {mealLabel.toLowerCase()}:{' '}
										{usage.recipeTitle}
									</span>
									{perRecipeQty && (
										<span className="shrink-0 text-xs">{perRecipeQty}</span>
									)}
								</li>
							)
						})}
					</ul>
				</div>
			</div>
		</div>
	)
}
