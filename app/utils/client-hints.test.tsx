/**
 * @vitest-environment jsdom
 */
import { render, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ClientHintCheck, serverMissedAHint } from './client-hints.tsx'
import { todayInTimeZone } from './date.ts'

/** Zones to pick from, a `/` in most of them so the cookie is encoded. */
const zones = [
	'Pacific/Kiritimati',
	'Pacific/Pago_Pago',
	// Pago Pago's own offset, so always its day.
	'Pacific/Niue',
	'Europe/Bucharest',
	'America/New_York',
	'Asia/Tokyo',
	'Etc/GMT-1',
	'Etc/GMT+1',
	'UTC',
]
/** A zone on another day than `zone` right now. */
const otherDayThan = (zone: string) =>
	zones.find((other) => todayInTimeZone(other) !== todayInTimeZone(zone))!
/** Another zone on the same day as `zone` right now. */
const sameDayAs = (zone: string) =>
	zones.find(
		(other) =>
			other !== zone && todayInTimeZone(other) === todayInTimeZone(zone),
	)!

const visitor = 'Pacific/Pago_Pago'
const zoneCookie = `CH-time-zone=${encodeURIComponent(visitor)}`

describe('serverMissedAHint', () => {
	test('the server drew another day than the stored zone gives', () => {
		expect(
			serverMissedAHint(
				{ timeZone: otherDayThan(visitor), theme: 'light' },
				{ timeZone: visitor, scheme: 'light' },
				`CH-prefers-color-scheme=light; ${zoneCookie}`,
			),
		).toBe(true)
	})

	test('a zone that only differs by name draws the same day, so nothing changes', () => {
		expect(
			serverMissedAHint(
				{ timeZone: sameDayAs(visitor), theme: 'light' },
				{ timeZone: visitor, scheme: 'light' },
				`CH-prefers-color-scheme=light; ${zoneCookie}`,
			),
		).toBe(false)
	})

	test('a zone the browser has not stored yet is no reason to load again', () => {
		expect(
			serverMissedAHint(
				{ timeZone: otherDayThan(visitor), theme: 'light' },
				{ timeZone: visitor, scheme: 'light' },
				'CH-prefers-color-scheme=light',
			),
		).toBe(false)
	})

	test('the stored zone is read encoded, as the hint check writes it', () => {
		expect(
			serverMissedAHint(
				{ timeZone: otherDayThan(visitor), theme: 'light' },
				{ timeZone: visitor, scheme: 'light' },
				// Unencoded, as the hint check never writes it.
				`CH-prefers-color-scheme=light; CH-time-zone=${visitor}`,
			),
		).toBe(false)
	})

	test('a dark system the server drew light, with the scheme stored', () => {
		expect(
			serverMissedAHint(
				{ timeZone: visitor, theme: 'light' },
				{ timeZone: visitor, scheme: 'dark' },
				`CH-prefers-color-scheme=dark; ${zoneCookie}`,
			),
		).toBe(true)
	})

	test('a theme chosen in the app wins over the system scheme', () => {
		// The server drew the chosen light; the system being dark changes
		// nothing on the page.
		expect(
			serverMissedAHint(
				{ timeZone: visitor, theme: 'light' },
				{ timeZone: visitor, scheme: 'dark' },
				`en_theme=light; CH-prefers-color-scheme=dark; ${zoneCookie}`,
			),
		).toBe(false)
	})

	test('a chosen theme the server did not see is a miss', () => {
		expect(
			serverMissedAHint(
				{ timeZone: visitor, theme: 'light' },
				{ timeZone: visitor, scheme: 'light' },
				`en_theme=dark; CH-prefers-color-scheme=light; ${zoneCookie}`,
			),
		).toBe(true)
	})
})

describe('ClientHintCheck', () => {
	const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
	// jsdom has no matchMedia; the browser here prefers light.
	window.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
	})) as unknown as typeof window.matchMedia

	afterEach(() => {
		vi.restoreAllMocks()
		document.cookie = 'CH-time-zone=; Max-Age=0'
		document.cookie = 'CH-prefers-color-scheme=; Max-Age=0'
	})

	/** The root route answering with the server's hints, counting its loads. */
	function renderWithServerHints(timeZone: string) {
		document.cookie = `CH-time-zone=${encodeURIComponent(browserZone)}`
		document.cookie = 'CH-prefers-color-scheme=light'
		const loader = vi.fn(() => ({
			requestInfo: {
				hints: { theme: 'light', timeZone },
				userPrefs: { theme: null },
			},
		}))
		const router = createMemoryRouter(
			[
				{
					id: 'root',
					path: '/',
					loader,
					HydrateFallback: () => null,
					element: <ClientHintCheck nonce="" />,
				},
			],
			{ initialEntries: ['/'] },
		)
		render(<RouterProvider router={router} />)
		return loader
	}

	const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

	test('loads the data once more when the server missed a hint', async () => {
		const loader = renderWithServerHints(otherDayThan(browserZone))
		await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
	})

	test('a server that keeps missing it gets one more load, not more', async () => {
		const loader = renderWithServerHints(otherDayThan(browserZone))
		await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
		await settle()
		expect(loader).toHaveBeenCalledTimes(2)
	})

	test('loads once when the server had the hints', async () => {
		const loader = renderWithServerHints(browserZone)
		await waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
		await settle()
		expect(loader).toHaveBeenCalledTimes(1)
	})

	test('does not load again offline, where the load would fail', async () => {
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
		const loader = renderWithServerHints(otherDayThan(browserZone))
		await waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
		await settle()
		expect(loader).toHaveBeenCalledTimes(1)
	})
})
