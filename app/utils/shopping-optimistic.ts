import { type ShoppingListItem } from '#app/generated/prisma/client.ts'
import { guessCategory } from '#app/utils/shopping-list-validation.ts'

const normalizeName = (name: string) => name.toLowerCase().trim()

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
}: {
	name: string
	quantity?: string | null
	unit?: string | null
	listId: string
}): ShoppingListItem {
	return {
		id: `optimistic:${normalizeName(name)}`,
		name,
		quantity: quantity?.trim() ? quantity.trim() : null,
		unit: unit?.trim() ? unit.trim() : null,
		category: guessCategory(name),
		checked: false,
		source: 'manual',
		listId,
		createdAt: new Date(),
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
export function mergeOptimisticShoppingItems(
	realItems: ShoppingListItem[],
	pendingItems: ShoppingListItem[],
): ShoppingListItem[] {
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
