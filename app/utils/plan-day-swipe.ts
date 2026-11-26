import { addDaysUTC, getWeekStart, parseDate, serializeDate } from './date.ts'

/** How far (px) a finger has to travel sideways before the day steps. */
const DAY_SWIPE_DISTANCE = 64
/** Sideways travel has to beat the vertical by this much. */
const DAY_SWIPE_SLANT = 1.5

/**
 * Where a sideways swipe on a phone's Plan day goes once the finger lifts:
 * 1 for the next day (a swipe to the left), -1 for the day before, 0 to stay.
 * A slanted drag, such as a scroll that drifts, stays.
 */
export function daySwipeStep(dx: number, dy: number): -1 | 0 | 1 {
	if (Math.abs(dx) < DAY_SWIPE_DISTANCE) return 0
	if (Math.abs(dx) < Math.abs(dy) * DAY_SWIPE_SLANT) return 0
	return dx < 0 ? 1 : -1
}

/**
 * The day one step from `selected`, and the week to load when that step
 * leaves the week showing (past Sunday, or before Monday).
 */
export function stepDay(
	weekDays: Date[],
	selected: string,
	step: 1 | -1,
): { day: string; weekStart: string | null } {
	const next = addDaysUTC(parseDate(selected), step)
	const day = serializeDate(next)
	const inWeek = weekDays.some((date) => serializeDate(date) === day)
	return {
		day,
		weekStart: inWeek ? null : serializeDate(getWeekStart(next)),
	}
}

/**
 * Whether a finger landing on `target` may step the day. Not from a field
 * (the scale field and the label that is its tap area), not from a picker
 * or form opened in place (`data-no-day-swipe`), and not from a sheet or
 * menu: React hands their events to the component that opened them, which
 * can sit inside the day, though they are elsewhere on the page.
 */
export function canStartDaySwipe(
	surface: Element,
	target: EventTarget | null,
): boolean {
	if (!(target instanceof Element) || !surface.contains(target)) return false
	return !target.closest(
		'input, textarea, select, label, [contenteditable], [data-no-day-swipe]',
	)
}

type PhotoMeal = {
	label: string | null
	/** The Meal's Recipes in the order they show. */
	items: Array<{
		id: string
		recipe: { image: { objectKey: string } | null } | null
	}>
}

/**
 * The photo a Dinner shows above its dishes on a phone: its first Recipe's,
 * when it has one. Rows removed with Undo still waiting don't count.
 */
export function mealPhoto(
	meal: PhotoMeal,
	hidden: { has: (id: string) => boolean },
) {
	if (meal.label !== 'dinner') return null
	const first = meal.items.find((item) => !hidden.has(item.id))
	return first?.recipe?.image?.objectKey ?? null
}
