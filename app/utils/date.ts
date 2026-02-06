import {
	startOfWeek,
	endOfWeek,
	eachDayOfInterval,
	format,
	addWeeks,
	subWeeks,
	startOfDay,
	isSameDay,
	parseISO,
} from 'date-fns'

export function getCurrentWeekStart(): Date {
	return startOfDay(startOfWeek(new Date(), { weekStartsOn: 1 }))
}

export function getWeekStart(date: Date): Date {
	return startOfDay(startOfWeek(date, { weekStartsOn: 1 }))
}

export function getWeekEnd(weekStart: Date): Date {
	return endOfWeek(weekStart, { weekStartsOn: 1 })
}

export function getWeekDays(weekStart: Date): Date[] {
	return eachDayOfInterval({
		start: weekStart,
		end: getWeekEnd(weekStart),
	})
}

export function getNextWeek(weekStart: Date): Date {
	return startOfDay(addWeeks(weekStart, 1))
}

export function getPreviousWeek(weekStart: Date): Date {
	return startOfDay(subWeeks(weekStart, 1))
}

export function formatDayLabel(date: Date): string {
	return format(date, 'EEE M/d') // "Mon 12/25"
}

export function formatWeekRange(weekStart: Date): string {
	const weekEnd = getWeekEnd(weekStart)
	return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'd, yyyy')}`
}

export function isToday(date: Date): boolean {
	return isSameDay(date, new Date())
}

export function serializeDate(date: Date): string {
	return format(date, 'yyyy-MM-dd')
}

export function parseDate(dateString: string): Date {
	return startOfDay(parseISO(dateString))
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
