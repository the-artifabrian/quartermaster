import { isValidTimeZone } from './serving-time.ts'

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

const FULL_DAY_NAMES = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
] as const

/** Full weekday name like "Thursday" using UTC fields. */
export function formatWeekdayName(date: Date): string {
	return FULL_DAY_NAMES[date.getUTCDay()]!
}

/** Format like "Sat 26" using UTC fields: the day as a list heading reads it. */
export function formatShortDay(date: Date): string {
	return `${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()}`
}

/** Format like "Jun 11" using UTC fields. */
export function formatMonthDay(date: Date): string {
	return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}`
}

/**
 * Format like "Feb 9 – 15" (this year) or "Feb 9 – 15, 2025" (other years).
 * `today` is the user's `yyyy-MM-dd` (see `todayInTimeZone`), so the year
 * shown follows their calendar, not the server's.
 */
export function formatWeekRange(weekStart: Date, today: string): string {
	const weekEnd = getWeekEnd(weekStart)
	const startMonth = MONTH_NAMES[weekStart.getUTCMonth()]
	const endPart =
		weekStart.getUTCMonth() !== weekEnd.getUTCMonth()
			? `${MONTH_NAMES[weekEnd.getUTCMonth()]} ${weekEnd.getUTCDate()}`
			: `${weekEnd.getUTCDate()}`
	const currentYear = Number(today.slice(0, 4))
	const spansYearBoundary =
		weekStart.getUTCFullYear() !== weekEnd.getUTCFullYear()
	const showYear = spansYearBoundary || weekEnd.getUTCFullYear() !== currentYear
	return `${startMonth} ${weekStart.getUTCDate()} – ${endPart}${showYear ? `, ${weekEnd.getUTCFullYear()}` : ''}`
}

/**
 * The calendar day a clock in `timeZone` shows at `now`, as `yyyy-MM-dd`: the
 * user's "today". Stored days are UTC calendar days (UTC midnight), so this
 * string compares straight against `serializeDate` of one.
 *
 * Loaders compute it once per request from the browser's timezone hint and
 * pass it down, so the server and the browser draw the same Today. An unknown
 * or missing zone counts as UTC.
 */
export function todayInTimeZone(
	timeZone: string | null | undefined,
	now: Date = new Date(),
): string {
	const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC'
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(now)
	const get = (type: string) =>
		parts.find((part) => part.type === type)?.value ?? ''
	return `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`
}

/** True when the stored day (UTC midnight) is `today`, a `yyyy-MM-dd`. */
export function isToday(date: Date, today: string): boolean {
	return serializeDate(date) === today
}

/** True when the stored day (UTC midnight) is before `today`, a `yyyy-MM-dd`. */
export function isPast(date: Date, today: string): boolean {
	return serializeDate(date) < today
}

/** Serialize to `yyyy-MM-dd` using UTC fields. */
export function serializeDate(date: Date): string {
	return date.toISOString().slice(0, 10)
}

/** Parse `yyyy-MM-dd` → UTC midnight Date. */
export function parseDate(dateString: string): Date {
	return new Date(dateString + 'T00:00:00.000Z')
}

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealType = (typeof MEAL_TYPES)[number]

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
	breakfast: 'Breakfast',
	lunch: 'Lunch',
	dinner: 'Dinner',
	snack: 'Snack',
}
