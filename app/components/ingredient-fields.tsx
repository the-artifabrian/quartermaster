import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
} from '@dnd-kit/core'
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useId, useRef, useState, useEffect, useCallback } from 'react'
import { useFetcher } from 'react-router'
import { COMMON_INGREDIENTS } from '#app/utils/inventory-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.tsx'

export type IngredientFieldValue = {
	id?: string
	name: string
	amount?: string
	unit?: string
	notes?: string
	isHeading?: boolean
	linkedRecipeId?: string
	linkedRecipeTitle?: string
	/** Stable key for DnD — persists across re-renders */
	sortKey?: string
}

type IngredientFieldsProps = {
	ingredients: IngredientFieldValue[]
	onChange: (ingredients: IngredientFieldValue[]) => void
	/** Exclude this recipe from the link picker (prevents self-linking) */
	excludeRecipeId?: string
}

function getSortKey() {
	return `sort-${Math.random().toString(36).slice(2)}`
}

function ensureSortKeys(
	ingredients: IngredientFieldValue[],
): IngredientFieldValue[] {
	return ingredients.map((ing) =>
		ing.sortKey ? ing : { ...ing, sortKey: ing.id ?? getSortKey() },
	)
}

function ingredientSummary(ing: IngredientFieldValue): string {
	const parts: string[] = []
	if (ing.amount) parts.push(ing.amount)
	if (ing.unit) parts.push(ing.unit)
	parts.push(ing.name || 'Untitled ingredient')
	let summary = parts.join(' ')
	if (ing.notes) summary += `, ${ing.notes}`
	return summary
}

export function IngredientFields({
	ingredients: rawIngredients,
	onChange,
	excludeRecipeId,
}: IngredientFieldsProps) {
	const ingredients = ensureSortKeys(rawIngredients)
	const baseId = useId()
	const datalistId = `${baseId}-suggestions`
	const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

	const toggleExpanded = (sortKey: string) => {
		setExpandedKeys((prev) => {
			const next = new Set(prev)
			if (next.has(sortKey)) {
				next.delete(sortKey)
			} else {
				next.add(sortKey)
			}
			return next
		})
	}

	const fetcher = useFetcher<{ ingredients: string[] }>({
		key: 'ingredient-suggestions',
	})

	// Load suggestions on first render (skip during SSR)
	if (
		typeof document !== 'undefined' &&
		!fetcher.data &&
		fetcher.state === 'idle'
	) {
		void fetcher.load('/resources/ingredient-suggestions')
	}

	// Merge DB results with common ingredients, deduped and sorted
	const dbNames = fetcher.data?.ingredients ?? []
	const allSuggestions = [...new Set([...dbNames, ...COMMON_INGREDIENTS])].sort(
		(a, b) => a.localeCompare(b),
	)

	const listRef = useRef<HTMLDivElement>(null)

	function scrollToLastItem() {
		requestAnimationFrame(() => {
			const last = listRef.current?.lastElementChild
			last?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
		})
	}

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	)

	const addIngredient = () => {
		const key = getSortKey()
		onChange([
			...ingredients,
			{ name: '', amount: '', unit: '', notes: '', sortKey: key },
		])
		setExpandedKeys((prev) => new Set(prev).add(key))
		scrollToLastItem()
	}

	const addHeading = () => {
		const key = getSortKey()
		onChange([...ingredients, { name: '', isHeading: true, sortKey: key }])
		setExpandedKeys((prev) => new Set(prev).add(key))
		scrollToLastItem()
	}

	const removeIngredient = (index: number) => {
		if (ingredients.length > 1) {
			onChange(ingredients.filter((_, i) => i !== index))
		}
	}

	const updateIngredient = (
		index: number,
		field: keyof IngredientFieldValue,
		value: string | boolean,
	) => {
		const updated = [...ingredients]
		const current = updated[index]
		if (current) {
			updated[index] = { ...current, [field]: value }
			onChange(updated)
		}
	}

	const linkRecipe = (index: number, recipeId: string, recipeTitle: string) => {
		const updated = [...ingredients]
		const current = updated[index]
		if (current) {
			updated[index] = {
				...current,
				linkedRecipeId: recipeId,
				linkedRecipeTitle: recipeTitle,
			}
			onChange(updated)
		}
	}

	const unlinkRecipe = (index: number) => {
		const updated = [...ingredients]
		const current = updated[index]
		if (current) {
			updated[index] = {
				...current,
				linkedRecipeId: undefined,
				linkedRecipeTitle: undefined,
			}
			onChange(updated)
		}
	}

	const convertToIngredient = (index: number) => {
		const updated = [...ingredients]
		const current = updated[index]
		if (current) {
			updated[index] = { ...current, isHeading: false }
			onChange(updated)
		}
	}

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event
		if (!over || active.id === over.id) return

		const oldIndex = ingredients.findIndex((i) => i.sortKey === active.id)
		const newIndex = ingredients.findIndex((i) => i.sortKey === over.id)
		if (oldIndex === -1 || newIndex === -1) return

		const updated = [...ingredients]
		const [moved] = updated.splice(oldIndex, 1)
		updated.splice(newIndex, 0, moved!)
		onChange(updated)
	}

	const sortKeys = ingredients.map((i) => i.sortKey!)

	return (
		<div className="space-y-4">
			<div className="flex gap-2 sm:justify-end">
				<Button type="button" variant="outline" size="sm" onClick={addHeading}>
					<Icon name="plus" size="sm" />
					Heading
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={addIngredient}
				>
					<Icon name="plus" size="sm" />
					Ingredient
				</Button>
			</div>

			<datalist id={datalistId}>
				{allSuggestions.map((name) => (
					<option key={name} value={name} />
				))}
			</datalist>

			<DndContext
				id={`${baseId}-dnd`}
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={handleDragEnd}
			>
				<SortableContext
					items={sortKeys}
					strategy={verticalListSortingStrategy}
				>
					<div ref={listRef} className="divide-border divide-y">
						{ingredients.map((ingredient, index) => {
							const isExpanded =
								!ingredient.name || expandedKeys.has(ingredient.sortKey!)
							return ingredient.isHeading ? (
								<SortableHeadingRow
									key={ingredient.sortKey}
									sortKey={ingredient.sortKey!}
									ingredient={ingredient}
									onUpdate={(field, value) =>
										updateIngredient(index, field, value)
									}
									onRemove={() => removeIngredient(index)}
									canRemove={ingredients.length > 1}
									onConvertToIngredient={() => convertToIngredient(index)}
								/>
							) : (
								<SortableIngredientRow
									key={ingredient.sortKey}
									sortKey={ingredient.sortKey!}
									ingredient={ingredient}
									datalistId={datalistId}
									isExpanded={isExpanded}
									onToggleExpand={() => toggleExpanded(ingredient.sortKey!)}
									onUpdate={(field, value) =>
										updateIngredient(index, field, value)
									}
									onRemove={() => removeIngredient(index)}
									onLinkRecipe={(recipeId, recipeTitle) =>
										linkRecipe(index, recipeId, recipeTitle)
									}
									onUnlinkRecipe={() => unlinkRecipe(index)}
									excludeRecipeId={excludeRecipeId}
									canRemove={ingredients.length > 1}
								/>
							)
						})}
					</div>
				</SortableContext>
			</DndContext>
		</div>
	)
}

function SortableIngredientRow({
	sortKey,
	ingredient,
	datalistId,
	isExpanded,
	onToggleExpand,
	onUpdate,
	onRemove,
	onLinkRecipe,
	onUnlinkRecipe,
	excludeRecipeId,
	canRemove,
}: {
	sortKey: string
	ingredient: IngredientFieldValue
	datalistId: string
	isExpanded: boolean
	onToggleExpand: () => void
	onUpdate: (field: keyof IngredientFieldValue, value: string) => void
	onRemove: () => void
	onLinkRecipe: (recipeId: string, recipeTitle: string) => void
	onUnlinkRecipe: () => void
	excludeRecipeId?: string
	canRemove: boolean
}) {
	const id = useId()
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: sortKey })

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	}

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn(
				'rounded-lg py-2 first:pt-0 last:pb-0',
				isDragging && 'z-10 opacity-80 shadow-lg',
			)}
		>
			{isExpanded ? (
				<div className="space-y-2 py-1">
					<div className="flex items-center gap-1">
						<button
							type="button"
							className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab touch-none rounded-md p-2 active:cursor-grabbing"
							{...attributes}
							{...listeners}
							tabIndex={-1}
						>
							<Icon name="dots-horizontal" size="sm" />
						</button>
						{ingredient.name && (
							<button
								type="button"
								onClick={onToggleExpand}
								className="text-muted-foreground/60 hover:text-muted-foreground rounded-md p-2"
								aria-label="Collapse ingredient"
							>
								<Icon name="chevron-down" size="sm" />
							</button>
						)}
						<Button
							type="button"
							variant="ghost"
							size="icon"
							onClick={onRemove}
							disabled={!canRemove}
							className={cn('size-9', !canRemove && 'opacity-30')}
							aria-label="Remove ingredient"
						>
							<Icon name="cross-1" size="sm" />
						</Button>
					</div>
					<Input
						id={`${id}-name`}
						placeholder="Ingredient name"
						value={ingredient.name}
						onChange={(e) => onUpdate('name', e.target.value)}
						list={datalistId}
					/>
					<div className="flex items-center gap-2">
						<Input
							id={`${id}-amount`}
							placeholder="Amount"
							value={ingredient.amount ?? ''}
							onChange={(e) => onUpdate('amount', e.target.value)}
							className="flex-1"
						/>
						<Input
							id={`${id}-unit`}
							placeholder="Unit"
							value={ingredient.unit ?? ''}
							onChange={(e) => onUpdate('unit', e.target.value)}
							className="flex-1"
						/>
					</div>
					<Input
						id={`${id}-notes`}
						placeholder="Notes (e.g., diced)"
						value={ingredient.notes ?? ''}
						onChange={(e) => onUpdate('notes', e.target.value)}
					/>
					<RecipeLinkPicker
						linkedRecipeId={ingredient.linkedRecipeId}
						linkedRecipeTitle={ingredient.linkedRecipeTitle}
						onLink={onLinkRecipe}
						onUnlink={onUnlinkRecipe}
						excludeRecipeId={excludeRecipeId}
					/>
				</div>
			) : (
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab touch-none rounded-md p-2 active:cursor-grabbing"
						{...attributes}
						{...listeners}
						tabIndex={-1}
					>
						<Icon name="dots-horizontal" size="sm" />
					</button>
					<button
						type="button"
						onClick={onToggleExpand}
						className="text-foreground flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
					>
						<Icon
							name="chevron-down"
							size="sm"
							className="text-muted-foreground/60 shrink-0 -rotate-90"
						/>
						<span className="truncate">{ingredientSummary(ingredient)}</span>
						{ingredient.linkedRecipeTitle && (
							<Icon name="link-2" size="sm" className="text-primary shrink-0" />
						)}
					</button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={onRemove}
						disabled={!canRemove}
						className={cn('size-9 shrink-0', !canRemove && 'opacity-30')}
						aria-label="Remove ingredient"
					>
						<Icon name="cross-1" size="sm" />
					</Button>
				</div>
			)}
		</div>
	)
}

function RecipeLinkPicker({
	linkedRecipeId,
	linkedRecipeTitle,
	onLink,
	onUnlink,
	excludeRecipeId,
}: {
	linkedRecipeId?: string
	linkedRecipeTitle?: string
	onLink: (recipeId: string, recipeTitle: string) => void
	onUnlink: () => void
	excludeRecipeId?: string
}) {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState('')
	const fetcher = useFetcher<{
		recipes: Array<{ id: string; title: string }>
	}>()
	const inputRef = useRef<HTMLInputElement>(null)

	const doSearch = useCallback(
		(q: string) => {
			if (q.length >= 2) {
				const params = new URLSearchParams({ q })
				if (excludeRecipeId) params.set('exclude', excludeRecipeId)
				void fetcher.load(`/resources/recipe-search?${params}`)
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[excludeRecipeId],
	)

	useEffect(() => {
		if (open) {
			setTimeout(() => inputRef.current?.focus(), 0)
		}
	}, [open])

	const results = fetcher.data?.recipes ?? []

	if (linkedRecipeId && linkedRecipeTitle) {
		return (
			<div className="flex items-center gap-2 rounded-md border px-3 py-2">
				<Icon name="link-2" size="sm" className="text-primary shrink-0" />
				<span className="min-w-0 flex-1 truncate text-sm">
					{linkedRecipeTitle}
				</span>
				<button
					type="button"
					onClick={onUnlink}
					className="text-muted-foreground hover:text-destructive shrink-0"
					aria-label="Remove recipe link"
				>
					<Icon name="cross-1" size="sm" />
				</button>
			</div>
		)
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-md px-1 py-1 text-xs transition-colors"
				>
					<Icon name="link-2" size="sm" />
					Link recipe
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 p-2">
				<Input
					ref={inputRef}
					placeholder="Search recipes..."
					value={query}
					onChange={(e) => {
						setQuery(e.target.value)
						doSearch(e.target.value)
					}}
					className="mb-2"
				/>
				{query.length < 2 ? (
					<p className="text-muted-foreground px-2 py-3 text-center text-xs">
						Type to search your recipes
					</p>
				) : fetcher.state !== 'idle' ? (
					<p className="text-muted-foreground px-2 py-3 text-center text-xs">
						Searching...
					</p>
				) : results.length === 0 ? (
					<p className="text-muted-foreground px-2 py-3 text-center text-xs">
						No recipes found
					</p>
				) : (
					<ul className="max-h-48 overflow-y-auto">
						{results.map((recipe) => (
							<li key={recipe.id}>
								<button
									type="button"
									className="hover:bg-accent w-full rounded-md px-2 py-1.5 text-left text-sm"
									onClick={() => {
										onLink(recipe.id, recipe.title)
										setOpen(false)
										setQuery('')
									}}
								>
									{recipe.title}
								</button>
							</li>
						))}
					</ul>
				)}
			</PopoverContent>
		</Popover>
	)
}

function SortableHeadingRow({
	sortKey,
	ingredient,
	onUpdate,
	onRemove,
	canRemove,
	onConvertToIngredient,
}: {
	sortKey: string
	ingredient: IngredientFieldValue
	onUpdate: (field: keyof IngredientFieldValue, value: string) => void
	onRemove: () => void
	canRemove: boolean
	onConvertToIngredient: () => void
}) {
	const id = useId()
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: sortKey })

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	}

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn(
				'border-accent/30 bg-accent/5 flex items-center gap-2 rounded-lg border-l-4 px-2 py-3 first:pt-2 last:pb-2',
				isDragging && 'z-10 opacity-80 shadow-lg',
			)}
		>
			<button
				type="button"
				className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab touch-none rounded-md p-2 active:cursor-grabbing"
				{...attributes}
				{...listeners}
				tabIndex={-1}
			>
				<Icon name="dots-horizontal" size="sm" />
			</button>
			<Input
				id={`${id}-heading`}
				placeholder="Section heading (e.g., Polenta, Sauce)"
				value={ingredient.name}
				onChange={(e) => onUpdate('name', e.target.value)}
				className="flex-1 font-semibold"
			/>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={onConvertToIngredient}
						className="size-9"
						aria-label="Convert to regular ingredient"
					>
						<Icon name="reset" size="sm" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Convert to regular ingredient</TooltipContent>
			</Tooltip>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				onClick={onRemove}
				disabled={!canRemove}
				className={cn('size-9', !canRemove && 'opacity-30')}
				aria-label="Remove heading"
			>
				<Icon name="cross-1" size="sm" />
			</Button>
		</div>
	)
}
