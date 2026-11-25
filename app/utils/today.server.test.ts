/**
 * The user's today is the date in the zone the browser's timezone hint names.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { consoleWarn } from '#tests/setup/setup-test-env.ts'
import { serializeDate } from './date.ts'
import { getRequestToday, getRequestWeekStart } from './today.server.ts'

afterEach(() => {
	vi.useRealTimers()
})

function at(instant: string) {
	vi.useFakeTimers({ toFake: ['Date'] })
	vi.setSystemTime(new Date(instant))
}

function requestWithCookie(cookie?: string) {
	return new Request(
		'https://useqm.app/plan',
		cookie ? { headers: { cookie } } : {},
	)
}

function requestIn(timeZone: string) {
	return requestWithCookie(`CH-time-zone=${encodeURIComponent(timeZone)}`)
}

test.each([
	{
		name: 'Bucharest just after midnight on a Monday',
		instant: '2026-11-22T22:30:00Z',
		timeZone: 'Europe/Bucharest',
		today: '2026-11-23',
	},
	{
		name: 'Los Angeles on a Sunday evening',
		instant: '2026-11-23T04:00:00Z',
		timeZone: 'America/Los_Angeles',
		today: '2026-11-22',
	},
	{
		name: 'Kiritimati, a day ahead of UTC',
		instant: '2026-11-23T11:00:00Z',
		timeZone: 'Pacific/Kiritimati',
		today: '2026-11-24',
	},
	{
		name: 'Pago Pago, a day behind UTC',
		instant: '2026-11-23T10:00:00Z',
		timeZone: 'Pacific/Pago_Pago',
		today: '2026-11-22',
	},
	{
		name: 'Bucharest at 00:30 on the night the clocks go forward',
		instant: '2026-03-28T22:30:00Z',
		timeZone: 'Europe/Bucharest',
		today: '2026-03-29',
	},
	{
		name: 'Bucharest at 00:30 the night after the clocks went forward',
		// UTC+3 now; the morning's UTC+2 would still say the 29th.
		instant: '2026-03-29T21:30:00Z',
		timeZone: 'Europe/Bucharest',
		today: '2026-03-30',
	},
	{
		name: 'New York at 23:30 on the day the clocks go back',
		// UTC−5 now; the morning's UTC−4 would already say the 2nd.
		instant: '2026-11-02T04:30:00Z',
		timeZone: 'America/New_York',
		today: '2026-11-01',
	},
	{
		name: "Bucharest on New Year's night, UTC still in the old year",
		instant: '2026-12-31T22:30:00Z',
		timeZone: 'Europe/Bucharest',
		today: '2027-01-01',
	},
	{
		name: "Los Angeles on New Year's Eve, UTC already in the new year",
		instant: '2027-01-01T04:00:00Z',
		timeZone: 'America/Los_Angeles',
		today: '2026-12-31',
	},
])('$name', ({ instant, timeZone, today }) => {
	at(instant)
	expect(getRequestToday(requestIn(timeZone))).toBe(today)
})

test('without a hint cookie, today is the UTC day', () => {
	at('2026-11-22T22:30:00Z')
	expect(getRequestToday(requestWithCookie())).toBe('2026-11-22')
	expect(getRequestToday(requestWithCookie('theme=dark'))).toBe('2026-11-22')
})

test.each([
	['an unknown zone', 'CH-time-zone=Mars%2FOlympus_Mons'],
	['an empty value', 'CH-time-zone='],
])('with %s in the hint, today is the UTC day', (_name, cookie) => {
	at('2026-11-22T22:30:00Z')
	expect(getRequestToday(requestWithCookie(cookie))).toBe('2026-11-22')
})

test('with a broken encoding in the hint, today is the UTC day', () => {
	// The hints library logs the bad cookie and falls back.
	consoleWarn.mockImplementation(() => {})
	at('2026-11-22T22:30:00Z')
	expect(getRequestToday(requestWithCookie('CH-time-zone=%E0%A4%A'))).toBe(
		'2026-11-22',
	)
})

test('the hint is read from among other cookies', () => {
	at('2026-11-22T22:30:00Z')
	const cookie = `theme=dark; CH-time-zone=${encodeURIComponent('Europe/Bucharest')}; en_session=abc`
	expect(getRequestToday(requestWithCookie(cookie))).toBe('2026-11-23')
})

// The week a request asks for with `?weekStart=`.
describe('getRequestWeekStart', () => {
	function weekOf(url: string, timeZone = 'UTC') {
		const request = new Request(url, {
			headers: { cookie: `CH-time-zone=${encodeURIComponent(timeZone)}` },
		})
		return serializeDate(getRequestWeekStart(request, getRequestToday(request)))
	}

	test.each([
		['no param', 'https://useqm.app/plan'],
		['an empty param', 'https://useqm.app/plan?weekStart='],
		['words', 'https://useqm.app/plan?weekStart=abc'],
		['a short month', 'https://useqm.app/plan?weekStart=2026-1-5'],
		[
			'a day that does not exist',
			'https://useqm.app/plan?weekStart=2026-02-30',
		],
		[
			'a full datetime',
			'https://useqm.app/plan?weekStart=2026-10-21T00:00:00Z',
		],
	])('%s opens the week holding today', (_, url) => {
		at('2026-11-25T12:00:00Z')
		expect(weekOf(url)).toBe('2026-11-23')
	})

	test.each([
		['a Monday', '2026-10-19', '2026-10-19'],
		['a Wednesday', '2026-10-21', '2026-10-19'],
		['a Sunday', '2026-10-25', '2026-10-19'],
		['a leap day', '2024-02-29', '2024-02-26'],
	])('%s opens the week it falls in', (_, day, week) => {
		expect(weekOf(`https://useqm.app/plan?weekStart=${day}`)).toBe(week)
	})

	test("today's week is in the user's zone", () => {
		at('2026-11-22T22:30:00Z')
		expect(weekOf('https://useqm.app/plan', 'Europe/Bucharest')).toBe(
			'2026-11-23',
		)
		expect(weekOf('https://useqm.app/plan', 'UTC')).toBe('2026-11-16')
	})
})
