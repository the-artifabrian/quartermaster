import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import { type EnhanceableFields } from '#app/utils/recipe-enhance-llm.server.ts'
import { useModal } from '#app/utils/use-modal.ts'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

type RecipeData = {
	id: string
	description: string | null
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
	const hasAnyChange = hasDescriptionChange

	// Checkbox state: missing fields pre-checked, existing fields unchecked
	const [checked, setChecked] = useState(
		hasDescriptionChange && !recipe.description,
	)
	const dialogRef = useModal(onClose)

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

	function handleApply() {
		const formData = new FormData()
		formData.set('intent', 'applyEnhancement')

		if (checked && suggestions.description) {
			formData.set('enhance_description', suggestions.description)
		}

		void fetcher.submit(formData, {
			method: 'POST',
			action: `/recipes/${recipe.id}`,
		})
	}

	return (
		<div
			ref={dialogRef}
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
			<div className="bg-card shadow-warm-lg relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-xl p-6 sm:rounded-xl">
				<div className="mb-1 flex items-center justify-between">
					<h2
						id="enhance-title"
						className="flex items-center gap-2 font-serif text-xl"
					>
						<Icon name="sparkles" className="text-accent size-5" />
						Enhance Recipe
					</h2>
					<button
						onClick={onClose}
						aria-label="Close"
						className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-md p-1 focus-visible:ring-2 focus-visible:outline-none"
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
									checked={checked}
									onToggle={() => setChecked((selected) => !selected)}
								/>
							)}
						</div>

						<div className="mt-5 flex gap-2">
							<Button
								onClick={handleApply}
								disabled={!checked || fetcher.state !== 'idle'}
								className="flex-1 gap-2"
							>
								{fetcher.state !== 'idle' ? (
									<>
										<Icon name="update" className="size-4 animate-spin" />
										Applying...
									</>
								) : (
									'Apply Selected'
								)}
							</Button>
							<Button type="button" variant="ghost" onClick={onClose}>
								Cancel
							</Button>
						</div>
					</>
				) : (
					<>
						<p className="text-muted-foreground mt-2 mb-5 text-sm">
							This recipe looks complete! No improvements suggested.
						</p>
						<Button variant="ghost" onClick={onClose} className="w-full">
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
					<span className="text-muted-foreground/70">Current:</span> {current}
				</p>
				<p className="text-primary mt-0.5 text-xs">
					<span className="text-primary/70">Suggested:</span> {suggested}
				</p>
			</div>
		</label>
	)
}
