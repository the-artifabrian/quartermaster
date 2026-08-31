import { useMemo, useState } from 'react'
import { cn } from '#app/utils/misc.tsx'
import {
	emptyRecipeMetadataGroups,
	groupRecipeMetadataValues,
	RECIPE_METADATA_DIMENSIONS,
	RECIPE_METADATA_LABELS,
	RecipeMetadataNameSchema,
	recipeMetadataNameKey,
	type RecipeMetadataDimension,
} from '#app/utils/recipe-metadata.ts'
import { Button } from './ui/button.tsx'
import { Input } from './ui/input.tsx'

export type RecipeMetadataOption = {
	id: string
	dimension: string
	name: string
	nameKey: string
}

type NewOption = { name: string; nameKey: string }

function customOptionKey(dimension: RecipeMetadataDimension, nameKey: string) {
	return `new:${dimension}:${nameKey}`
}

export function RecipeMetadataFields({
	options,
	selectedValueIds = [],
}: {
	options: RecipeMetadataOption[]
	selectedValueIds?: string[]
}) {
	const groupedOptions = useMemo(
		() => groupRecipeMetadataValues(options),
		[options],
	)
	const [selected, setSelected] = useState(() => new Set(selectedValueIds))
	const [newOptions, setNewOptions] = useState<
		Record<RecipeMetadataDimension, NewOption[]>
	>(() => emptyRecipeMetadataGroups<NewOption>())
	const [drafts, setDrafts] = useState<Record<RecipeMetadataDimension, string>>(
		{
			cuisine: '',
			season: '',
			course: '',
		},
	)
	const [errors, setErrors] = useState<
		Partial<Record<RecipeMetadataDimension, string>>
	>({})

	function toggle(key: string) {
		setSelected((current) => {
			const next = new Set(current)
			if (next.has(key)) next.delete(key)
			else next.add(key)
			return next
		})
	}

	function addValue(dimension: RecipeMetadataDimension) {
		const parsed = RecipeMetadataNameSchema.safeParse(drafts[dimension])
		if (!parsed.success) {
			setErrors((current) => ({
				...current,
				[dimension]: parsed.error.issues[0]?.message ?? 'Enter a name',
			}))
			return
		}

		const name = parsed.data
		const nameKey = recipeMetadataNameKey(name)
		const existing = groupedOptions[dimension].find(
			(option) => option.nameKey === nameKey,
		)
		if (existing) {
			setSelected((current) => new Set(current).add(existing.id))
		} else {
			const key = customOptionKey(dimension, nameKey)
			setNewOptions((current) => ({
				...current,
				[dimension]: current[dimension].some(
					(option) => option.nameKey === nameKey,
				)
					? current[dimension]
					: [...current[dimension], { name, nameKey }],
			}))
			setSelected((current) => new Set(current).add(key))
		}
		setDrafts((current) => ({ ...current, [dimension]: '' }))
		setErrors((current) => ({ ...current, [dimension]: undefined }))
	}

	const serializedSelection = JSON.stringify({
		selectedValueIds: options
			.filter((option) => selected.has(option.id))
			.map((option) => option.id),
		newValues: Object.fromEntries(
			RECIPE_METADATA_DIMENSIONS.map((dimension) => [
				dimension,
				newOptions[dimension]
					.filter((option) =>
						selected.has(customOptionKey(dimension, option.nameKey)),
					)
					.map((option) => option.name),
			]),
		),
	})

	return (
		<div className="space-y-5">
			<input type="hidden" name="recipeMetadata" value={serializedSelection} />
			<p className="text-muted-foreground text-sm">
				Optional. Choose as many as fit; leave any group empty when it is not
				useful.
			</p>
			{RECIPE_METADATA_DIMENSIONS.map((dimension) => {
				const label = RECIPE_METADATA_LABELS[dimension]
				return (
					<fieldset key={dimension} className="space-y-2.5">
						<legend className="text-sm font-medium">{label}</legend>
						<div className="flex flex-wrap gap-2">
							{groupedOptions[dimension].map((option) => (
								<button
									key={option.id}
									type="button"
									aria-pressed={selected.has(option.id)}
									onClick={() => toggle(option.id)}
									className={cn(
										'flex min-h-10 items-center rounded-full border px-3 text-sm transition-colors',
										selected.has(option.id)
											? 'border-primary bg-primary text-primary-foreground'
											: 'border-border bg-background hover:bg-muted',
									)}
								>
									{option.name}
								</button>
							))}
							{newOptions[dimension].map((option) => {
								const key = customOptionKey(dimension, option.nameKey)
								return (
									<button
										key={key}
										type="button"
										aria-pressed={selected.has(key)}
										onClick={() => toggle(key)}
										className={cn(
											'flex min-h-10 items-center rounded-full border px-3 text-sm transition-colors',
											selected.has(key)
												? 'border-primary bg-primary text-primary-foreground'
												: 'border-border bg-background hover:bg-muted',
										)}
									>
										{option.name}
									</button>
								)
							})}
						</div>
						<div className="flex max-w-md gap-2">
							<Input
								value={drafts[dimension]}
								onChange={(event) =>
									setDrafts((current) => ({
										...current,
										[dimension]: event.target.value,
									}))
								}
								onKeyDown={(event) => {
									if (event.key !== 'Enter') return
									event.preventDefault()
									addValue(dimension)
								}}
								placeholder={`Add ${label.toLowerCase()}`}
								aria-label={`Add ${label.toLowerCase()}`}
								aria-invalid={errors[dimension] ? true : undefined}
							/>
							<Button
								type="button"
								variant="outline"
								onClick={() => addValue(dimension)}
							>
								Add
							</Button>
						</div>
						{errors[dimension] && (
							<p className="text-destructive text-sm" role="alert">
								{errors[dimension]}
							</p>
						)}
					</fieldset>
				)
			})}
		</div>
	)
}
