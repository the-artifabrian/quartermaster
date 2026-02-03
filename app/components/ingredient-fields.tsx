import { useId } from 'react'
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

			<div className="space-y-3">
				{ingredients.map((ingredient, index) => (
					<IngredientRow
						key={ingredient.id ?? `${baseId}-${index}`}
						index={index}
						ingredient={ingredient}
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
	onUpdate,
	onRemove,
	canRemove,
}: {
	index: number
	ingredient: IngredientFieldValue
	onUpdate: (field: keyof IngredientFieldValue, value: string) => void
	onRemove: () => void
	canRemove: boolean
}) {
	const id = useId()

	return (
		<div className="space-y-2">
			<div className="flex gap-2">
				<div className="flex-1 min-w-0">
					<Input
						id={`${id}-name`}
						placeholder="Ingredient name"
						value={ingredient.name}
						onChange={(e) => onUpdate('name', e.target.value)}
						className="w-full"
					/>
				</div>
				<div className="w-20">
					<Input
						id={`${id}-amount`}
						placeholder="Amt"
						value={ingredient.amount ?? ''}
						onChange={(e) => onUpdate('amount', e.target.value)}
					/>
				</div>
				<div className="w-20">
					<Input
						id={`${id}-unit`}
						placeholder="Unit"
						value={ingredient.unit ?? ''}
						onChange={(e) => onUpdate('unit', e.target.value)}
					/>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					onClick={onRemove}
					disabled={!canRemove}
					className={cn(!canRemove && 'opacity-30')}
					aria-label="Remove ingredient"
				>
					<Icon name="cross-1" size="sm" />
				</Button>
			</div>
			<Input
				id={`${id}-notes`}
				placeholder="Notes (e.g., diced, room temperature)"
				value={ingredient.notes ?? ''}
				onChange={(e) => onUpdate('notes', e.target.value)}
				className="text-sm"
			/>
		</div>
	)
}
