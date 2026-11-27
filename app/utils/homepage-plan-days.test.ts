import { describe, expect, test } from 'vitest'
import { nextSaturday, planDayOnPhone } from './homepage-plan-days.ts'

// 2026-11-23 is a Monday.

describe('planDayOnPhone', () => {
	test('on a Monday the strip starts with today, picked', () => {
		const day = planDayOnPhone('2026-11-23', '2026-11-23')
		expect(day.strip[0]).toMatchObject({
			date: '2026-11-23',
			weekday: 'Mon',
			dayOfMonth: 23,
			today: true,
			picked: true,
			past: false,
		})
		expect(day.strip.filter((d) => d.picked)).toHaveLength(1)
		expect(day.label).toBe('Today')
		expect(day.heading).toBe('Nov 23')
	})

	test('on a Sunday the strip starts six days back and today is last', () => {
		const day = planDayOnPhone('2026-11-29', '2026-11-29')
		expect(day.strip.map((d) => d.dayOfMonth)).toEqual([
			23, 24, 25, 26, 27, 28, 29,
		])
		expect(day.strip.at(-1)).toMatchObject({ today: true, picked: true })
		expect(day.range).toBe('Nov 23 – 29')
	})

	test('the days before today are past and the days after are not', () => {
		const day = planDayOnPhone('2026-11-26', '2026-11-26')
		expect(day.strip.map((d) => d.past)).toEqual([
			true,
			true,
			true,
			false,
			false,
			false,
			false,
		])
	})

	test('a week across a month boundary names both months', () => {
		const day = planDayOnPhone('2026-12-02', '2026-12-02')
		expect(day.range).toBe('Nov 30 – Dec 6')
		expect(day.strip.map((d) => d.dayOfMonth)).toEqual([30, 1, 2, 3, 4, 5, 6])
	})

	test('a week across a year boundary names the year', () => {
		const day = planDayOnPhone('2026-12-31', '2026-12-31')
		expect(day.range).toBe('Dec 28 – Jan 3, 2027')
		expect(day.heading).toBe('Dec 31')
	})

	test('another day of this week is picked, and today keeps its mark', () => {
		const day = planDayOnPhone('2026-11-27', '2026-11-28')
		expect(day.strip.find((d) => d.today)?.date).toBe('2026-11-27')
		expect(day.strip.find((d) => d.picked)?.date).toBe('2026-11-28')
		expect(day.label).toBe('Saturday')
		expect(day.heading).toBe('Nov 28')
		expect(day.otherWeek).toBe(false)
	})

	test('a day in next week shows that week with no today in it', () => {
		const day = planDayOnPhone('2026-11-28', '2026-12-05')
		expect(day.range).toBe('Nov 30 – Dec 6')
		expect(day.strip.some((d) => d.today)).toBe(false)
		expect(day.strip.some((d) => d.past)).toBe(false)
		expect(day.otherWeek).toBe(true)
	})
})

describe('the dots under the strip', () => {
	const weekdays = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])

	test('the picked day always has its dot, a Sunday too', () => {
		const day = planDayOnPhone('2026-11-29', '2026-11-29', weekdays)
		expect(day.strip.at(-1)).toMatchObject({ picked: true, planned: true })
	})

	test('other days have a dot only when they have Meals', () => {
		const day = planDayOnPhone('2026-11-27', '2026-11-27', weekdays)
		expect(day.strip.map((d) => d.planned)).toEqual([
			true,
			true,
			true,
			true,
			true,
			true,
			false,
		])
	})
})

describe('nextSaturday', () => {
	test('from a weekday it is the Saturday of the same week', () => {
		expect(nextSaturday('2026-11-23')).toBe('2026-11-28')
		expect(nextSaturday('2026-11-27')).toBe('2026-11-28')
	})

	test('on a Saturday it is the Saturday a week on', () => {
		expect(nextSaturday('2026-11-28')).toBe('2026-12-05')
	})

	test('on a Sunday it is the Saturday six days on', () => {
		expect(nextSaturday('2026-11-29')).toBe('2026-12-05')
	})

	test('it crosses into the next year', () => {
		expect(nextSaturday('2026-12-31')).toBe('2027-01-02')
	})
})
