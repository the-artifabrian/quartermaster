import { describe, expect, test, vi } from 'vitest'
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
	loadedToday,
	formatDayLabel,
	formatMonthDay,
	formatShortDay,
	formatWeekdayName,
	formatWeekRange,
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

describe('formatWeekdayName', () => {
	test('formats using UTC fields', () => {
		const mon = new Date('2026-02-02T00:00:00.000Z')
		expect(formatWeekdayName(mon)).toBe('Monday')
	})

	test('formats Sunday', () => {
		const sun = new Date('2026-02-08T00:00:00.000Z')
		expect(formatWeekdayName(sun)).toBe('Sunday')
	})
})

describe('formatShortDay', () => {
	test('formats weekday and day number using UTC fields', () => {
		const sat = new Date('2026-09-26T00:00:00.000Z')
		expect(formatShortDay(sat)).toBe('Sat 26')
	})

	test('does not pad single-digit days', () => {
		const mon = new Date('2026-02-02T23:59:59.000Z')
		expect(formatShortDay(mon)).toBe('Mon 2')
	})
})

describe('formatMonthDay', () => {
	test('formats using UTC fields', () => {
		const date = new Date('2026-06-11T00:00:00.000Z')
		expect(formatMonthDay(date)).toBe('Jun 11')
	})

	test('does not pad single-digit days', () => {
		const date = new Date('2026-02-02T00:00:00.000Z')
		expect(formatMonthDay(date)).toBe('Feb 2')
	})
})

describe('formatWeekRange', () => {
	// The year shown follows the user's today.
	test('omits year when the week is in the year of today', () => {
		const weekStart = new Date('2026-02-02T00:00:00.000Z')
		expect(formatWeekRange(weekStart, '2026-11-23')).toBe('Feb 2 – 8')
	})

	test('shows end month when week spans months in the year of today', () => {
		const weekStart = new Date('2026-02-23T00:00:00.000Z')
		expect(formatWeekRange(weekStart, '2026-11-23')).toBe('Feb 23 – Mar 1')
	})

	test('shows year when week spans year boundary', () => {
		const weekStart = new Date('2026-12-28T00:00:00.000Z')
		expect(formatWeekRange(weekStart, '2026-12-31')).toBe(
			'Dec 28 – Jan 3, 2027',
		)
	})

	test('shows year when week is in a different year', () => {
		const weekStart = new Date('2025-03-03T00:00:00.000Z')
		expect(formatWeekRange(weekStart, '2026-11-23')).toBe('Mar 3 – 9, 2025')
	})

	test("takes the year from today, whatever the server's clock says", () => {
		// New Year's Day for the user while the server is still in the old year.
		const weekStart = new Date('2027-01-04T00:00:00.000Z')
		expect(formatWeekRange(weekStart, '2027-01-01')).toBe('Jan 4 – 10')
		expect(formatWeekRange(weekStart, '2026-12-31')).toBe('Jan 4 – 10, 2027')
	})
})

describe('isToday', () => {
	test('is true for the stored day that is today', () => {
		expect(isToday(parseDate('2026-11-23'), '2026-11-23')).toBe(true)
	})

	test('is false for the days either side', () => {
		expect(isToday(parseDate('2026-11-22'), '2026-11-23')).toBe(false)
		expect(isToday(parseDate('2026-11-24'), '2026-11-23')).toBe(false)
	})

	test('is false for the same day in another month or year', () => {
		expect(isToday(parseDate('2026-10-23'), '2026-11-23')).toBe(false)
		expect(isToday(parseDate('2025-11-23'), '2026-11-23')).toBe(false)
	})
})

describe('isPast', () => {
	test('is true for yesterday, across a month and a year boundary', () => {
		expect(isPast(parseDate('2026-11-22'), '2026-11-23')).toBe(true)
		expect(isPast(parseDate('2026-10-31'), '2026-11-01')).toBe(true)
		expect(isPast(parseDate('2026-12-31'), '2027-01-01')).toBe(true)
	})

	test('is false for today and later', () => {
		expect(isPast(parseDate('2026-11-23'), '2026-11-23')).toBe(false)
		expect(isPast(parseDate('2026-11-24'), '2026-11-23')).toBe(false)
		expect(isPast(parseDate('2027-01-01'), '2026-12-31')).toBe(false)
	})

	test('is true for an earlier month with a later day number', () => {
		expect(isPast(parseDate('2026-10-30'), '2026-11-02')).toBe(true)
	})
})

describe('loadedToday', () => {
	test("is the loader's today when the data has one", () => {
		expect(loadedToday('2026-11-23')).toBe('2026-11-23')
	})

	test('is the local date when cached data from before the change has none', () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		try {
			vi.setSystemTime(new Date('2026-11-22T22:30:00Z'))
			const now = new Date()
			const local = [
				now.getFullYear(),
				String(now.getMonth() + 1).padStart(2, '0'),
				String(now.getDate()).padStart(2, '0'),
			].join('-')
			expect(loadedToday(undefined)).toBe(local)
		} finally {
			vi.useRealTimers()
		}
	})
})
