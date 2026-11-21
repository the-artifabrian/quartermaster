/**
 * Edit forms for Recipes and Menus post the rows they show by id, plus the
 * ids of the rows they loaded. A Save then removes only rows the editor saw
 * and took out, so a row another member added while the form was open stays.
 */

/**
 * The row ids an edit form loaded, posted as a JSON list in `field`. Null
 * when the field is missing, as from a page loaded before forms sent it:
 * the Save then treats every stored row as seen, as it always did.
 */
export function readLoadedIds(formData: FormData, field: string) {
	const value = formData.get(field)
	if (value === null) return null
	let parsed: unknown = null
	try {
		parsed = typeof value === 'string' ? JSON.parse(value) : null
	} catch {
		// Unreadable: nothing counts as seen, so nothing is removed.
	}
	return new Set(
		Array.isArray(parsed)
			? parsed.filter((id): id is string => typeof id === 'string')
			: [],
	)
}

/**
 * Pairs posted rows with stored ones by id. A posted id that isn't one of
 * `stored` (another Recipe's or Menu's row, or one deleted meanwhile), or
 * that an earlier posted row already took, pairs with nothing, so that row
 * saves as a new one and never changes a row elsewhere.
 *
 * Of the stored rows nothing paired with, `removed` are the ones the form
 * loaded and `unseen` are the ones added after it loaded.
 */
export function matchRows<Stored extends { id: string }>(
	stored: Stored[],
	postedIds: Array<string | null | undefined>,
	loadedIds: Set<string> | null,
) {
	const storedById = new Map(stored.map((row) => [row.id, row]))
	const paired = new Set<string>()
	const matches = postedIds.map((id) => {
		const row = id == null ? undefined : storedById.get(id)
		if (!row || paired.has(row.id)) return null
		paired.add(row.id)
		return row
	})
	const left = stored.filter((row) => !paired.has(row.id))
	const seen = loadedIds ?? new Set(storedById.keys())
	return {
		matches,
		removed: left.filter((row) => seen.has(row.id)),
		unseen: left.filter((row) => !seen.has(row.id)),
	}
}

/** The posted value as JSON, for an edit form's loaded-ids field. */
export function loadedIdsValue(rows: Array<{ id: string }>) {
	return JSON.stringify(rows.map((row) => row.id))
}
