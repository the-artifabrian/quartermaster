/**
 * Toast copy for adding a Meal to Shopping and for Update Shopping. Kept
 * apart from the components so the wording can be tested.
 */

/** Rows that Meal demand joined without adding a row of its own. */
export function addedToExistingMessage(count: number) {
	return `Added to ${count} item${count === 1 ? '' : 's'} already on Shopping`
}

/**
 * Update Shopping left these checked rows alone. One row is named; a row
 * name ending in s (but not ss or us) reads as plural.
 */
export function skippedCheckedMessage(names: string[]) {
	if (names.length === 0) return null
	if (names.length > 1) {
		return `${names.length} items are already checked off, so they weren’t changed.`
	}
	const name = names[0]!.trim()
	const plural = /[^su]s$/i.test(name)
	const shown = name.charAt(0).toUpperCase() + name.slice(1)
	return plural
		? `${shown} are already checked off, so they weren’t changed.`
		: `${shown} is already checked off, so it wasn’t changed.`
}
