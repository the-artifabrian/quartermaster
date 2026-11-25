// Rows from adds still in flight, shown before the server answers.
import { useFetchers } from 'react-router'
import { parseShoppingHorizon } from '#app/utils/shopping-horizon.ts'
import {
	type DisplayShoppingItem,
	makeOptimisticShoppingItem,
} from '#app/utils/shopping-optimistic.ts'

/**
 * Optimistically render items from in-flight `add` / `bulk-add` submissions so a
 * newly added item appears instantly instead of waiting for the server round-trip
 * + revalidation. Reads every shopping fetcher via useFetchers, so it captures all
 * add entry points at once (desktop quick-add, mobile FAB, voice bulk-add). Items
 * show only while the fetcher is non-idle; by the time it returns to idle the
 * fetcher's own revalidation has landed the real row, and the merge dedups by name
 * to avoid a duplicate during any overlap (e.g. a concurrent SSE revalidation).
 */
export function usePendingShoppingItems(listId: string): DisplayShoppingItem[] {
	const fetchers = useFetchers()
	const pending: DisplayShoppingItem[] = []
	for (const fetcher of fetchers) {
		if (fetcher.state === 'idle' || !fetcher.formData) continue
		const intent = fetcher.formData.get('intent')
		if (intent === 'add') {
			const name = String(fetcher.formData.get('name') ?? '')
			if (!name.trim()) continue
			pending.push(
				makeOptimisticShoppingItem({
					name,
					quantity: fetcher.formData.get('quantity') as string | null,
					unit: fetcher.formData.get('unit') as string | null,
					listId,
					horizon: parseShoppingHorizon(fetcher.formData.get('horizon')),
				}),
			)
		} else if (intent === 'bulk-add') {
			const raw = fetcher.formData.get('items')
			const horizon = parseShoppingHorizon(fetcher.formData.get('horizon'))
			if (typeof raw !== 'string') continue
			try {
				const items = JSON.parse(raw) as Array<{
					name?: string
					quantity?: string
					unit?: string
				}>
				for (const item of items) {
					if (!item?.name?.trim()) continue
					pending.push(
						makeOptimisticShoppingItem({
							name: item.name,
							quantity: item.quantity ?? null,
							unit: item.unit ?? null,
							listId,
							horizon,
						}),
					)
				}
			} catch {
				// Ignore malformed bulk payloads. The server rejects them too.
			}
		}
	}
	return pending
}
