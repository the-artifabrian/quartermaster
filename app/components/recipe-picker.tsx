import { useEffect, useRef, useState } from 'react'
import {
	getRecipeTotalTime,
	RecipeThumb,
} from '#app/components/recipe-selector.tsx'
import { BottomSheet } from '#app/components/ui/bottom-sheet.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '#app/components/ui/popover.tsx'
import { formatDuration } from '#app/utils/format-duration.ts'
import { cn } from '#app/utils/misc.tsx'
import { rankRecipeTitleMatches } from '#app/utils/recipe-search.ts'

export type RecipePickerRecipe = {
	id: string
	title: string
	totalTime: number | null
	yieldAmount: number | null
	yieldLabel: string | null
	isFavorite: boolean
	image: { objectKey: string } | null
}

/** Classes the caller adds to the picker's parts, to set them in its sizes. */
export type RecipePickerClassNames = {
	trigger?: string
	groupLabel?: string
	name?: string
	time?: string
	empty?: string
}

type RecipePickerProps = {
	recipes: RecipePickerRecipe[]
	/** Recipes already on the menu, hidden so a Recipe appears only once. */
	excludeRecipeIds?: string[]
	/** Called with the chosen Recipe; the picker closes itself afterwards. */
	onPick: (recipe: RecipePickerRecipe) => void
	label?: string
	triggerVariant?: React.ComponentProps<typeof Button>['variant']
	classNames?: RecipePickerClassNames
}

/**
 * Callback-based household Recipe picker for the Menu builder: an efficient
 * popover on desktop, a touch-friendly bottom sheet on phone. Deliberately not
 * coupled to Plan: it only reports the picked Recipe to its caller.
 */
export function RecipePicker({
	recipes,
	excludeRecipeIds = [],
	onPick,
	label = 'Add Recipe',
	triggerVariant = 'outline',
	classNames,
}: RecipePickerProps) {
	const [popoverOpen, setPopoverOpen] = useState(false)
	const [sheetOpen, setSheetOpen] = useState(false)

	function pick(recipe: RecipePickerRecipe) {
		setPopoverOpen(false)
		setSheetOpen(false)
		onPick(recipe)
	}

	return (
		<>
			{/* Desktop: popover keeps the builder in view while composing */}
			<div className="hidden md:block">
				<Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
					<PopoverTrigger asChild>
						{/* type=button: the picker renders inside the builder form and
						    must never submit it */}
						<Button
							type="button"
							variant={triggerVariant}
							className={classNames?.trigger}
						>
							<Icon name="plus" size="sm" />
							{label}
						</Button>
					</PopoverTrigger>
					<PopoverContent align="start" className="w-96 p-2">
						<PickerList
							recipes={recipes}
							excludeRecipeIds={excludeRecipeIds}
							onPick={pick}
							classNames={classNames}
						/>
					</PopoverContent>
				</Popover>
			</div>

			{/* Phone: bottom sheet so several picks don't crowd the builder */}
			<div className="md:hidden">
				<Button
					type="button"
					variant={triggerVariant}
					className={classNames?.trigger}
					onClick={() => setSheetOpen(true)}
				>
					<Icon name="plus" size="sm" />
					{label}
				</Button>
				<BottomSheet
					open={sheetOpen}
					onClose={() => setSheetOpen(false)}
					labelledBy="recipe-picker-sheet-title"
					title="Add a Recipe"
				>
					<PickerList
						recipes={recipes}
						excludeRecipeIds={excludeRecipeIds}
						onPick={pick}
						classNames={classNames}
					/>
				</BottomSheet>
			</div>
		</>
	)
}

function PickerList({
	recipes,
	excludeRecipeIds,
	onPick,
	classNames,
}: {
	recipes: RecipePickerRecipe[]
	excludeRecipeIds: string[]
	onPick: (recipe: RecipePickerRecipe) => void
	classNames?: RecipePickerClassNames
}) {
	const [search, setSearch] = useState('')
	const searchRef = useRef<HTMLInputElement>(null)
	// Not autoFocus: on a phone the sheet is still below the screen, and
	// focusing must not scroll the page to it.
	useEffect(() => {
		searchRef.current?.focus({ preventScroll: true })
	}, [])

	const available = recipes.filter((r) => !excludeRecipeIds.includes(r.id))
	const filtered = rankRecipeTitleMatches(available, search)
	const isSearching = search.trim().length > 0

	// Same grouping language as the Plan selector: favorites first, then the rest
	const favorites = isSearching
		? []
		: filtered.filter((recipe) => recipe.isFavorite)
	const rest = isSearching
		? filtered
		: filtered.filter((recipe) => !recipe.isFavorite)
	const hasBothGroups = favorites.length > 0 && rest.length > 0

	let emptyMessage: string | null = null
	if (filtered.length === 0) {
		if (recipes.length === 0) {
			emptyMessage = 'No Recipes yet'
		} else if (available.length === 0) {
			emptyMessage = 'Every Recipe is already on this Menu'
		} else {
			emptyMessage = 'No Recipes found'
		}
	}

	return (
		<div className="space-y-2">
			<Input
				placeholder="Search Recipes…"
				aria-label="Search Recipes"
				inputMode="search"
				enterKeyHint="search"
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				ref={searchRef}
			/>
			<div className="max-h-[300px] scrollbar-thin space-y-0.5 overflow-y-auto overscroll-contain md:max-h-[340px]">
				{emptyMessage ? (
					<p
						className={cn(
							'text-muted-foreground py-4 text-center text-sm',
							classNames?.empty,
						)}
					>
						{emptyMessage}
					</p>
				) : (
					<>
						{favorites.length > 0 && (
							<>
								{hasBothGroups && (
									<PickerGroupLabel className={classNames?.groupLabel}>
										Favorites
									</PickerGroupLabel>
								)}
								{favorites.map((recipe) => (
									<PickerOption
										key={recipe.id}
										recipe={recipe}
										onPick={onPick}
										classNames={classNames}
									/>
								))}
							</>
						)}
						{rest.length > 0 && (
							<>
								{hasBothGroups && (
									<PickerGroupLabel className={classNames?.groupLabel}>
										All Recipes
									</PickerGroupLabel>
								)}
								{rest.map((recipe) => (
									<PickerOption
										key={recipe.id}
										recipe={recipe}
										onPick={onPick}
										classNames={classNames}
									/>
								))}
							</>
						)}
					</>
				)}
			</div>
		</div>
	)
}

function PickerGroupLabel({
	children,
	className,
}: {
	children: React.ReactNode
	className?: string
}) {
	return (
		<p
			className={cn(
				'text-muted-foreground px-2 pt-1 pb-0.5 text-xs font-medium tracking-wide uppercase',
				className,
			)}
		>
			{children}
		</p>
	)
}

function PickerOption({
	recipe,
	onPick,
	classNames,
}: {
	recipe: RecipePickerRecipe
	onPick: (recipe: RecipePickerRecipe) => void
	classNames?: RecipePickerClassNames
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
				<p
					className={cn(
						'min-w-0 truncate text-sm font-medium',
						classNames?.name,
					)}
				>
					{recipe.isFavorite && (
						<Icon
							name="heart-filled"
							className="text-primary mr-1 inline size-3"
						/>
					)}
					{recipe.title}
				</p>
				{totalTime != null && (
					<span
						className={cn(
							'text-muted-foreground inline-flex shrink-0 items-center gap-0.5 text-xs',
							classNames?.time,
						)}
					>
						<Icon name="clock" className="size-3" />
						{formatDuration(totalTime)}
					</span>
				)}
			</div>
		</button>
	)
}
