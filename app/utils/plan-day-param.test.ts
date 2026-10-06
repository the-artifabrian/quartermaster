import { expect, test, vi } from 'vitest'
import { getWeekDays, parseDate } from './date.ts'
import { planShouldRevalidate, resolveSelectedDay } from './plan-day-param.ts'

const weekDays = getWeekDays(parseDate('2026-04-06'))
const meals = [
	{ id: 'meal-wed', dateStr: '2026-04-08' },
	{ id: 'meal-thu', dateStr: '2026-04-09' },
]

/** Local noon on the given day, since "today" is the user's local date. */
function today(year: number, monthIndex: number, day: number) {
	vi.useFakeTimers({ toFake: ['Date'] })
	vi.setSystemTime(new Date(year, monthIndex, day, 12))
	return {
		[Symbol.dispose]() {
			vi.useRealTimers()
		},
	}
}

/** Friday 2026-04-10, inside the week. */
const inWeek = () => today(2026, 3, 10)

test("a linked Meal's day wins over the day param", () => {
	using _today = inWeek()
	expect(
		resolveSelectedDay({
			weekDays,
			meals,
			mealId: 'meal-thu',
			day: '2026-04-06',
		}),
	).toBe('2026-04-09')
})

test('a mealId that names no loaded Meal falls through to the day param', () => {
	using _today = inWeek()
	expect(
		resolveSelectedDay({
			weekDays,
			meals,
			mealId: 'meal-gone',
			day: '2026-04-07',
		}),
	).toBe('2026-04-07')
})

test('a day param inside the week wins over today', () => {
	using _today = inWeek()
	expect(
		resolveSelectedDay({ weekDays, meals, mealId: null, day: '2026-04-07' }),
	).toBe('2026-04-07')
})

test('a day param from another week is ignored', () => {
	using _today = inWeek()
	expect(
		resolveSelectedDay({ weekDays, meals, mealId: null, day: '2026-04-13' }),
	).toBe('2026-04-10')
})

test.each(['2026-13-40', 'foo', '', '2026-4-7', '2026-04-07T00:00:00Z'])(
	'a malformed day param %j is ignored',
	(day) => {
		using _today = inWeek()
		expect(resolveSelectedDay({ weekDays, meals, mealId: null, day })).toBe(
			'2026-04-10',
		)
	},
)

test('without params, today is selected when it is in the week', () => {
	using _today = inWeek()
	expect(resolveSelectedDay({ weekDays, meals, mealId: null, day: null })).toBe(
		'2026-04-10',
	)
})

test('without params and today outside the week, the first day with Meals is selected', () => {
	using _today = today(2026, 3, 20)
	expect(resolveSelectedDay({ weekDays, meals, mealId: null, day: null })).toBe(
		'2026-04-08',
	)
})

test('without params, today outside the week and no Meals, the first day is selected', () => {
	using _today = today(2026, 3, 20)
	expect(
		resolveSelectedDay({ weekDays, meals: [], mealId: null, day: null }),
	).toBe('2026-04-06')
})

const BASE_URL = 'https://useqm.app'

function revalidation({
	from,
	to,
	formMethod,
	defaultShouldRevalidate = true,
}: {
	from: string
	to: string
	formMethod?: string
	defaultShouldRevalidate?: boolean
}) {
	return planShouldRevalidate({
		currentUrl: new URL(from, BASE_URL),
		nextUrl: new URL(to, BASE_URL),
		formMethod,
		defaultShouldRevalidate,
	})
}

test('changing only the day does not reload the Plan', () => {
	expect(
		revalidation({
			from: '/plan?weekStart=2026-04-06&day=2026-04-07',
			to: '/plan?weekStart=2026-04-06&day=2026-04-08',
		}),
	).toBe(false)
	expect(revalidation({ from: '/plan', to: '/plan?day=2026-04-08' })).toBe(
		false,
	)
})

test('a day tap after arriving from a Meal link (mealId dropped) does not reload the Plan', () => {
	expect(
		revalidation({
			from: '/plan?weekStart=2026-04-06&mealId=meal-wed',
			to: '/plan?weekStart=2026-04-06&day=2026-04-09',
		}),
	).toBe(false)
})

test('the same params in another order with a new day do not reload the Plan', () => {
	expect(
		revalidation({
			from: '/plan?day=2026-04-07&weekStart=2026-04-06',
			to: '/plan?weekStart=2026-04-06&day=2026-04-08',
		}),
	).toBe(false)
})

test('changing the week reloads the Plan', () => {
	expect(
		revalidation({
			from: '/plan?weekStart=2026-04-06&day=2026-04-08',
			to: '/plan?weekStart=2026-04-13',
		}),
	).toBe(true)
})

test('a revalidation of the same URL follows the router', () => {
	expect(
		revalidation({
			from: '/plan?day=2026-04-08',
			to: '/plan?day=2026-04-08',
		}),
	).toBe(true)
})

test('a form submission follows the router even when only the day differs', () => {
	expect(
		revalidation({
			from: '/plan?day=2026-04-08',
			to: '/plan?day=2026-04-09',
			formMethod: 'POST',
		}),
	).toBe(true)
})

test('a failed action stays unrevalidated', () => {
	expect(
		revalidation({
			from: '/plan?day=2026-04-08',
			to: '/plan?day=2026-04-08',
			formMethod: 'POST',
			defaultShouldRevalidate: false,
		}),
	).toBe(false)
})
