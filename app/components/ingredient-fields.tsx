import { useId } from 'react'
import { useFetcher } from 'react-router'
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
}

type IngredientFieldsProps = {
	ingredients: IngredientFieldValue[]
	onChange: (ingredients: IngredientFieldValue[]) => void
}

export function IngredientFields({
	ingredients,
	onChange,
}: IngredientFieldsProps) {
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

	const addIngredient = () => {
		onChange([...ingredients, { name: '', amount: '', unit: '', notes: '' }])
	}

	const removeIngredient = (index: number) => {
		if (ingredients.length > 1) {
			onChange(ingredients.filter((_, i) => i !== index))
		}
	}

	const updateIngredient = (
		index: number,
		field: keyof IngredientFieldValue,
		value: string,
	) => {
		const updated = [...ingredients]
		const current = updated[index]
		if (current) {
			updated[index] = { ...current, [field]: value }
			onChange(updated)
		}
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<Label className="text-base font-semibold">Ingredients</Label>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={addIngredient}
				>
					<Icon name="plus" size="sm" />
					Add
				</Button>
			</div>

			<datalist id={datalistId}>
				{allSuggestions.map((name) => (
					<option key={name} value={name} />
				))}
			</datalist>

			<div className="space-y-3">
				{ingredients.map((ingredient, index) => (
					<IngredientRow
						key={ingredient.id ?? `${baseId}-${index}`}
						index={index}
						ingredient={ingredient}
						datalistId={datalistId}
						onUpdate={(field, value) => updateIngredient(index, field, value)}
						onRemove={() => removeIngredient(index)}
						canRemove={ingredients.length > 1}
					/>
				))}
			</div>
		</div>
	)
}

function IngredientRow({
	index,
	ingredient,
	datalistId,
	onUpdate,
	onRemove,
	canRemove,
}: {
	index: number
	ingredient: IngredientFieldValue
	datalistId: string
	onUpdate: (field: keyof IngredientFieldValue, value: string) => void
	onRemove: () => void
	canRemove: boolean
}) {
	const id = useId()

	return (
		<div
			className={cn(
				'space-y-2 rounded-lg p-2',
				index % 2 === 0 && 'bg-muted/20',
			)}
		>
			<div className="flex items-start gap-2">
				<div className="text-muted-foreground/30 hidden pt-2.5 sm:block">
					<Icon name="dots-horizontal" size="sm" />
				</div>
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
					</div>
					<Input
						id={`${id}-notes`}
						placeholder="Notes (e.g., diced, room temperature)"
						value={ingredient.notes ?? ''}
						onChange={(e) => onUpdate('notes', e.target.value)}
						className="text-sm"
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
