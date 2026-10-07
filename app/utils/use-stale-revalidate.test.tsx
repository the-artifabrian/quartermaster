/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect } from 'react'
import {
	Link,
	RouterProvider,
	createMemoryRouter,
	useLoaderData,
	useLocation,
	useRevalidator,
} from 'react-router'
import { expect, test } from 'vitest'
import { loaderCache } from './loader-cache.ts'
import { useStaleRevalidate } from './use-stale-revalidate.ts'

// The same object every time: a revalidation that "brings nothing new" looks
// exactly like one a navigation cut short, apart from the location key.
const WEEK = { meals: ['tacos'] }

function Page() {
	const data = useLoaderData()
	useStaleRevalidate(data)
	const revalidator = useRevalidator()
	return (
		<>
			<p>revalidation {revalidator.state}</p>
			<button type="button" onClick={() => void revalidator.revalidate()}>
				Revalidate
			</button>
			<Link to="/?day=2026-10-22" replace>
				Pick a day
			</Link>
		</>
	)
}

function renderPage(loader: () => Promise<unknown>) {
	const router = createMemoryRouter(
		[
			{
				path: '/',
				loader,
				// Like Plan: a change of view-only params loads nothing.
				shouldRevalidate: ({ currentUrl, nextUrl, defaultShouldRevalidate }) =>
					currentUrl.search === nextUrl.search && defaultShouldRevalidate,
				Component: Page,
				HydrateFallback: () => null,
			},
		],
		{ initialEntries: ['/'] },
	)
	render(<RouterProvider router={router} />)
	return router
}

async function settle() {
	await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
}

test('a same-URL revalidation that ends with the same data does not revalidate again', async () => {
	const user = userEvent.setup()
	let calls = 0
	renderPage(async () => {
		calls++
		return WEEK
	})
	await screen.findByText('revalidation idle')
	expect(calls).toBe(1)

	await user.click(screen.getByRole('button', { name: 'Revalidate' }))
	await waitFor(() => expect(calls).toBe(2))
	await screen.findByText('revalidation idle')
	await settle()
	expect(calls).toBe(2)
})

test('a revalidation ended by a navigation that loaded nothing runs again, once', async () => {
	const user = userEvent.setup()
	let calls = 0
	const router = renderPage(async () => {
		calls++
		// The first revalidation hangs until the navigation aborts it.
		if (calls === 2) await new Promise(() => {})
		return WEEK
	})
	await screen.findByText('revalidation idle')

	await user.click(screen.getByRole('button', { name: 'Revalidate' }))
	await screen.findByText('revalidation loading')
	await user.click(screen.getByRole('link', { name: 'Pick a day' }))

	await waitFor(() => expect(calls).toBe(3))
	expect(router.state.location.search).toBe('?day=2026-10-22')
	await screen.findByText('revalidation idle')
	await settle()
	expect(calls).toBe(3)
})

/** Sets navigator.onLine for one test; the browser default comes back after. */
function networkState(online: boolean) {
	const set = (value: boolean) =>
		Object.defineProperty(window.navigator, 'onLine', {
			configurable: true,
			get: () => value,
		})
	set(online)
	return {
		goOnline() {
			set(true)
			window.dispatchEvent(new Event('online'))
		},
		[Symbol.dispose]: () => set(true),
	}
}

/**
 * Renders a page whose first data comes from the loader cache, as a tab
 * revisit does, and counts the loads that reach the server.
 */
async function renderCachedPage() {
	const server = { calls: 0 }
	const request = new Request('https://useqm.app/')
	loaderCache.setIdentity('alex-home')
	loaderCache.setLocation('/elsewhere')
	await loaderCache.load({ request, serverLoader: async () => ({ fresh: 0 }) })

	function CachedPage() {
		const data = useLoaderData()
		const { pathname, search } = useLocation()
		useLayoutEffect(() => {
			loaderCache.setLocation(pathname + search)
		}, [pathname, search])
		useStaleRevalidate(data)
		const revalidator = useRevalidator()
		return (
			<>
				<p>data {JSON.stringify(data)}</p>
				<button type="button" onClick={() => void revalidator.revalidate()}>
					Retry
				</button>
			</>
		)
	}
	const router = createMemoryRouter(
		[
			{
				path: '/',
				loader: ({ request }) =>
					loaderCache.load({
						request,
						serverLoader: async () => ({ fresh: ++server.calls }),
					}),
				Component: CachedPage,
				HydrateFallback: () => null,
			},
		],
		{ initialEntries: ['/'] },
	)
	render(<RouterProvider router={router} />)
	return {
		server,
		[Symbol.dispose]: () => {
			loaderCache.setIdentity(null)
			loaderCache.setLocation(null)
		},
	}
}

test('online, data from the loader cache revalidates at once', async () => {
	using _network = networkState(true)
	using page = await renderCachedPage()
	await screen.findByText('data {"fresh":1}')
	expect(page.server.calls).toBe(1)
})

test('offline, data from the loader cache waits to revalidate', async () => {
	using _network = networkState(false)
	using page = await renderCachedPage()
	await screen.findByText('data {"fresh":0}')
	await settle()
	expect(page.server.calls).toBe(0)
})

test('back online, the waiting revalidation runs once', async () => {
	using network = networkState(false)
	using page = await renderCachedPage()
	await screen.findByText('data {"fresh":0}')

	act(() => network.goOnline())
	await screen.findByText('data {"fresh":1}')
	act(() => window.dispatchEvent(new Event('online')))
	await settle()
	expect(page.server.calls).toBe(1)
})

test('data loaded while offline cancels the waiting revalidation', async () => {
	const user = userEvent.setup()
	using network = networkState(false)
	using page = await renderCachedPage()
	await screen.findByText('data {"fresh":0}')

	await user.click(screen.getByRole('button', { name: 'Retry' }))
	await screen.findByText('data {"fresh":1}')
	act(() => network.goOnline())
	await settle()
	expect(page.server.calls).toBe(1)
})
