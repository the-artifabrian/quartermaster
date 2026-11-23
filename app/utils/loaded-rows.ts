/**
 * Edit forms for Recipes and Menus post the rows they show by id, plus the
 * ids of the rows they loaded and of the rows they added. A Save then
 * removes only rows the editor saw and took out, so a row another member
 * added while the form was open stays.
 */

/** The field every edit form posts the ids of the rows it added in. */
export const CREATED_IDS_FIELD = 'createdRowIds'

/**
 * The rows an edit form saw: the ones it loaded, and the ones it added.
 * A row it added may already be stored by an earlier Save whose answer was
 * lost; if the editor removed it since, the replay removes it too.
 */
export type SeenIds = { loaded: Set<string> | null; created: Set<string> }

/** The ids posted in `loadedField` and in the created-ids field. */
export function readSeenIds(formData: FormData, loadedField: string): SeenIds {
	return {
		loaded: readLoadedIds(formData, loadedField),
		created: readLoadedIds(formData, CREATED_IDS_FIELD) ?? new Set(),
	}
}

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
	seenIds: SeenIds,
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
	const seen = seenIds.loaded
		? new Set([...seenIds.loaded, ...seenIds.created])
		: new Set(storedById.keys())
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

/** The shape of `createId()`, which the forms give each row they add. */
const NEW_ROW_ID = /^[a-z][0-9a-z]{23}$/

/**
 * The posted ids a Save may use for the rows it adds: well formed, not
 * paired with a stored row, not one the form loaded, and once each. A
 * loaded row that was deleted meanwhile is saved again under a new id. The caller keeps only those no
 * row anywhere has yet (`existing`), and gives the other rows a fresh id.
 * A Save that reaches the server twice then pairs its new rows with the
 * rows the first one added, instead of adding them again.
 */
export function newRowIdCandidates(
	postedIds: Array<string | null | undefined>,
	matches: Array<unknown>,
	seenIds: SeenIds,
) {
	return postedIds.flatMap((id, index) =>
		id != null &&
		matches[index] == null &&
		NEW_ROW_ID.test(id) &&
		!seenIds.loaded?.has(id)
			? [id]
			: [],
	)
}

/** The id to create each unpaired posted row with, or undefined for fresh. */
export function newRowIds(
	postedIds: Array<string | null | undefined>,
	matches: Array<unknown>,
	seenIds: SeenIds,
	existing: Iterable<string>,
) {
	const taken = new Set(existing)
	const usable = new Set(newRowIdCandidates(postedIds, matches, seenIds))
	return postedIds.map((id, index) => {
		if (id == null || matches[index] != null || !usable.has(id))
			return undefined
		if (taken.has(id)) return undefined
		taken.add(id)
		return id
	})
}

/** Which of `ids` a row of this table already has, wherever it belongs. */
export async function existingIds(
	delegate: {
		findMany(args: {
			where: { id: { in: string[] } }
			select: { id: true }
		}): Promise<Array<{ id: string }>>
	},
	ids: string[],
) {
	if (ids.length === 0) return []
	const rows = await delegate.findMany({
		where: { id: { in: ids } },
		select: { id: true },
	})
	return rows.map((row) => row.id)
}
