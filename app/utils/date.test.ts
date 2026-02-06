import { describe, expect, test } from 'vitest'
import {
	getWeekStart,
	getWeekDays,
	getNextWeek,
	getPreviousWeek,
	serializeDate,
	parseDate,
	isToday,
	MEAL_TYPES,
} from './date.ts'

describe('getWeekStart', () => {
	test('returns Monday for a Wednesday', () => {
		// 2026-02-04 is a Wednesday
		const wed = new Date(2026, 1, 4)
		const result = getWeekStart(wed)
		expect(result.getDay()).toBe(1) // Monday
		expect(serializeDate(result)).toBe('2026-02-02')
	})

	test('returns Monday unchanged for a Monday', () => {
		// 2026-02-02 is a Monday
		const mon = new Date(2026, 1, 2)
		const result = getWeekStart(mon)
		expect(result.getDay()).toBe(1)
		expect(serializeDate(result)).toBe('2026-02-02')
	})

	test('returns previous Monday for a Sunday', () => {
		// 2026-02-08 is a Sunday
		const sun = new Date(2026, 1, 8)
		const result = getWeekStart(sun)
		expect(result.getDay()).toBe(1)
		expect(serializeDate(result)).toBe('2026-02-02')
	})
})

describe('getWeekDays', () => {
	test('returns 7 days Monday through Sunday', () => {
		const weekStart = new Date(2026, 1, 2) // Monday
		const days = getWeekDays(weekStart)
		expect(days).toHaveLength(7)
		expect(days[0]!.getDay()).toBe(1) // Monday
		expect(days[6]!.getDay()).toBe(0) // Sunday
	})

	test('days are consecutive', () => {
		const weekStart = new Date(2026, 1, 2)
		const days = getWeekDays(weekStart)
		for (let i = 1; i < days.length; i++) {
			const diff = days[i]!.getTime() - days[i - 1]!.getTime()
			expect(diff).toBe(24 * 60 * 60 * 1000) // 1 day in ms
		}
	})
})

describe('getNextWeek / getPreviousWeek', () => {
	test('getNextWeek returns date 7 days later', () => {
		const weekStart = new Date(2026, 1, 2) // Monday Feb 2
		const next = getNextWeek(weekStart)
		expect(serializeDate(next)).toBe('2026-02-09')
		expect(next.getDay()).toBe(1)
	})

	test('getPreviousWeek returns date 7 days earlier', () => {
		const weekStart = new Date(2026, 1, 9) // Monday Feb 9
		const prev = getPreviousWeek(weekStart)
		expect(serializeDate(prev)).toBe('2026-02-02')
		expect(prev.getDay()).toBe(1)
	})

	test('round-trip: next then previous returns original', () => {
		const weekStart = new Date(2026, 1, 2)
		const result = getPreviousWeek(getNextWeek(weekStart))
		expect(serializeDate(result)).toBe(serializeDate(weekStart))
	})
})

describe('serializeDate / parseDate', () => {
	test('round-trip preserves date', () => {
		const date = new Date(2026, 1, 6) // Feb 6, 2026
		const serialized = serializeDate(date)
		expect(serialized).toBe('2026-02-06')
		const parsed = parseDate(serialized)
		expect(serializeDate(parsed)).toBe('2026-02-06')
	})

	test('serializeDate formats as yyyy-MM-dd', () => {
		const date = new Date(2026, 0, 1)
		expect(serializeDate(date)).toBe('2026-01-01')
	})

	test('parseDate returns start of day', () => {
		const date = parseDate('2026-02-06')
		expect(date.getHours()).toBe(0)
		expect(date.getMinutes()).toBe(0)
		expect(date.getSeconds()).toBe(0)
	})
})

describe('isToday', () => {
	test('returns true for today', () => {
		expect(isToday(new Date())).toBe(true)
	})

	test('returns false for yesterday', () => {
		const yesterday = new Date()
		yesterday.setDate(yesterday.getDate() - 1)
		expect(isToday(yesterday)).toBe(false)
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
