import { Link } from 'react-router'
import { RecipeThumb } from '#app/components/recipe-selector.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { formatScaleMultiplier } from '#app/utils/menu-validation.ts'
import { sectionLabelClass } from '#app/utils/misc.tsx'
import {
	formatTargetYieldAmount,
	getTypedYield,
	scaleMultiplierToTargetYield,
} from '#app/utils/target-yield.ts'

export function MenuContents({
	menu,
	sharedMenuId,
}: {
	menu: {
		sections: Array<{
			id: string
			name: string | null
			items: MenuDetailItem[]
		}>
	}
	sharedMenuId?: string
}) {
	return (
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
							<ul className="max-md:divide-border/40 max-md:-mx-4 max-md:divide-y sm:max-md:-mx-8 md:space-y-2">
								{section.items.map((item) =>
									item.kind === 'note' ? (
										<MenuNoteCard key={item.id} item={item} />
									) : (
										<MenuRecipeCard
											key={item.id}
											item={item}
											sharedMenuId={sharedMenuId}
										/>
									),
								)}
							</ul>
						)}
					</section>
				))}
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
		yieldAmount: number | null
		yieldLabel: string | null
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
		<li className="md:border-border/60 md:bg-card px-4 py-3 sm:max-md:px-8 md:rounded-lg md:border md:p-3">
			<div className="min-w-0">
				<p className="min-w-0 text-[15px] leading-relaxed break-words whitespace-pre-wrap">
					{item.note}
				</p>
				{item.shoppingLines.length > 0 ? (
					<ul className="mt-1.5 space-y-0.5">
						{item.shoppingLines.map((line) => {
							const quantity = [line.quantity, line.unit]
								.filter(Boolean)
								.join(' ')
							return (
								<li
									key={line.id}
									className="text-muted-foreground flex items-baseline gap-1.5 text-sm"
								>
									<Icon
										name="cart"
										size="xs"
										className="shrink-0 translate-y-px"
									/>
									<span className="min-w-0 break-words">
										{line.name}
										{quantity ? (
											<span className="tabular-nums"> · {quantity}</span>
										) : null}
									</span>
								</li>
							)
						})}
					</ul>
				) : null}
			</div>
		</li>
	)
}

function MenuRecipeCard({
	item,
	sharedMenuId,
}: {
	item: MenuDetailItem
	sharedMenuId?: string
}) {
	const title = item.recipe?.title ?? item.recipeTitle ?? 'Recipe'
	const recipeYield = item.recipe ? getTypedYield(item.recipe) : null
	const targetYield =
		item.scaleMultiplier != null
			? scaleMultiplierToTargetYield(item.scaleMultiplier, recipeYield)
			: null
	// Multiplier remains the shared quantity vocabulary, but 1× is the default
	// and reads as noise on every row — only a real scale shows the prefix.
	const scaledPrefix =
		item.scaleMultiplier != null && item.scaleMultiplier !== 1
			? `${formatScaleMultiplier(item.scaleMultiplier)}×`
			: null
	const madeYield =
		item.scaleMultiplier != null && recipeYield && targetYield != null
			? `makes ${formatTargetYieldAmount(targetYield)} ${recipeYield.label}`
			: null
	const quantity = [scaledPrefix, madeYield].filter(Boolean).join(' · ') || null

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
			<div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
				<div className="min-w-0 flex-1">
					<p className="line-clamp-2 min-w-0 font-serif text-[17px] leading-[1.4] break-words md:text-base">
						{title}
					</p>
					{item.recipe ? null : (
						<p className="text-destructive mt-0.5 text-xs">
							{sharedMenuId
								? 'Recipe unavailable'
								: 'No longer in your recipe library — edit the menu to replace or remove it'}
						</p>
					)}
					{item.note ? (
						<p className="text-muted-foreground mt-0.5 text-sm leading-snug">
							{item.note}
						</p>
					) : null}
				</div>
				{quantity ? (
					<span className="text-muted-foreground mt-1 block text-sm font-medium tabular-nums sm:mt-0 sm:shrink-0">
						{quantity}
					</span>
				) : null}
			</div>
		</>
	)

	if (item.recipe) {
		return (
			<li>
				<Link
					to={
						sharedMenuId
							? `/share/menus/${sharedMenuId}/recipes/${item.id}`
							: item.scaleMultiplier != null && item.scaleMultiplier !== 1
								? `/recipes/${item.recipe.id}?scale=${formatScaleMultiplier(item.scaleMultiplier)}`
								: `/recipes/${item.recipe.id}`
					}
					className="active:bg-muted/40 md:border-border/60 md:bg-card md:hover:bg-muted/40 flex items-center gap-3 px-4 py-3 transition-colors sm:max-md:px-8 md:rounded-lg md:border md:p-3"
				>
					{content}
				</Link>
			</li>
		)
	}
	return (
		<li className="md:border-border/60 md:bg-muted/30 flex items-center gap-3 px-4 py-3 sm:max-md:px-8 md:rounded-lg md:border md:border-dashed md:p-3">
			{content}
		</li>
	)
}
