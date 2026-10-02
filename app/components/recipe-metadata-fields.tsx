import { useEffect, useMemo, useRef, useState } from 'react'
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
import { Icon } from './ui/icon.tsx'
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

const chipClassName =
	'flex min-h-10 items-center rounded-full border px-3 text-sm transition-colors'

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
	// One group adds at a time, so the draft and its error belong to the
	// open input rather than to every group.
	const [adding, setAdding] = useState<RecipeMetadataDimension | null>(null)
	const [draft, setDraft] = useState('')
	const [error, setError] = useState<string | null>(null)
	const addButtons = useRef<
		Partial<Record<RecipeMetadataDimension, HTMLButtonElement | null>>
	>({})
	// The Add chip only mounts once its input is gone, so a keyboard close
	// hands focus back after that render.
	const focusAfterClose = useRef<RecipeMetadataDimension | null>(null)

	useEffect(() => {
		const dimension = focusAfterClose.current
		if (!dimension) return
		focusAfterClose.current = null
		addButtons.current[dimension]?.focus()
	})

	function toggle(key: string) {
		setSelected((current) => {
			const next = new Set(current)
			if (next.has(key)) next.delete(key)
			else next.add(key)
			return next
		})
	}

	function openAdd(dimension: RecipeMetadataDimension) {
		setAdding(dimension)
		setDraft('')
		setError(null)
	}

	function closeAdd({ restoreFocus = false } = {}) {
		if (restoreFocus) focusAfterClose.current = adding
		setAdding(null)
		setDraft('')
		setError(null)
	}

	/** Adds the draft to its group. Returns false when the name is rejected. */
	function commitDraft(dimension: RecipeMetadataDimension) {
		const parsed = RecipeMetadataNameSchema.safeParse(draft)
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? 'Enter a name')
			return false
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
		setDraft('')
		setError(null)
		return true
	}

	const draftIsBlank = draft.trim() === ''

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
		<div className="space-y-4">
			<input type="hidden" name="recipeMetadata" value={serializedSelection} />
			{RECIPE_METADATA_DIMENSIONS.map((dimension) => {
				const label = RECIPE_METADATA_LABELS[dimension]
				const addLabel = `Add ${label.toLowerCase()}`
				const chips = [
					...groupedOptions[dimension].map((option) => ({
						key: option.id,
						name: option.name,
					})),
					...newOptions[dimension].map((option) => ({
						key: customOptionKey(dimension, option.nameKey),
						name: option.name,
					})),
				]
				return (
					<fieldset key={dimension} className="space-y-2">
						<legend className="text-sm font-medium">{label}</legend>
						<div className="flex flex-wrap items-center gap-2">
							{chips.map((chip) => (
								<button
									key={chip.key}
									type="button"
									aria-pressed={selected.has(chip.key)}
									onClick={() => toggle(chip.key)}
									className={cn(
										chipClassName,
										selected.has(chip.key)
											? 'border-primary bg-primary text-primary-foreground'
											: 'border-border bg-background hover:bg-muted',
									)}
								>
									{chip.name}
								</button>
							))}
							{adding === dimension ? (
								<Input
									autoFocus
									enterKeyHint="done"
									value={draft}
									onChange={(event) => setDraft(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === 'Escape') {
											event.preventDefault()
											closeAdd({ restoreFocus: true })
											return
										}
										if (event.key !== 'Enter') return
										event.preventDefault()
										if (draftIsBlank) closeAdd({ restoreFocus: true })
										else commitDraft(dimension)
									}}
									onBlur={(event) => {
										// Tapping away keeps what was typed; an empty input
										// just folds back into the chip. A blur that comes from
										// the input leaving the page (Escape already closed it)
										// must not resurrect the cancelled name.
										if (!event.currentTarget.isConnected) return
										if (draftIsBlank || commitDraft(dimension)) closeAdd()
									}}
									placeholder={addLabel}
									aria-label={addLabel}
									aria-invalid={error ? true : undefined}
									className="w-44 rounded-full px-4"
								/>
							) : (
								<button
									ref={(element) => {
										addButtons.current[dimension] = element
									}}
									type="button"
									aria-label={addLabel}
									onClick={() => openAdd(dimension)}
									className={cn(
										chipClassName,
										'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground gap-1 border-dashed',
									)}
								>
									<Icon name="plus" size="sm" />
									Add
								</button>
							)}
						</div>
						{adding === dimension && error && (
							<p className="text-destructive text-sm" role="alert">
								{error}
							</p>
						)}
					</fieldset>
				)
			})}
		</div>
	)
}
