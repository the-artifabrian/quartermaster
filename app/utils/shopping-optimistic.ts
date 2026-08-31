import { type ShoppingListItem } from '#app/generated/prisma/client.ts'
import { NEXT_SHOP, type ShoppingHorizon } from '#app/utils/shopping-horizon.ts'
import { guessCategory } from '#app/utils/shopping-list-validation.ts'

const normalizeName = (name: string) => name.toLowerCase().trim()

/**
 * What a Shopping row shows as its quantity line (#109): the row's own
 * quantity grouped for display with its current Meal contributions, computed
 * server-side by combineRowDisplay. `combined` marks a number the stored row
 * alone would not explain (manual + meal demand, or several Meals summed) so
 * the UI can say the total includes planned meals. Neither the row nor any
 * contribution is rewritten.
 */
export type ShoppingItemDisplay = {
	quantity: string | null
	unit: string | null
	combined: boolean
}

export type DisplayShoppingItem = ShoppingListItem & {
	display: ShoppingItemDisplay
}

/**
 * Build a temporary ShoppingListItem for optimistically rendering an in-flight
 * `add` / `bulk-add`. The id is a stable, non-cuid sentinel so it works as a
 * React key and can never collide with a real row; once the real item arrives
 * via revalidation the merge below dedups this temp away by name.
 */
export function makeOptimisticShoppingItem({
	name,
	quantity,
	unit,
	listId,
	horizon = NEXT_SHOP,
}: {
	name: string
	quantity?: string | null
	unit?: string | null
	listId: string
	horizon?: ShoppingHorizon
}): DisplayShoppingItem {
	const trimmedQuantity = quantity?.trim() ? quantity.trim() : null
	const trimmedUnit = unit?.trim() ? unit.trim() : null
	return {
		id: `optimistic:${normalizeName(name)}`,
		name,
		quantity: trimmedQuantity,
		unit: trimmedUnit,
		category: guessCategory(name),
		checked: false,
		source: 'manual',
		horizon,
		listId,
		createdAt: new Date(),
		// A just-typed row has no contributions yet — it displays itself.
		display: { quantity: trimmedQuantity, unit: trimmedUnit, combined: false },
	}
}

/**
 * Merge optimistic added items into the real (loader) list:
 *  - drops any optimistic item whose name already exists server-side (prevents a
 *    duplicate row in the window where both the temp and the just-revalidated
 *    real item are briefly present),
 *  - dedups optimistic items against each other by name,
 *  - inserts the survivors at the end of the unchecked group, mirroring the
 *    loader's [checked asc, name asc] ordering WITHOUT re-sorting the real rows
 *    (avoids a visible reorder from a localeCompare-vs-SQLite collation mismatch;
 *    the new item settles into its alphabetical slot on the next revalidation).
 */
export function mergeOptimisticShoppingItems<T extends ShoppingListItem>(
	realItems: T[],
	pendingItems: T[],
): T[] {
	if (pendingItems.length === 0) return realItems

	const realNames = new Set(realItems.map((i) => normalizeName(i.name)))
	const seen = new Set<string>()
	const optimistic = pendingItems.filter((p) => {
		const key = normalizeName(p.name)
		if (!key || realNames.has(key) || seen.has(key)) return false
		seen.add(key)
		return true
	})
	if (optimistic.length === 0) return realItems

	const firstCheckedIdx = realItems.findIndex((i) => i.checked)
	if (firstCheckedIdx === -1) return [...realItems, ...optimistic]
	return [
		...realItems.slice(0, firstCheckedIdx),
		...optimistic,
		...realItems.slice(firstCheckedIdx),
	]
}
