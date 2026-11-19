export type RowErrors = Record<string, string[]>

/**
 * Splits a form's errors (Conform's `allErrors`, keyed by field name) for one
 * list field: the list's own errors ("Add at least one ingredient.") and each
 * row's, by index and then by the row's field name (`''` for the whole row).
 */
export function listErrors(
	allErrors: Record<string, string[] | undefined>,
	list: string,
): { list: string[] | undefined; rows: Array<RowErrors | undefined> } {
	const rows: Array<RowErrors | undefined> = []
	let own: string[] | undefined
	const prefix = `${list}[`
	for (const [name, errors] of Object.entries(allErrors)) {
		if (!errors?.length) continue
		if (name === list) {
			own = errors
			continue
		}
		if (!name.startsWith(prefix)) continue
		const match = /^(\d+)\](?:\.(.+))?$/.exec(name.slice(prefix.length))
		if (!match) continue
		const index = Number(match[1])
		const row = (rows[index] ??= {})
		row[match[2] ?? ''] = errors
	}
	return { list: own, rows }
}
