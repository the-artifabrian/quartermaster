import { useId, useRef } from 'react'
import { useFetcher } from 'react-router'
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
import { COMMON_INGREDIENTS } from '#app/utils/inventory-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'
import { Label } from './ui/label.tsx'

export type IngredientFieldValue = {
	id?: string
	name: string
	amount?: string
	unit?: string
	notes?: string
	isHeading?: boolean
	/** Stable key for DnD — persists across re-renders */
	sortKey?: string
}

type IngredientFieldsProps = {
	ingredients: IngredientFieldValue[]
	onChange: (ingredients: IngredientFieldValue[]) => void
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

export function IngredientFields({
	ingredients: rawIngredients,
	onChange,
}: IngredientFieldsProps) {
	const ingredients = ensureSortKeys(rawIngredients)
	const baseId = useId()
	const datalistId = `${baseId}-suggestions`

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
		onChange([
			...ingredients,
			{ name: '', amount: '', unit: '', notes: '', sortKey: getSortKey() },
		])
		scrollToLastItem()
	}

	const addHeading = () => {
		onChange([
			...ingredients,
			{ name: '', isHeading: true, sortKey: getSortKey() },
		])
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

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event
		if (!over || active.id === over.id) return

		const oldIndex = ingredients.findIndex(
			(i) => i.sortKey === active.id,
		)
		const newIndex = ingredients.findIndex(
			(i) => i.sortKey === over.id,
		)
		if (oldIndex === -1 || newIndex === -1) return

		const updated = [...ingredients]
		const [moved] = updated.splice(oldIndex, 1)
		updated.splice(newIndex, 0, moved!)
		onChange(updated)
	}

	const sortKeys = ingredients.map((i) => i.sortKey!)

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<Label className="text-base font-semibold">Ingredients</Label>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={addHeading}
					>
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
			</div>

			<datalist id={datalistId}>
				{allSuggestions.map((name) => (
					<option key={name} value={name} />
				))}
			</datalist>

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={handleDragEnd}
			>
				<SortableContext
					items={sortKeys}
					strategy={verticalListSortingStrategy}
				>
					<div ref={listRef} className="space-y-2">
						{ingredients.map((ingredient, index) =>
							ingredient.isHeading ? (
								<SortableHeadingRow
									key={ingredient.sortKey}
									sortKey={ingredient.sortKey!}
									ingredient={ingredient}
									onUpdate={(field, value) =>
										updateIngredient(index, field, value)
									}
									onRemove={() => removeIngredient(index)}
									canRemove={ingredients.length > 1}
								/>
							) : (
								<SortableIngredientRow
									key={ingredient.sortKey}
									sortKey={ingredient.sortKey!}
									ingredient={ingredient}
									datalistId={datalistId}
									onUpdate={(field, value) =>
										updateIngredient(index, field, value)
									}
									onRemove={() => removeIngredient(index)}
									canRemove={ingredients.length > 1}
								/>
							),
						)}
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
	onUpdate,
	onRemove,
	canRemove,
}: {
	sortKey: string
	ingredient: IngredientFieldValue
	datalistId: string
	onUpdate: (field: keyof IngredientFieldValue, value: string) => void
	onRemove: () => void
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
				'space-y-2 rounded-lg p-2',
				isDragging && 'z-10 opacity-80 shadow-lg',
			)}
		>
			<div className="flex items-start gap-2">
				<button
					type="button"
					className="text-muted-foreground/40 hover:text-muted-foreground hidden cursor-grab touch-none pt-2.5 active:cursor-grabbing sm:block"
					{...attributes}
					{...listeners}
					tabIndex={-1}
				>
					<Icon name="dots-horizontal" size="sm" />
				</button>
				<div className="min-w-0 flex-1 space-y-2">
					<Input
						id={`${id}-name`}
						placeholder="Ingredient name"
						value={ingredient.name}
						onChange={(e) => onUpdate('name', e.target.value)}
						list={datalistId}
						className="w-full"
					/>
					<div className="flex gap-2">
						<div className="flex-1 sm:w-20 sm:flex-none">
							<Input
								id={`${id}-amount`}
								placeholder="Amount"
								value={ingredient.amount ?? ''}
								onChange={(e) => onUpdate('amount', e.target.value)}
							/>
						</div>
						<div className="flex-1 sm:w-20 sm:flex-none">
							<Input
								id={`${id}-unit`}
								placeholder="Unit"
								value={ingredient.unit ?? ''}
								onChange={(e) => onUpdate('unit', e.target.value)}
							/>
						</div>
						<Input
							id={`${id}-notes`}
							placeholder="Notes (e.g., diced)"
							value={ingredient.notes ?? ''}
							onChange={(e) => onUpdate('notes', e.target.value)}
							className="hidden flex-1 text-sm sm:block"
						/>
					</div>
					<Input
						id={`${id}-notes-mobile`}
						placeholder="Notes (e.g., diced, room temperature)"
						value={ingredient.notes ?? ''}
						onChange={(e) => onUpdate('notes', e.target.value)}
						className="text-sm sm:hidden"
					/>
				</div>
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
		</div>
	)
}

function SortableHeadingRow({
	sortKey,
	ingredient,
	onUpdate,
	onRemove,
	canRemove,
}: {
	sortKey: string
	ingredient: IngredientFieldValue
	onUpdate: (field: keyof IngredientFieldValue, value: string) => void
	onRemove: () => void
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
				'border-accent/30 bg-accent/5 flex items-center gap-2 rounded-lg border-l-4 p-2',
				isDragging && 'z-10 opacity-80 shadow-lg',
			)}
		>
			<button
				type="button"
				className="text-muted-foreground/40 hover:text-muted-foreground hidden cursor-grab touch-none active:cursor-grabbing sm:block"
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
