import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import type { SubtractionSummary } from '#app/utils/inventory-subtract.server.ts'

type UncookedEntry = {
	entryId: string
	recipeId: string
	recipeTitle: string
	date: string
	mealType: string
	servings: number | null
}

type LoaderData = {
	entries: UncookedEntry[]
}

type CookResult = {
	status: 'success'
	recipeTitle: string
	inventorySummary: SubtractionSummary
}

function formatEntryContext(entry: UncookedEntry): string {
	const now = new Date()
	// Use local date components to match server's serializeDate (date-fns format)
	const pad = (n: number) => String(n).padStart(2, '0')
	const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
	const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
	const yesterdayStr = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`

	if (entry.date === yesterdayStr) return 'yesterday'
	if (entry.date === todayStr) return 'today'
	return entry.date
}

export function UncookedMealReminder() {
	const loadFetcher = useFetcher<LoaderData>()
	const cookFetcher = useFetcher<CookResult>()
	const [skipped, setSkipped] = useState<Set<string>>(new Set())
	const [cooked, setCooked] = useState<Set<string>>(new Set())
	const hasLoaded = useRef(false)

	// Load uncooked meals on mount
	useEffect(() => {
		if (!hasLoaded.current) {
			hasLoaded.current = true
			void loadFetcher.load('/resources/uncooked-meals')
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	// Handle cook success
	useEffect(() => {
		if (cookFetcher.data?.status === 'success') {
			const { recipeTitle, inventorySummary } = cookFetcher.data
			const parts: string[] = []
			if (inventorySummary.updated.length > 0) {
				parts.push(`Updated: ${inventorySummary.updated.join(', ')}`)
			}
			if (inventorySummary.removed.length > 0) {
				parts.push(`Removed: ${inventorySummary.removed.join(', ')}`)
			}
			if (inventorySummary.flaggedLow.length > 0) {
				parts.push(`Low stock: ${inventorySummary.flaggedLow.join(', ')}`)
			}
			toast.success(`Marked "${recipeTitle}" as cooked`, {
				description:
					parts.length > 0 ? parts.join('. ') : 'Inventory updated.',
				duration: 5000,
			})
		}
	}, [cookFetcher.data])

	const entries = loadFetcher.data?.entries ?? []
	const visibleEntries = entries.filter(
		(e) => !skipped.has(e.entryId) && !cooked.has(e.entryId),
	)

	if (visibleEntries.length === 0) return null

	const current = visibleEntries[0]!
	const isCooking = cookFetcher.state !== 'idle'
	const context = formatEntryContext(current)

	return (
		<div className="border-b border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/40">
			<div className="container flex items-center gap-3 py-2.5">
				<Icon
					name="cookie"
					className="hidden size-5 shrink-0 text-amber-600 sm:block dark:text-amber-400"
				/>
				<p className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-200">
					Did you make{' '}
					<span className="font-semibold">{current.recipeTitle}</span>{' '}
					{context}?
				</p>
				<div className="flex shrink-0 items-center gap-2">
					<Button
						size="sm"
						variant="outline"
						className="h-7 border-amber-300 bg-amber-100/50 text-xs text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
						disabled={isCooking}
						onClick={() => {
							setCooked((prev) => new Set(prev).add(current.entryId))
							void cookFetcher.submit(
								{ entryId: current.entryId },
								{ method: 'POST', action: '/resources/quick-cook' },
							)
						}}
					>
						{isCooking ? 'Saving...' : 'Yes, I made it'}
					</Button>
					<button
						type="button"
						className="rounded-md p-1 text-amber-600 transition-colors hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
						aria-label="Skip this reminder"
						onClick={() =>
							setSkipped((prev) => new Set(prev).add(current.entryId))
						}
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>
			</div>
		</div>
	)
}
