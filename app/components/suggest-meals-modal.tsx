import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { addDaysUTC, formatDayLabel, parseDate } from '#app/utils/date.ts'
import { useModal } from '#app/utils/use-modal.ts'

type SuggestionReason = 'expiring' | 'favorite' | 'match'

type Suggestion = {
	recipe: {
		id: string
		title: string
		image: { objectKey: string } | null
	}
	reason: SuggestionReason
	expiringItems?: string[]
}

type PickerRecipe = {
	id: string
	title: string
	image: { objectKey: string } | null
}

type Selection = {
	recipeId: string
	title: string
	image: { objectKey: string } | null
	reason: SuggestionReason | 'manual'
}

const REASON_BADGES: Record<
	SuggestionReason,
	{ label: string; className: string }
> = {
	expiring: {
		label: 'Expiring',
		className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
	},
	favorite: {
		label: 'Favorite',
		className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
	},
	match: {
		label: 'Good match',
		className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
	},
}

export function SuggestMealsModal({
	weekStart,
	recipes,
	existingEntries,
	onClose,
}: {
	weekStart: string
	recipes: PickerRecipe[]
	existingEntries: Array<{ date: Date; mealType: string; recipe: { id: string } }>
	onClose: () => void
}) {
	const dialogRef = useModal(onClose)
	const suggestFetcher = useFetcher<{
		suggestions: Suggestion[]
		filledDays: number[]
	}>()
	const confirmFetcher = useFetcher<{
		status: string
		count: number
		weekStart: string
	}>()
	const prevConfirmState = useRef(confirmFetcher.state)

	const [selections, setSelections] = useState<Map<number, Selection>>(
		new Map(),
	)
	const [pickingDay, setPickingDay] = useState<number | null>(null)
	const [pickerSearch, setPickerSearch] = useState('')
	const [initialized, setInitialized] = useState(false)

	// Load suggestions on mount
	useEffect(() => {
		suggestFetcher.load(
			`/resources/meal-plan-suggest?weekStart=${weekStart}`,
		)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [weekStart])

	// Initialize selections from suggestions once loaded
	useEffect(() => {
		if (initialized) return
		if (suggestFetcher.state !== 'idle' || !suggestFetcher.data) return

		const { suggestions, filledDays } = suggestFetcher.data
		const filledSet = new Set(filledDays)
		const newSelections = new Map<number, Selection>()

		// Assign suggestions to empty days (0=Mon through 6=Sun)
		let suggestionIdx = 0
		for (let day = 0; day < 7; day++) {
			if (filledSet.has(day)) continue
			if (suggestionIdx >= suggestions.length) break
			const s = suggestions[suggestionIdx]!
			newSelections.set(day, {
				recipeId: s.recipe.id,
				title: s.recipe.title,
				image: s.recipe.image,
				reason: s.reason,
			})
			suggestionIdx++
		}

		setSelections(newSelections)
		setInitialized(true)
	}, [suggestFetcher.state, suggestFetcher.data, initialized])

	// Handle successful confirm
	useEffect(() => {
		if (
			prevConfirmState.current !== 'idle' &&
			confirmFetcher.state === 'idle' &&
			confirmFetcher.data?.status === 'success'
		) {
			const count = confirmFetcher.data.count
			toast.success(`Added ${count} meal${count !== 1 ? 's' : ''} to your plan`, {
				action: {
					label: 'Generate shopping list \u2192',
					onClick: () => {
						window.location.href = `/shopping?weekStart=${weekStart}`
					},
				},
			})
			onClose()
		}
		prevConfirmState.current = confirmFetcher.state
	}, [confirmFetcher.state, confirmFetcher.data, onClose, weekStart])

	const isLoading = suggestFetcher.state !== 'idle'
	const isSubmitting = confirmFetcher.state !== 'idle'
	const filledDays = new Set(suggestFetcher.data?.filledDays ?? [])

	// Count stats for footer
	const selectionCount = selections.size
	const expiringCount = [...selections.values()].filter(
		(s) => s.reason === 'expiring',
	).length

	// Build recipeIds array for POST
	function handleConfirm() {
		const recipeIds: Array<string | null> = []
		for (let i = 0; i < 7; i++) {
			const sel = selections.get(i)
			recipeIds.push(sel?.recipeId ?? null)
		}

		const formData = new FormData()
		formData.set('weekStart', weekStart)
		formData.set('recipeIds', JSON.stringify(recipeIds))
		confirmFetcher.submit(formData, {
			method: 'POST',
			action: '/resources/meal-plan-suggest',
		})
	}

	function removeDay(day: number) {
		setSelections((prev) => {
			const next = new Map(prev)
			next.delete(day)
			return next
		})
	}

	function selectRecipe(day: number, recipe: PickerRecipe) {
		setSelections((prev) => {
			const next = new Map(prev)
			next.set(day, {
				recipeId: recipe.id,
				title: recipe.title,
				image: recipe.image,
				reason: 'manual',
			})
			return next
		})
		setPickingDay(null)
		setPickerSearch('')
	}

	// Get the week date for a day index
	const weekStartDate = parseDate(weekStart)

	// Filter recipes for picker: exclude already-selected and already-planned
	const selectedRecipeIds = new Set([...selections.values()].map((s) => s.recipeId))
	const plannedRecipeIds = new Set(existingEntries.map((e) => e.recipe.id))
	const filteredRecipes = recipes.filter((r) => {
		if (selectedRecipeIds.has(r.id) || plannedRecipeIds.has(r.id)) return false
		if (pickerSearch) {
			return r.title.toLowerCase().includes(pickerSearch.toLowerCase())
		}
		return true
	})

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
			role="dialog"
			aria-modal="true"
			aria-labelledby="suggest-modal-title"
		>
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
			/>
			<div className="bg-card shadow-warm-lg relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl sm:max-h-[85vh] sm:rounded-2xl">
				{/* Header */}
				<div className="flex items-center justify-between border-b p-4 pb-3">
					<h2 id="suggest-modal-title" className="font-serif text-xl">
						Plan This Week
					</h2>
					<button
						onClick={onClose}
						aria-label="Close"
						className="text-muted-foreground hover:text-foreground rounded-md p-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>

				{/* Body */}
				<div className="flex-1 overflow-y-auto p-4">
					{isLoading ? (
						<div className="flex flex-col items-center justify-center py-12">
							<Icon name="update" size="md" className="text-muted-foreground animate-spin" />
							<p className="text-muted-foreground mt-2 text-sm">Finding recipes...</p>
						</div>
					) : pickingDay !== null ? (
						/* Inline recipe picker */
						<div>
							<div className="mb-3 flex items-center gap-2">
								<button
									onClick={() => {
										setPickingDay(null)
										setPickerSearch('')
									}}
									className="text-muted-foreground hover:text-foreground rounded-md p-1"
								>
									<Icon name="arrow-left" size="sm" />
								</button>
								<span className="font-medium">
									Pick for{' '}
									{formatDayLabel(addDaysUTC(weekStartDate, pickingDay))}
								</span>
							</div>
							<input
								type="text"
								value={pickerSearch}
								onChange={(e) => setPickerSearch(e.target.value)}
								placeholder="Search recipes..."
								autoFocus
								className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring mb-3 flex h-9 w-full rounded-lg border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
							/>
							<div className="space-y-1">
								{filteredRecipes.length === 0 ? (
									<p className="text-muted-foreground py-4 text-center text-sm">
										No recipes found
									</p>
								) : (
									filteredRecipes.slice(0, 20).map((recipe) => (
										<button
											key={recipe.id}
											onClick={() => selectRecipe(pickingDay, recipe)}
											className="hover:bg-secondary/50 flex w-full items-center gap-3 rounded-lg p-2 text-left"
										>
											{recipe.image ? (
												<img
													src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`}
													alt=""
													className="h-8 w-8 rounded object-cover"
												/>
											) : (
												<div className="bg-secondary flex h-8 w-8 items-center justify-center rounded">
													<Icon name="pencil-1" size="sm" className="text-muted-foreground" />
												</div>
											)}
											<span className="truncate text-sm">{recipe.title}</span>
										</button>
									))
								)}
							</div>
						</div>
					) : (
						/* Day rows */
						<div className="space-y-2">
							{Array.from({ length: 7 }, (_, i) => {
								const dayDate = addDaysUTC(weekStartDate, i)
								const isFilled = filledDays.has(i)
								const selection = selections.get(i)

								return (
									<div
										key={i}
										className={`flex items-center gap-3 rounded-xl p-2.5 ${
											isFilled
												? 'bg-secondary/20 opacity-60'
												: 'bg-secondary/30'
										}`}
									>
										{/* Day label */}
										<div className="w-16 shrink-0 text-sm font-medium">
											{formatDayLabel(dayDate)}
										</div>

										{/* Content */}
										<div className="min-w-0 flex-1">
											{isFilled ? (
												<span className="text-muted-foreground text-sm italic">
													Already planned
												</span>
											) : selection ? (
												<div className="flex items-center gap-2">
													{selection.image ? (
														<img
															src={`/resources/images?objectKey=${encodeURIComponent(selection.image.objectKey)}`}
															alt=""
															className="h-8 w-8 shrink-0 rounded object-cover"
														/>
													) : null}
													<span className="truncate text-sm font-medium">
														{selection.title}
													</span>
													{selection.reason !== 'manual' && (
														<span
															className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${REASON_BADGES[selection.reason].className}`}
														>
															{REASON_BADGES[selection.reason].label}
														</span>
													)}
												</div>
											) : (
												<button
													onClick={() => setPickingDay(i)}
													className="text-muted-foreground hover:text-foreground text-sm"
												>
													+ Pick a recipe
												</button>
											)}
										</div>

										{/* Actions */}
										{!isFilled && selection ? (
											<div className="flex shrink-0 gap-1">
												<button
													onClick={() => setPickingDay(i)}
													aria-label="Change recipe"
													className="text-muted-foreground hover:text-foreground rounded-md p-1"
												>
													<Icon name="pencil-1" size="sm" />
												</button>
												<button
													onClick={() => removeDay(i)}
													aria-label="Remove"
													className="text-muted-foreground hover:text-foreground rounded-md p-1"
												>
													<Icon name="cross-1" size="sm" />
												</button>
											</div>
										) : !isFilled && !selection ? (
											<button
												onClick={() => setPickingDay(i)}
												aria-label="Pick recipe"
												className="text-muted-foreground hover:text-foreground rounded-md p-1"
											>
												<Icon name="plus" size="sm" />
											</button>
										) : null}
									</div>
								)
							})}
						</div>
					)}
				</div>

				{/* Footer */}
				{pickingDay === null && !isLoading && (
					<div className="border-t p-4 pt-3">
						<p className="text-muted-foreground mb-3 text-center text-xs">
							{selectionCount} meal{selectionCount !== 1 ? 's' : ''}
							{expiringCount > 0
								? ` \u00b7 ${expiringCount} use${expiringCount !== 1 ? '' : 's'} expiring ingredients`
								: ''}
						</p>
						<div className="flex gap-2">
							<Button
								className="flex-1"
								disabled={selectionCount === 0 || isSubmitting}
								onClick={handleConfirm}
							>
								{isSubmitting ? (
									<Icon name="update" size="sm" className="animate-spin" />
								) : (
									<Icon name="check" size="sm" />
								)}
								Fill Plan
							</Button>
							<Button variant="ghost" onClick={onClose}>
								Cancel
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
