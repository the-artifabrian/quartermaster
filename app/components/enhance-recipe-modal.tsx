import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import { type EnhanceableFields } from '#app/utils/recipe-enhance-llm.server.ts'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

type RecipeData = {
	id: string
	description: string | null
	servings: number
	prepTime: number | null
	cookTime: number | null
}

export function EnhanceRecipeModal({
	recipe,
	suggestions,
	onClose,
}: {
	recipe: RecipeData
	suggestions: EnhanceableFields
	onClose: () => void
}) {
	const fetcher = useFetcher({ key: 'apply-enhancement' })

	// Determine which fields have actual changes
	const hasDescriptionChange =
		suggestions.description !== null &&
		suggestions.description !== recipe.description
	const hasServingsChange =
		suggestions.servings !== null &&
		suggestions.servings !== recipe.servings
	const hasPrepTimeChange =
		suggestions.prepTime !== null &&
		suggestions.prepTime !== recipe.prepTime
	const hasCookTimeChange =
		suggestions.cookTime !== null &&
		suggestions.cookTime !== recipe.cookTime
	const hasAnyChange =
		hasDescriptionChange ||
		hasServingsChange ||
		hasPrepTimeChange ||
		hasCookTimeChange

	// Checkbox state: missing fields pre-checked, existing fields unchecked
	const [checked, setChecked] = useState(() => ({
		description: hasDescriptionChange && !recipe.description,
		servings: hasServingsChange && !recipe.servings,
		prepTime: hasPrepTimeChange && !recipe.prepTime,
		cookTime: hasCookTimeChange && !recipe.cookTime,
	}))
	// Close on escape
	useEffect(() => {
		function handleEscape(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', handleEscape)
		return () => document.removeEventListener('keydown', handleEscape)
	}, [onClose])

	// Close after successful apply (prevState ref prevents firing on mount with stale data)
	const prevApplyState = useRef(fetcher.state)
	useEffect(() => {
		if (
			prevApplyState.current !== 'idle' &&
			fetcher.state === 'idle' &&
			fetcher.data
		) {
			const result = fetcher.data as { success?: boolean }
			if (result.success) {
				toast.success('Recipe enhanced!')
				onClose()
			}
		}
		prevApplyState.current = fetcher.state
	}, [fetcher.state, fetcher.data, onClose])

	function toggleField(field: keyof typeof checked) {
		setChecked((prev) => ({ ...prev, [field]: !prev[field] }))
	}

	const hasAnySelected =
		checked.description ||
		checked.servings ||
		checked.prepTime ||
		checked.cookTime

	function handleApply() {
		const formData = new FormData()
		formData.set('intent', 'applyEnhancement')

		if (checked.description && suggestions.description) {
			formData.set('enhance_description', suggestions.description)
		}
		if (checked.servings && suggestions.servings) {
			formData.set('enhance_servings', suggestions.servings.toString())
		}
		if (checked.prepTime && suggestions.prepTime) {
			formData.set('enhance_prepTime', suggestions.prepTime.toString())
		}
		if (checked.cookTime && suggestions.cookTime) {
			formData.set('enhance_cookTime', suggestions.cookTime.toString())
		}

		void fetcher.submit(formData, {
			method: 'POST',
			action: `/recipes/${recipe.id}`,
		})
	}

	return (
		<div
			className="fixed inset-0 z-60 flex items-end justify-center sm:items-center"
			role="dialog"
			aria-modal="true"
			aria-labelledby="enhance-title"
		>
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
			/>
			{/* Modal */}
			<div className="bg-card shadow-warm-lg relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-6 sm:rounded-2xl">
				<div className="mb-1 flex items-center justify-between">
					<h2
						id="enhance-title"
						className="flex items-center gap-2 font-serif text-xl font-bold"
					>
						<Icon
							name="sparkles"
							className="size-5 text-violet-500"
						/>
						Enhance Recipe
					</h2>
					<button
						onClick={onClose}
						aria-label="Close"
						className="text-muted-foreground hover:text-foreground rounded-md p-1"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>

				{hasAnyChange ? (
					<>
						<p className="text-muted-foreground mb-4 text-sm">
							Review AI suggestions and select which to apply.
						</p>

						<div className="space-y-3">
							{hasDescriptionChange && (
								<FieldRow
									label="Description"
									current={recipe.description || '—'}
									suggested={suggestions.description!}
									checked={checked.description}
									onToggle={() => toggleField('description')}
								/>
							)}

							{hasServingsChange && (
								<FieldRow
									label="Servings"
									current={String(recipe.servings)}
									suggested={String(suggestions.servings)}
									checked={checked.servings}
									onToggle={() => toggleField('servings')}
								/>
							)}

							{hasPrepTimeChange && (
								<FieldRow
									label="Prep Time"
									current={
										recipe.prepTime
											? `${recipe.prepTime} min`
											: '—'
									}
									suggested={`${suggestions.prepTime} min`}
									checked={checked.prepTime}
									onToggle={() => toggleField('prepTime')}
								/>
							)}

							{hasCookTimeChange && (
								<FieldRow
									label="Cook Time"
									current={
										recipe.cookTime
											? `${recipe.cookTime} min`
											: '—'
									}
									suggested={`${suggestions.cookTime} min`}
									checked={checked.cookTime}
									onToggle={() => toggleField('cookTime')}
								/>
							)}
						</div>

						<div className="mt-5 flex gap-2">
							<Button
								onClick={handleApply}
								disabled={
									!hasAnySelected ||
									fetcher.state !== 'idle'
								}
								className="flex-1 gap-2"
							>
								{fetcher.state !== 'idle' ? (
									<>
										<Icon
											name="update"
											className="size-4 animate-spin"
										/>
										Applying...
									</>
								) : (
									'Apply Selected'
								)}
							</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={onClose}
							>
								Cancel
							</Button>
						</div>
					</>
				) : (
					<>
						<p className="text-muted-foreground mt-2 mb-5 text-sm">
							This recipe looks complete! No improvements
							suggested.
						</p>
						<Button
							variant="ghost"
							onClick={onClose}
							className="w-full"
						>
							Close
						</Button>
					</>
				)}
			</div>
		</div>
	)
}

function FieldRow({
	label,
	current,
	suggested,
	checked,
	onToggle,
}: {
	label: string
	current: string
	suggested: string
	checked: boolean
	onToggle: () => void
}) {
	return (
		<label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
			<input
				type="checkbox"
				checked={checked}
				onChange={onToggle}
				className="mt-0.5 size-4 shrink-0 rounded"
			/>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium">{label}</p>
				<p className="text-muted-foreground mt-0.5 text-xs">
					<span className="text-muted-foreground/70">Current:</span>{' '}
					{current}
				</p>
				<p className="mt-0.5 text-xs text-violet-600 dark:text-violet-400">
					<span className="text-violet-500/70 dark:text-violet-400/70">
						Suggested:
					</span>{' '}
					{suggested}
				</p>
			</div>
		</label>
	)
}
