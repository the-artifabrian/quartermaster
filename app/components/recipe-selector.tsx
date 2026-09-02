import { Img } from 'openimg/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { cn } from '#app/utils/misc.tsx'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'
import {
	rankRecipeTitleMatches,
	rankTitleAndRelatedMatches,
} from '#app/utils/recipe-search.ts'

export type RecipeSelectorRecipe = {
	id: string
	title: string
	totalTime: number | null
	yieldAmount: number | null
	yieldLabel: string | null
	isFavorite: boolean
	image: { objectKey: string } | null
}

export type PlanSelectorMenu = {
	id: string
	title: string
	recipeCount: number
	noteCount: number
	recipeTitles: string[]
}

export type PlanItemChoice =
	| { kind: 'recipe'; recipe: RecipeSelectorRecipe }
	| { kind: 'menu'; menu: PlanSelectorMenu }

type PlanItemSelectorProps = {
	recipes: RecipeSelectorRecipe[]
	menus: PlanSelectorMenu[]
	/** Weeknights (Mon-Thu) sort by total time; the date only drives that. */
	date: Date
	excludeRecipeIds?: string[]
	onCancel: () => void
	/** The parent owns the Recipe/Menu submit; this module owns discovery. */
	onPick: (choice: PlanItemChoice) => void
}

type RecipeSelectorProps = {
	recipes: RecipeSelectorRecipe[]
	date: Date
	excludeRecipeIds?: string[]
	onCancel: () => void
	onPick: (recipe: RecipeSelectorRecipe) => void
}

/**
 * Small square recipe thumbnail — image when one exists, the deterministic
 * warm monogram placeholder otherwise. Shared row language for anything that
 * lists recipes compactly (Plan selector, Menu picker).
 */
export function RecipeThumb({
	title,
	image,
}: {
	title: string
	image: { objectKey: string } | null
}) {
	if (image) {
		return (
			<span className="size-9 shrink-0 overflow-hidden rounded-md">
				<Img
					src={`/resources/images?objectKey=${encodeURIComponent(image.objectKey)}`}
					alt=""
					className="h-full w-full object-cover"
					width={72}
					height={72}
				/>
			</span>
		)
	}
	const placeholder = getRecipePlaceholder(title)
	return (
		<span
			className={cn(
				'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md',
				placeholder.bgClass,
			)}
		>
			<span className={cn('font-serif text-sm', placeholder.letterColorClass)}>
				{placeholder.letter}
			</span>
		</span>
	)
}

export function getRecipeTotalTime(recipe: {
	totalTime: number | null
}): number | null {
	return recipe.totalTime
}

function sortByTime(a: RecipeSelectorRecipe, b: RecipeSelectorRecipe): number {
	const aTime = getRecipeTotalTime(a) ?? 45
	const bTime = getRecipeTotalTime(b) ?? 45
	return aTime - bTime
}

/**
 * Unified Plan picker for the two reusable things that can start a Meal. Saved
 * Menus stay visually distinct and can be found by their own title or by a
 * Recipe title inside them; Recipes retain favorite and weeknight ordering.
 */
export function PlanItemSelector({ ...props }: PlanItemSelectorProps) {
	return (
		<ItemSelector
			{...props}
			placeholder="Search Recipes and Menus..."
			emptyMessage="No Recipes or Menus found"
		/>
	)
}

/** Recipe-only variant used when adding another Recipe to an existing Meal. */
export function RecipeSelector({
	recipes,
	date,
	excludeRecipeIds,
	onCancel,
	onPick,
}: RecipeSelectorProps) {
	return (
		<ItemSelector
			recipes={recipes}
			menus={[]}
			date={date}
			excludeRecipeIds={excludeRecipeIds}
			onCancel={onCancel}
			onPick={(choice) => {
				if (choice.kind === 'recipe') onPick(choice.recipe)
			}}
			placeholder="Search recipes..."
			emptyMessage="No recipes found"
		/>
	)
}

function ItemSelector({
	recipes,
	menus,
	date,
	excludeRecipeIds = [],
	onCancel,
	onPick,
	placeholder,
	emptyMessage,
}: PlanItemSelectorProps & { placeholder: string; emptyMessage: string }) {
	const [search, setSearch] = useState('')

	const filteredRecipes = rankRecipeTitleMatches(
		recipes.filter((recipe) => !excludeRecipeIds.includes(recipe.id)),
		search,
	)
	const filteredMenus = rankTitleAndRelatedMatches(
		menus.map((menu) => ({ ...menu, relatedTitles: menu.recipeTitles })),
		search,
	)
	const isSearching = search.trim().length > 0

	// Mon=1..Thu=4 are weeknights — sort by total time
	const isWeeknight = date.getUTCDay() >= 1 && date.getUTCDay() <= 4
	const applySorting = (list: RecipeSelectorRecipe[]) =>
		isWeeknight ? [...list].sort(sortByTime) : list

	// Partition into favorites first, then the rest
	const favorites = isSearching
		? []
		: applySorting(filteredRecipes.filter((recipe) => recipe.isFavorite))
	const rest = isSearching
		? filteredRecipes
		: applySorting(filteredRecipes.filter((recipe) => !recipe.isFavorite))
	const hasAnyChoice =
		filteredMenus.length > 0 || favorites.length > 0 || rest.length > 0
	const hasMenus = filteredMenus.length > 0
	const menuChoices = hasMenus ? (
		<>
			<PickerGroupLabel>Menus</PickerGroupLabel>
			{filteredMenus.map((menu) => (
				<MenuOption
					key={menu.id}
					menu={menu}
					onPick={(pickedMenu) => onPick({ kind: 'menu', menu: pickedMenu })}
				/>
			))}
		</>
	) : null

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Input
					placeholder={placeholder}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					autoFocus
				/>
				<Button
					variant="ghost"
					size="icon"
					onClick={onCancel}
					aria-label="Close picker"
				>
					<Icon name="cross-1" size="sm" />
				</Button>
			</div>
			<div className="max-h-[300px] scrollbar-thin space-y-0.5 overflow-y-auto">
				{!hasAnyChoice ? (
					<div className="py-4 text-center">
						<p className="text-muted-foreground text-sm">{emptyMessage}</p>
						<Link
							to="/recipes/new"
							className="text-primary mt-1 inline-block text-sm hover:underline"
						>
							Create a new recipe
						</Link>
					</div>
				) : (
					<>
						{!isSearching ? menuChoices : null}
						{favorites.length > 0 && (
							<>
								{(hasMenus || rest.length > 0) && (
									<PickerGroupLabel>Favorite Recipes</PickerGroupLabel>
								)}
								{favorites.map((recipe) => (
									<RecipeOption
										key={recipe.id}
										recipe={recipe}
										onPick={(pickedRecipe) =>
											onPick({ kind: 'recipe', recipe: pickedRecipe })
										}
									/>
								))}
							</>
						)}
						{rest.length > 0 && (
							<>
								{(hasMenus || favorites.length > 0) && (
									<PickerGroupLabel>
										{isSearching ? 'Recipes' : 'All Recipes'}
									</PickerGroupLabel>
								)}
								{rest.map((recipe) => (
									<RecipeOption
										key={recipe.id}
										recipe={recipe}
										onPick={(pickedRecipe) =>
											onPick({ kind: 'recipe', recipe: pickedRecipe })
										}
									/>
								))}
							</>
						)}
						{isSearching ? menuChoices : null}
					</>
				)}
			</div>
		</div>
	)
}

function PickerGroupLabel({ children }: { children: React.ReactNode }) {
	return (
		<p className="text-muted-foreground px-2 pt-2 pb-0.5 text-xs font-medium tracking-wide uppercase first:pt-1">
			{children}
		</p>
	)
}

function MenuOption({
	menu,
	onPick,
}: {
	menu: PlanSelectorMenu
	onPick: (menu: PlanSelectorMenu) => void
}) {
	const recipeSummary = `${menu.recipeCount} ${menu.recipeCount === 1 ? 'Recipe' : 'Recipes'}`
	const noteSummary = `${menu.noteCount} ${menu.noteCount === 1 ? 'note' : 'notes'}`
	const summary = [
		menu.recipeCount > 0 ? recipeSummary : null,
		menu.noteCount > 0 ? noteSummary : null,
	]
		.filter(Boolean)
		.join(' · ')

	return (
		<button
			type="button"
			onClick={() => onPick(menu)}
			className="hover:bg-muted/50 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
		>
			<span className="bg-muted/70 flex size-9 shrink-0 items-center justify-center rounded-md">
				<Icon name="rows" className="text-muted-foreground size-4" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium">{menu.title}</p>
				<p className="text-muted-foreground truncate text-xs">
					Menu · {summary}
				</p>
			</div>
		</button>
	)
}

function RecipeOption({
	recipe,
	onPick,
}: {
	recipe: RecipeSelectorRecipe
	onPick: (recipe: RecipeSelectorRecipe) => void
}) {
	const totalTime = getRecipeTotalTime(recipe)

	return (
		<button
			type="button"
			onClick={() => onPick(recipe)}
			className="hover:bg-muted/50 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
		>
			<RecipeThumb title={recipe.title} image={recipe.image} />
			<div className="flex min-w-0 flex-1 items-center justify-between gap-2">
				<p className="min-w-0 truncate text-sm font-medium">
					{recipe.isFavorite && (
						<Icon
							name="heart-filled"
							className="text-accent mr-1 inline size-3"
						/>
					)}
					{recipe.title}
				</p>
				<span className="inline-flex shrink-0 items-center gap-1.5">
					{totalTime != null && (
						<span className="text-muted-foreground inline-flex items-center gap-0.5 text-xs">
							<Icon name="clock" className="size-3" />
							{totalTime}m
						</span>
					)}
				</span>
			</div>
		</button>
	)
}
