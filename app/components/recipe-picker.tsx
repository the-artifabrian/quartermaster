import { useState } from 'react'
import {
	getRecipeTotalTime,
	RecipeThumb,
} from '#app/components/recipe-selector.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '#app/components/ui/popover.tsx'
import { useModal } from '#app/utils/use-modal.ts'

export type RecipePickerRecipe = {
	id: string
	title: string
	totalTime: number | null
	yieldAmount: number | null
	yieldLabel: string | null
	isFavorite: boolean
	image: { objectKey: string } | null
}

type RecipePickerProps = {
	recipes: RecipePickerRecipe[]
	/** Recipes already on the menu — hidden so a Recipe appears only once. */
	excludeRecipeIds?: string[]
	/** Called with the chosen Recipe; the picker closes itself afterwards. */
	onPick: (recipe: RecipePickerRecipe) => void
	label?: string
	triggerVariant?: React.ComponentProps<typeof Button>['variant']
}

/**
 * Callback-based household Recipe picker for the Menu builder: an efficient
 * popover on desktop, a touch-friendly bottom sheet on phone. Deliberately not
 * coupled to Plan — it only reports the picked Recipe to its caller.
 */
export function RecipePicker({
	recipes,
	excludeRecipeIds = [],
	onPick,
	label = 'Add recipe',
	triggerVariant = 'outline',
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
						<Button type="button" variant={triggerVariant}>
							<Icon name="plus" size="sm" />
							{label}
						</Button>
					</PopoverTrigger>
					<PopoverContent align="start" className="w-96 p-2">
						<PickerList
							recipes={recipes}
							excludeRecipeIds={excludeRecipeIds}
							onPick={pick}
						/>
					</PopoverContent>
				</Popover>
			</div>

			{/* Phone: bottom sheet so several picks don't crowd the builder */}
			<div className="md:hidden">
				<Button
					type="button"
					variant={triggerVariant}
					onClick={() => setSheetOpen(true)}
				>
					<Icon name="plus" size="sm" />
					{label}
				</Button>
				{sheetOpen ? (
					<PickerSheet onClose={() => setSheetOpen(false)}>
						<PickerList
							recipes={recipes}
							excludeRecipeIds={excludeRecipeIds}
							onPick={pick}
						/>
					</PickerSheet>
				) : null}
			</div>
		</>
	)
}

function PickerSheet({
	onClose,
	children,
}: {
	onClose: () => void
	children: React.ReactNode
}) {
	const dialogRef = useModal(onClose)

	return (
		<div
			ref={dialogRef}
			role="dialog"
			aria-modal="true"
			aria-labelledby="recipe-picker-sheet-title"
		>
			<div className="fixed inset-0 z-40 bg-black/15" onClick={onClose} />
			<div className="animate-slide-up-reveal border-border/60 bg-card shadow-warm-lg fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 rounded-t-xl border-t p-4">
				<div className="mb-2 flex items-center justify-between">
					<span id="recipe-picker-sheet-title" className="text-sm font-medium">
						Add a recipe
					</span>
					<button
						type="button"
						onClick={onClose}
						className="text-muted-foreground hover:text-foreground -m-1 p-1"
						aria-label="Close"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>
				{children}
			</div>
		</div>
	)
}

function PickerList({
	recipes,
	excludeRecipeIds,
	onPick,
}: {
	recipes: RecipePickerRecipe[]
	excludeRecipeIds: string[]
	onPick: (recipe: RecipePickerRecipe) => void
}) {
	const [search, setSearch] = useState('')

	const available = recipes.filter((r) => !excludeRecipeIds.includes(r.id))
	const filtered = available.filter((r) =>
		r.title.toLowerCase().includes(search.toLowerCase()),
	)

	// Same grouping language as the Plan selector: favorites first, then the rest
	const favorites = filtered.filter((r) => r.isFavorite)
	const rest = filtered.filter((r) => !r.isFavorite)
	const hasBothGroups = favorites.length > 0 && rest.length > 0

	let emptyMessage: string | null = null
	if (filtered.length === 0) {
		if (recipes.length === 0) {
			emptyMessage = 'No recipes in your library yet'
		} else if (available.length === 0) {
			emptyMessage = 'Every recipe is already on this menu'
		} else {
			emptyMessage = 'No recipes found'
		}
	}

	return (
		<div className="space-y-2">
			<Input
				placeholder="Search recipes..."
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				autoFocus
			/>
			<div className="max-h-[300px] scrollbar-thin space-y-0.5 overflow-y-auto overscroll-contain md:max-h-[340px]">
				{emptyMessage ? (
					<p className="text-muted-foreground py-4 text-center text-sm">
						{emptyMessage}
					</p>
				) : (
					<>
						{favorites.length > 0 && (
							<>
								{hasBothGroups && (
									<PickerGroupLabel>Favorites</PickerGroupLabel>
								)}
								{favorites.map((recipe) => (
									<PickerOption
										key={recipe.id}
										recipe={recipe}
										onPick={onPick}
									/>
								))}
							</>
						)}
						{rest.length > 0 && (
							<>
								{hasBothGroups && (
									<PickerGroupLabel>All Recipes</PickerGroupLabel>
								)}
								{rest.map((recipe) => (
									<PickerOption
										key={recipe.id}
										recipe={recipe}
										onPick={onPick}
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

function PickerGroupLabel({ children }: { children: React.ReactNode }) {
	return (
		<p className="text-muted-foreground px-2 pt-1 pb-0.5 text-xs font-medium tracking-wide uppercase">
			{children}
		</p>
	)
}

function PickerOption({
	recipe,
	onPick,
}: {
	recipe: RecipePickerRecipe
	onPick: (recipe: RecipePickerRecipe) => void
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
				{totalTime != null && (
					<span className="text-muted-foreground inline-flex shrink-0 items-center gap-0.5 text-xs">
						<Icon name="clock" className="size-3" />
						{totalTime}m
					</span>
				)}
			</div>
		</button>
	)
}
