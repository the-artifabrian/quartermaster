/**
 * Shopping rows whose own amount is something a person asked for, typed in
 * Shopping ('manual') or added from a Recipe's ingredient list ('recipe').
 * Meal demand that joins one of these rows adds to that amount on display,
 * an edit changes only the row's own amount, and "Remove generated amount"
 * takes the Meal share off again.
 */
export const OWN_AMOUNT_SOURCES = ['manual', 'recipe'] as const

export function keepsOwnAmount(source: string) {
	return (OWN_AMOUNT_SOURCES as readonly string[]).includes(source)
}
