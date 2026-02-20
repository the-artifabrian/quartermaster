import { describe, expect, test } from 'vitest'
import {
	addDaysUTC,
	getWeekStart,
	getWeekDays,
	getNextWeek,
	getPreviousWeek,
	serializeDate,
	parseDate,
	isToday,
	isPast,
	formatTimeAgo,
	formatDayLabel,
	formatWeekRange,
	MEAL_TYPES,
} from './date.ts'

describe('parseDate', () => {
	test('produces UTC midnight', () => {
		const d = parseDate('2026-02-06')
		expect(d.toISOString()).toBe('2026-02-06T00:00:00.000Z')
	})

	test('round-trips with serializeDate', () => {
		const d = parseDate('2026-02-06')
		expect(serializeDate(d)).toBe('2026-02-06')
	})
})

describe('serializeDate', () => {
	test('uses UTC fields', () => {
		// A date at UTC 23:00 on Feb 5 — which is Feb 6 in UTC+2
		// serializeDate should return the UTC date, not local
		const d = new Date('2026-02-05T23:00:00.000Z')
		expect(serializeDate(d)).toBe('2026-02-05')
	})

	test('formats as yyyy-MM-dd', () => {
		const d = new Date('2026-01-01T00:00:00.000Z')
		expect(serializeDate(d)).toBe('2026-01-01')
	})
})

describe('addDaysUTC', () => {
	test('adds days using ms arithmetic', () => {
		const d = parseDate('2026-02-06')
		const result = addDaysUTC(d, 3)
		expect(result.toISOString()).toBe('2026-02-09T00:00:00.000Z')
	})

	test('subtracts days with negative n', () => {
		const d = parseDate('2026-02-06')
		const result = addDaysUTC(d, -2)
		expect(result.toISOString()).toBe('2026-02-04T00:00:00.000Z')
	})

	test('is DST-safe (stays at UTC midnight across spring-forward)', () => {
		// US DST spring-forward 2026: March 8
		const d = parseDate('2026-03-07')
		const result = addDaysUTC(d, 2)
		expect(result.toISOString()).toBe('2026-03-09T00:00:00.000Z')
	})
})

describe('getWeekStart', () => {
	test('returns Monday for a Wednesday', () => {
		// 2026-02-04 is a Wednesday
		const wed = new Date('2026-02-04T00:00:00.000Z')
		const result = getWeekStart(wed)
		expect(result.getUTCDay()).toBe(1) // Monday
		expect(serializeDate(result)).toBe('2026-02-02')
		expect(result.toISOString()).toBe('2026-02-02T00:00:00.000Z')
	})

	test('returns Monday unchanged for a Monday', () => {
		const mon = new Date('2026-02-02T00:00:00.000Z')
		const result = getWeekStart(mon)
		expect(result.getUTCDay()).toBe(1)
		expect(serializeDate(result)).toBe('2026-02-02')
	})

	test('returns previous Monday for a Sunday', () => {
		const sun = new Date('2026-02-08T00:00:00.000Z')
		const result = getWeekStart(sun)
		expect(result.getUTCDay()).toBe(1)
		expect(serializeDate(result)).toBe('2026-02-02')
	})

	test('result is UTC midnight', () => {
		const d = new Date('2026-02-04T00:00:00.000Z')
		const result = getWeekStart(d)
		expect(result.getUTCHours()).toBe(0)
		expect(result.getUTCMinutes()).toBe(0)
		expect(result.getUTCSeconds()).toBe(0)
		expect(result.getUTCMilliseconds()).toBe(0)
	})
})

describe('getWeekDays', () => {
	test('returns 7 days Monday through Sunday', () => {
		const weekStart = new Date('2026-02-02T00:00:00.000Z')
		const days = getWeekDays(weekStart)
		expect(days).toHaveLength(7)
		expect(days[0]!.getUTCDay()).toBe(1) // Monday
		expect(days[6]!.getUTCDay()).toBe(0) // Sunday
	})

	test('days are consecutive', () => {
		const weekStart = new Date('2026-02-02T00:00:00.000Z')
		const days = getWeekDays(weekStart)
		for (let i = 1; i < days.length; i++) {
			const diff = days[i]!.getTime() - days[i - 1]!.getTime()
			expect(diff).toBe(24 * 60 * 60 * 1000)
		}
	})

	test('all days are UTC midnight', () => {
		const weekStart = new Date('2026-02-02T00:00:00.000Z')
		const days = getWeekDays(weekStart)
		for (const day of days) {
			expect(day.toISOString()).toMatch(/T00:00:00\.000Z$/)
		}
	})
})

describe('getNextWeek / getPreviousWeek', () => {
	test('getNextWeek returns date 7 days later', () => {
		const weekStart = new Date('2026-02-02T00:00:00.000Z')
		const next = getNextWeek(weekStart)
		expect(serializeDate(next)).toBe('2026-02-09')
		expect(next.getUTCDay()).toBe(1)
	})

	test('getPreviousWeek returns date 7 days earlier', () => {
		const weekStart = new Date('2026-02-09T00:00:00.000Z')
		const prev = getPreviousWeek(weekStart)
		expect(serializeDate(prev)).toBe('2026-02-02')
		expect(prev.getUTCDay()).toBe(1)
	})

	test('round-trip: next then previous returns original', () => {
		const weekStart = new Date('2026-02-02T00:00:00.000Z')
		const result = getPreviousWeek(getNextWeek(weekStart))
		expect(serializeDate(result)).toBe(serializeDate(weekStart))
	})
})

describe('formatDayLabel', () => {
	test('formats using UTC fields', () => {
		const mon = new Date('2026-02-02T00:00:00.000Z')
		expect(formatDayLabel(mon)).toBe('Mon 2/2')
	})

	test('formats Sunday', () => {
		const sun = new Date('2026-02-08T00:00:00.000Z')
		expect(formatDayLabel(sun)).toBe('Sun 2/8')
	})
})

describe('formatWeekRange', () => {
	test('formats week range using UTC fields', () => {
		const weekStart = new Date('2026-02-02T00:00:00.000Z')
		expect(formatWeekRange(weekStart)).toBe('Feb 2 - 8, 2026')
	})
})

describe('isToday', () => {
	test('returns true for today (UTC midnight of local today)', () => {
		const now = new Date()
		const todayUTC = new Date(
			Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
		)
		expect(isToday(todayUTC)).toBe(true)
	})

	test('returns false for yesterday', () => {
		const now = new Date()
		const yesterdayUTC = new Date(
			Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 1),
		)
		expect(isToday(yesterdayUTC)).toBe(false)
	})
})

describe('isPast', () => {
	test('returns true for yesterday', () => {
		const now = new Date()
		const yesterdayUTC = new Date(
			Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 1),
		)
		expect(isPast(yesterdayUTC)).toBe(true)
	})

	test('returns false for today', () => {
		const now = new Date()
		const todayUTC = new Date(
			Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
		)
		expect(isPast(todayUTC)).toBe(false)
	})

	test('returns false for tomorrow', () => {
		const now = new Date()
		const tomorrowUTC = new Date(
			Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1),
		)
		expect(isPast(tomorrowUTC)).toBe(false)
	})

	test('returns true for last year', () => {
		const now = new Date()
		const lastYear = new Date(
			Date.UTC(now.getFullYear() - 1, now.getMonth(), now.getDate()),
		)
		expect(isPast(lastYear)).toBe(true)
	})

	test('returns true for earlier month same year', () => {
		const now = new Date()
		// Only test if we're past January
		if (now.getMonth() > 0) {
			const earlierMonth = new Date(
				Date.UTC(now.getFullYear(), now.getMonth() - 1, 15),
			)
			expect(isPast(earlierMonth)).toBe(true)
		}
	})
})

describe('formatTimeAgo', () => {
	function daysAgo(days: number): Date {
		const d = new Date()
		d.setDate(d.getDate() - days)
		return d
	}

	test('returns "today" for today', () => {
		expect(formatTimeAgo(new Date())).toBe('today')
	})

	test('returns "yesterday" for 1 day ago', () => {
		expect(formatTimeAgo(daysAgo(1))).toBe('yesterday')
	})

	test('returns "X days ago" for 2-6 days', () => {
		expect(formatTimeAgo(daysAgo(3))).toBe('3 days ago')
		expect(formatTimeAgo(daysAgo(6))).toBe('6 days ago')
	})

	test('returns "1 week ago" for 7-13 days', () => {
		expect(formatTimeAgo(daysAgo(7))).toBe('1 week ago')
		expect(formatTimeAgo(daysAgo(13))).toBe('1 week ago')
	})

	test('returns "X weeks ago" for 14-29 days', () => {
		expect(formatTimeAgo(daysAgo(14))).toBe('2 weeks ago')
		expect(formatTimeAgo(daysAgo(21))).toBe('3 weeks ago')
	})

	test('returns "1 month ago" for 30-59 days', () => {
		expect(formatTimeAgo(daysAgo(30))).toBe('1 month ago')
		expect(formatTimeAgo(daysAgo(59))).toBe('1 month ago')
	})

	test('returns "X months ago" for 60-364 days', () => {
		expect(formatTimeAgo(daysAgo(60))).toBe('2 months ago')
		expect(formatTimeAgo(daysAgo(180))).toBe('6 months ago')
	})

	test('returns "1 year ago" for 365 days', () => {
		expect(formatTimeAgo(daysAgo(365))).toBe('1 year ago')
	})

	test('returns "X years ago" for 730+ days', () => {
		expect(formatTimeAgo(daysAgo(730))).toBe('2 years ago')
	})
})

describe('MEAL_TYPES', () => {
	test('has 4 meal types', () => {
		expect(MEAL_TYPES).toHaveLength(4)
		expect(MEAL_TYPES).toContain('breakfast')
		expect(MEAL_TYPES).toContain('lunch')
		expect(MEAL_TYPES).toContain('dinner')
		expect(MEAL_TYPES).toContain('snack')
	})
})
