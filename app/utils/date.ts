const DAY_MS = 86_400_000

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH_NAMES = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
] as const

/** Add `n` days using UTC-safe millisecond arithmetic. */
export function addDaysUTC(date: Date, n: number): Date {
	return new Date(date.getTime() + n * DAY_MS)
}

export function getCurrentWeekStart(): Date {
	return getWeekStart(new Date())
}

/** Return UTC midnight of the Monday at-or-before `date`. */
export function getWeekStart(date: Date): Date {
	const d = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	)
	// getUTCDay(): 0=Sun … 6=Sat → offset to Monday
	const day = d.getUTCDay()
	const diff = day === 0 ? 6 : day - 1
	d.setUTCDate(d.getUTCDate() - diff)
	return d
}

/** UTC midnight of Sunday (weekStart + 6 days). */
export function getWeekEnd(weekStart: Date): Date {
	return addDaysUTC(weekStart, 6)
}

/** Return 7 UTC-midnight dates, Monday through Sunday. */
export function getWeekDays(weekStart: Date): Date[] {
	return Array.from({ length: 7 }, (_, i) => addDaysUTC(weekStart, i))
}

export function getNextWeek(weekStart: Date): Date {
	return addDaysUTC(weekStart, 7)
}

export function getPreviousWeek(weekStart: Date): Date {
	return addDaysUTC(weekStart, -7)
}

/** Format like "Mon 2/9" using UTC fields. */
export function formatDayLabel(date: Date): string {
	const day = DAY_NAMES[date.getUTCDay()]
	return `${day} ${date.getUTCMonth() + 1}/${date.getUTCDate()}`
}

/** Format like "Feb 9 - 15, 2026" using UTC fields. */
export function formatWeekRange(weekStart: Date): string {
	const weekEnd = getWeekEnd(weekStart)
	const startMonth = MONTH_NAMES[weekStart.getUTCMonth()]
	return `${startMonth} ${weekStart.getUTCDate()} - ${weekEnd.getUTCDate()}, ${weekEnd.getUTCFullYear()}`
}

/**
 * Compare a stored UTC semantic date with the user's local "today".
 *
 * Stored dates encode their semantic day in UTC fields (`getUTCDate()`), while
 * "today" is the user's local date. This cross-domain comparison is intentional.
 */
export function isToday(date: Date): boolean {
	const now = new Date()
	return (
		date.getUTCFullYear() === now.getFullYear() &&
		date.getUTCMonth() === now.getMonth() &&
		date.getUTCDate() === now.getDate()
	)
}

/** Serialize to `yyyy-MM-dd` using UTC fields. */
export function serializeDate(date: Date): string {
	return date.toISOString().slice(0, 10)
}

/** Parse `yyyy-MM-dd` → UTC midnight Date. */
export function parseDate(dateString: string): Date {
	return new Date(dateString + 'T00:00:00.000Z')
}

export function formatTimeAgo(date: Date): string {
	const now = new Date()
	const diffMs = now.getTime() - date.getTime()
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

	if (diffDays === 0) return 'today'
	if (diffDays === 1) return 'yesterday'
	if (diffDays < 7) return `${diffDays} days ago`
	if (diffDays < 14) return '1 week ago'
	if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
	if (diffDays < 60) return '1 month ago'
	if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
	const years = Math.floor(diffDays / 365)
	return `${years} ${years === 1 ? 'year' : 'years'} ago`
}

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealType = (typeof MEAL_TYPES)[number]

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
	breakfast: 'Breakfast',
	lunch: 'Lunch',
	dinner: 'Dinner',
	snack: 'Snack',
}
