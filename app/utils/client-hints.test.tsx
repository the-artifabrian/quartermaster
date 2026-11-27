/**
 * @vitest-environment jsdom
 */
import { render, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, test, vi } from 'vitest'
import { ClientHintCheck } from './client-hints.tsx'
import { todayInTimeZone } from './date.ts'

const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const browserDay = todayInTimeZone(browserTimeZone)
const zones = [
	'UTC',
	'Pacific/Kiritimati',
	'Pacific/Pago_Pago',
	'Etc/GMT-1',
	'Etc/GMT+1',
	'Etc/GMT-2',
	'Etc/GMT+2',
]
/** A zone on another day than the browser's right now. */
const otherDayZone = zones.find((zone) => todayInTimeZone(zone) !== browserDay)!
/** Another zone on the browser's day. */
const sameDayZone = zones.find(
	(zone) => zone !== browserTimeZone && todayInTimeZone(zone) === browserDay,
)!

// jsdom has no matchMedia; the browser here prefers light, as the server read.
window.matchMedia = ((query: string) => ({
	matches: false,
	media: query,
	addEventListener: () => {},
	removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

/** The root route with the hints the server read, counting its loads. */
function renderWithServerHints(timeZone: string) {
	// The hint check has stored the browser's own zone by now.
	document.cookie = `CH-time-zone=${encodeURIComponent(browserTimeZone)}`
	const loader = vi.fn(() => ({
		requestInfo: { hints: { theme: 'light', timeZone } },
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

test('loads the data again when the server drew another day than the browser’s', async () => {
	// The hint check's reload can reach the server before the browser has
	// stored the time zone cookie, which then answers in UTC.
	const loader = renderWithServerHints(otherDayZone)
	await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
})

test('loads the data once when the server’s zone was off but its day was right', async () => {
	// Only today comes from the zone, so nothing on the page would change.
	const loader = renderWithServerHints(sameDayZone)
	await waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
	await new Promise((resolve) => setTimeout(resolve, 50))
	expect(loader).toHaveBeenCalledTimes(1)
})

test('loads the data once when the server had the browser’s time zone', async () => {
	const loader = renderWithServerHints(browserTimeZone)
	await waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
	// Give a revalidation the chance to start before checking it didn't.
	await new Promise((resolve) => setTimeout(resolve, 50))
	expect(loader).toHaveBeenCalledTimes(1)
})

test('does not load again when the browser keeps no hint cookie', async () => {
	const loader = renderWithServerHints(otherDayZone)
	document.cookie = 'CH-time-zone=; Max-Age=0'
	await waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
	await new Promise((resolve) => setTimeout(resolve, 50))
	expect(loader).toHaveBeenCalledTimes(1)
})
