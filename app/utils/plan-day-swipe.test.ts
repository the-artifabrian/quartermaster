/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from 'vitest'
import { getWeekDays, parseDate } from './date.ts'
import {
	canStartDaySwipe,
	daySwipeStep,
	mealPhoto,
	stepDay,
} from './plan-day-swipe.ts'

describe('daySwipeStep', () => {
	test('a swipe to the left steps to the next day', () => {
		expect(daySwipeStep(-80, 4)).toBe(1)
	})
	test('a swipe to the right steps to the day before', () => {
		expect(daySwipeStep(80, -4)).toBe(-1)
	})
	test('a short swipe does not step', () => {
		expect(daySwipeStep(-63, 0)).toBe(0)
		expect(daySwipeStep(63, 0)).toBe(0)
	})
	// A scroll that drifts sideways covers some ground across the page too.
	test('a slanted drag does not step', () => {
		expect(daySwipeStep(-80, 60)).toBe(0)
		expect(daySwipeStep(90, -70)).toBe(0)
	})
})

describe('stepDay', () => {
	// Mon Nov 23 to Sun Nov 29, 2026.
	const week = getWeekDays(parseDate('2026-11-23'))

	test('steps inside the week without turning it', () => {
		expect(stepDay(week, '2026-11-25', 1)).toEqual({
			day: '2026-11-26',
			weekStart: null,
		})
		expect(stepDay(week, '2026-11-25', -1)).toEqual({
			day: '2026-11-24',
			weekStart: null,
		})
	})
	test('past Sunday turns to the next week’s Monday', () => {
		expect(stepDay(week, '2026-11-29', 1)).toEqual({
			day: '2026-11-30',
			weekStart: '2026-11-30',
		})
	})
	test('before Monday turns to the last week’s Sunday', () => {
		expect(stepDay(week, '2026-11-23', -1)).toEqual({
			day: '2026-11-22',
			weekStart: '2026-11-16',
		})
	})
	test('turns the week across a new year', () => {
		const lastWeek = getWeekDays(parseDate('2026-12-28'))
		expect(stepDay(lastWeek, '2027-01-03', 1)).toEqual({
			day: '2027-01-04',
			weekStart: '2027-01-04',
		})
	})
})

describe('canStartDaySwipe', () => {
	function surfaceWith(html: string) {
		const surface = document.createElement('div')
		surface.innerHTML = html
		document.body.append(surface)
		return surface
	}

	test('a drag on the day itself may step it', () => {
		const surface = surfaceWith('<p><a href="/recipes/1">Soup</a></p>')
		expect(canStartDaySwipe(surface, surface.querySelector('a'))).toBe(true)
		expect(canStartDaySwipe(surface, surface)).toBe(true)
	})
	test('a drag that starts in the scale field leaves the day alone', () => {
		const surface = surfaceWith(
			'<label><span>Scale</span><input type="text" /></label>',
		)
		expect(canStartDaySwipe(surface, surface.querySelector('input'))).toBe(
			false,
		)
		// The label around the field is its tap area.
		expect(canStartDaySwipe(surface, surface.querySelector('span'))).toBe(false)
	})
	// React sends events from a portal (a sheet, a menu) to the component that
	// opened it, which can sit inside the day.
	test('a drag in a sheet or menu outside the day leaves the day alone', () => {
		const surface = surfaceWith('<p>Day</p>')
		const sheet = document.createElement('div')
		sheet.innerHTML = '<button>Lunch</button>'
		document.body.append(sheet)
		expect(canStartDaySwipe(surface, sheet.querySelector('button'))).toBe(false)
	})
	test('no target leaves the day alone', () => {
		expect(canStartDaySwipe(surfaceWith(''), null)).toBe(false)
	})
})

describe('mealPhoto', () => {
	const recipe = (id: string, objectKey: string | null) => ({
		id,
		recipe: { image: objectKey ? { objectKey } : null },
	})
	const none = new Set<string>()

	test('a Dinner shows its first Recipe’s photo', () => {
		expect(
			mealPhoto(
				{
					label: 'dinner',
					items: [recipe('a', 'a.png'), recipe('b', 'b.png')],
				},
				none,
			),
		).toBe('a.png')
	})
	test('another label shows no photo', () => {
		expect(
			mealPhoto({ label: 'lunch', items: [recipe('a', 'a.png')] }, none),
		).toBeNull()
		expect(
			mealPhoto({ label: null, items: [recipe('a', 'a.png')] }, none),
		).toBeNull()
	})
	test('a Dinner whose first Recipe has no photo shows none', () => {
		expect(
			mealPhoto(
				{ label: 'dinner', items: [recipe('a', null), recipe('b', 'b.png')] },
				none,
			),
		).toBeNull()
	})
	test('a Dinner whose first Recipe was deleted shows none', () => {
		expect(
			mealPhoto(
				{
					label: 'dinner',
					items: [{ id: 'a', recipe: null }, recipe('b', 'b.png')],
				},
				none,
			),
		).toBeNull()
	})
	test('a first Recipe removed with Undo still waiting gives way to the next', () => {
		expect(
			mealPhoto(
				{
					label: 'dinner',
					items: [recipe('a', 'a.png'), recipe('b', 'b.png')],
				},
				new Set(['a']),
			),
		).toBe('b.png')
	})
	test('a typed Dinner shows none', () => {
		expect(mealPhoto({ label: 'dinner', items: [] }, none)).toBeNull()
	})
})
