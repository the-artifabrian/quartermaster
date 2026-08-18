import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link } from 'react-router'
import { RecipeThumb } from '#app/components/recipe-selector.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { formatScaleMultiplier } from '#app/utils/menu-validation.ts'
import { sectionLabelClass } from '#app/utils/misc.tsx'
import { type Route } from './+types/$menuId.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
	const title = loaderData?.menu?.title
		? `${loaderData.menu.title} | Quartermaster`
		: 'Menu | Quartermaster'
	return [{ title }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const { menuId } = params

	const menu = await prisma.menu.findUnique({
		where: { id: menuId },
		select: {
			id: true,
			title: true,
			description: true,
			defaultGuestCount: true,
			householdId: true,
			sections: {
				orderBy: { order: 'asc' },
				select: {
					id: true,
					name: true,
					items: {
						orderBy: { order: 'asc' },
						select: {
							id: true,
							kind: true,
							recipeTitle: true,
							scaleMultiplier: true,
							note: true,
							recipe: {
								select: {
									id: true,
									title: true,
									householdId: true,
									image: { select: { objectKey: true } },
								},
							},
							shoppingLines: {
								orderBy: { order: 'asc' },
								select: {
									id: true,
									name: true,
									quantity: true,
									unit: true,
								},
							},
						},
					},
				},
			},
		},
	})

	invariantResponse(menu, 'Menu not found', { status: 404 })
	invariantResponse(menu.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	return {
		menu: {
			...menu,
			sections: menu.sections.map((section) => ({
				...section,
				items: section.items.map((item) => {
					// A reference that no longer resolves to a household Recipe reads
					// as a clearly missing card with its frozen identity.
					const recipe =
						item.recipe && item.recipe.householdId === householdId
							? {
									id: item.recipe.id,
									title: item.recipe.title,
									image: item.recipe.image,
								}
							: null
					return {
						id: item.id,
						kind: item.kind,
						recipeTitle: item.recipeTitle,
						scaleMultiplier: item.scaleMultiplier,
						note: item.note,
						recipe,
						shoppingLines: item.shoppingLines,
					}
				}),
			})),
		},
	}
}

export default function MenuDetail({ loaderData }: Route.ComponentProps) {
	const { menu } = loaderData

	return (
		<div className="container max-w-2xl py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6">
			<Link
				to="/recipes/menus"
				viewTransition
				className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm transition-colors"
			>
				<Icon name="arrow-left" size="sm" />
				Menus
			</Link>

			<div className="flex items-start justify-between gap-3">
				<h1 className="font-serif text-2xl font-normal">{menu.title}</h1>
				<Button asChild variant="outline">
					<Link to={`/recipes/menus/${menu.id}/edit`}>
						<Icon name="pencil-1" size="sm" />
						Edit
					</Link>
				</Button>
			</div>

			{menu.defaultGuestCount ? (
				<p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
					<Icon name="avatar" size="xs" />
					Usually for {menu.defaultGuestCount} guests
				</p>
			) : null}

			{menu.description && (
				<p className="text-muted-foreground mt-3 leading-relaxed">
					{menu.description}
				</p>
			)}

			<div className="mt-8 space-y-8">
				{menu.sections
					// An empty unnamed section stays quietly out of the way once
					// named sections carry the menu.
					.filter(
						(section) =>
							section.name !== null ||
							section.items.length > 0 ||
							menu.sections.length === 1,
					)
					.map((section) => (
						<section key={section.id}>
							{/* The unnamed section stays headingless */}
							{section.name ? (
								<h2 className={`${sectionLabelClass} mb-3`}>{section.name}</h2>
							) : null}
							{section.items.length === 0 ? (
								section.name ? (
									<p className="text-muted-foreground text-sm">
										Nothing in this section yet.
									</p>
								) : (
									<p className="text-muted-foreground border-border/60 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm">
										Nothing on this menu yet.
									</p>
								)
							) : (
								<ul className="space-y-2">
									{section.items.map((item) =>
										item.kind === 'note' ? (
											<MenuNoteCard key={item.id} item={item} />
										) : (
											<MenuRecipeCard key={item.id} item={item} />
										),
									)}
								</ul>
							)}
						</section>
					))}
			</div>
		</div>
	)
}

type MenuDetailItem = {
	id: string
	kind: string
	recipeTitle: string | null
	scaleMultiplier: number | null
	note: string | null
	recipe: {
		id: string
		title: string
		image: { objectKey: string } | null
	} | null
	shoppingLines: Array<{
		id: string
		name: string
		quantity: string | null
		unit: string | null
	}>
}

/**
 * A flexible note card — drinks, shared prep, serving reminders — with its
 * ordinary Shopping lines listed underneath (#102).
 */
function MenuNoteCard({ item }: { item: MenuDetailItem }) {
	return (
		<li className="border-border/60 bg-card flex items-start gap-3 rounded-lg border p-3">
			<span className="bg-muted/70 flex size-9 shrink-0 items-center justify-center rounded-md">
				<Icon name="pencil-2" className="text-muted-foreground size-4" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="min-w-0 text-[15px] leading-relaxed break-words whitespace-pre-wrap">
					{item.note}
				</p>
				{item.shoppingLines.length > 0 ? (
					<ul className="mt-2 space-y-1">
						{item.shoppingLines.map((line) => (
							<li
								key={line.id}
								className="text-muted-foreground flex items-baseline gap-1.5 text-sm"
							>
								<Icon name="cart" size="xs" className="translate-y-px" />
								<span className="min-w-0 break-words">{line.name}</span>
								{line.quantity || line.unit ? (
									<span className="shrink-0 tabular-nums">
										{[line.quantity, line.unit].filter(Boolean).join(' ')}
									</span>
								) : null}
							</li>
						))}
					</ul>
				) : null}
			</div>
		</li>
	)
}

function MenuRecipeCard({ item }: { item: MenuDetailItem }) {
	const title = item.recipe?.title ?? item.recipeTitle ?? 'Recipe'
	// "1×" is the default batch — only a real adjustment earns a badge.
	const multiplier =
		item.scaleMultiplier != null && item.scaleMultiplier !== 1
			? `${formatScaleMultiplier(item.scaleMultiplier)}×`
			: null

	const content = (
		<>
			{item.recipe ? (
				<RecipeThumb title={title} image={item.recipe.image} />
			) : (
				<span className="bg-muted/70 flex size-9 shrink-0 items-center justify-center rounded-md">
					<Icon
						name="question-mark-circled"
						className="text-muted-foreground size-4"
					/>
				</span>
			)}
			<div className="min-w-0 flex-1">
				<p className="line-clamp-2 min-w-0 font-serif text-[17px] leading-[1.4] break-words md:text-base">
					{title}
				</p>
				{item.recipe ? null : (
					<p className="text-destructive mt-0.5 text-xs">
						No longer in your recipe library — edit the menu to replace or
						remove it
					</p>
				)}
				{item.note ? (
					<p className="text-muted-foreground mt-0.5 text-sm leading-snug">
						{item.note}
					</p>
				) : null}
			</div>
			{multiplier ? (
				<span className="text-muted-foreground shrink-0 text-sm font-medium tabular-nums">
					{multiplier}
				</span>
			) : null}
		</>
	)

	if (item.recipe) {
		return (
			<li>
				<Link
					to={`/recipes/${item.recipe.id}`}
					className="border-border/60 bg-card hover:bg-muted/40 flex items-center gap-3 rounded-lg border p-3 transition-colors"
				>
					{content}
				</Link>
			</li>
		)
	}
	return (
		<li className="border-border/60 bg-muted/30 flex items-center gap-3 rounded-lg border border-dashed p-3">
			{content}
		</li>
	)
}
