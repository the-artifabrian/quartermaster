/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { createRoutesStub, useFetcher } from 'react-router'
import { expect, test, vi } from 'vitest'
import { loaderCache } from '#app/utils/loader-cache.ts'
import { ServiceWorkerDataSync } from './service-worker-data-sync.tsx'

const planRequest = new Request('https://useqm.app/plan')

/** Starts and ends a test with an empty, signed-out cache singleton. */
function freshCache() {
	const reset = () => {
		loaderCache.setIdentity(null)
		loaderCache.setLocation(null)
	}
	reset()
	return { [Symbol.dispose]: reset }
}

/**
 * Whether a navigation to /plan would be answered from memory. The cache reads
 * the committed location synchronously, so the probe sets it around the call.
 */
async function planIsCached(currentPath: string) {
	loaderCache.setLocation('/elsewhere')
	const result = loaderCache.load({
		request: planRequest,
		serverLoader: () => Promise.reject(new Error('not cached')),
	})
	loaderCache.setLocation(currentPath)
	return result.then(
		() => true,
		() => false,
	)
}

async function cachePlan(currentPath: string) {
	loaderCache.setLocation('/elsewhere')
	await loaderCache.load({
		request: planRequest,
		serverLoader: async () => ({ meals: [] }),
	})
	loaderCache.setLocation(currentPath)
	expect(await planIsCached(currentPath)).toBe(true)
}

test('a Shopping submission drops the loader cache when it starts and when it settles', async () => {
	using _cache = freshCache()
	let finish = () => {}
	const actionDone = new Promise<void>((resolve) => {
		finish = resolve
	})
	function ShoppingPage() {
		const fetcher = useFetcher()
		return (
			<>
				<ServiceWorkerDataSync userId="alex" householdId="home" />
				<button
					onClick={() =>
						fetcher.submit(
							{ intent: 'toggle' },
							{ method: 'POST', action: '/shopping' },
						)
					}
				>
					Check milk
				</button>
				<p>{fetcher.state}</p>
			</>
		)
	}
	const Stub = createRoutesStub([
		{
			path: '/shopping',
			Component: ShoppingPage,
			action: async () => {
				await actionDone
				return { status: 'success' }
			},
		},
	])
	render(<Stub initialEntries={['/shopping']} />)
	await screen.findByText('idle')
	await cachePlan('/shopping')

	await userEvent.click(screen.getByRole('button', { name: 'Check milk' }))
	await screen.findByText('submitting')
	await waitFor(async () => expect(await planIsCached('/shopping')).toBe(false))

	// Anything loaded while the write is in flight may predate it.
	await cachePlan('/shopping')
	finish()
	await screen.findByText('idle')
	await waitFor(async () => expect(await planIsCached('/shopping')).toBe(false))
})

test('switching user or signing out drops the loader cache', async () => {
	using _cache = freshCache()
	function Page() {
		const [userId, setUserId] = useState<string | null>('alex')
		return (
			<>
				<ServiceWorkerDataSync userId={userId} householdId="home" />
				<button onClick={() => setUserId('sam')}>Switch to Sam</button>
				<button onClick={() => setUserId(null)}>Log out</button>
			</>
		)
	}
	const Stub = createRoutesStub([{ path: '/shopping', Component: Page }])
	render(<Stub initialEntries={['/shopping']} />)
	await screen.findByRole('button', { name: 'Log out' })
	await cachePlan('/shopping')

	await userEvent.click(screen.getByRole('button', { name: 'Switch to Sam' }))
	await waitFor(async () => expect(await planIsCached('/shopping')).toBe(false))

	await cachePlan('/shopping')
	await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
	// Signed out, nothing is stored, so nothing can be served.
	await waitFor(async () => expect(await planIsCached('/shopping')).toBe(false))
})

test('the committed router location is what the cache compares against', async () => {
	using _cache = freshCache()
	const Stub = createRoutesStub([
		{
			path: '/shopping',
			Component: () => (
				<ServiceWorkerDataSync userId="alex" householdId="home" />
			),
		},
	])
	render(<Stub initialEntries={['/shopping']} />)
	const fail = () => Promise.reject(new Error('asked the server'))
	const shoppingRequest = new Request('https://useqm.app/shopping')
	await waitFor(async () => {
		await loaderCache.load({
			request: planRequest,
			serverLoader: async () => ({ meals: [] }),
		})
		await loaderCache.load({
			request: shoppingRequest,
			serverLoader: async () => ({}),
		})
		// /plan is somewhere else, so memory answers it.
		await loaderCache.load({ request: planRequest, serverLoader: fail })
	})
	// /shopping is where the router is, so it always goes to the server.
	await expect(
		loaderCache.load({ request: shoppingRequest, serverLoader: fail }),
	).rejects.toThrow('asked the server')
})

/** A service worker container the component can listen on, for one test. */
function fakeServiceWorkers() {
	const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
	const container = Object.assign(new EventTarget(), {
		controller: { postMessage: vi.fn() },
		ready: new Promise<never>(() => {}),
	})
	Object.defineProperty(navigator, 'serviceWorker', {
		configurable: true,
		value: container,
	})
	/** Sends the worker's session request; resolves with what the page replied. */
	function requestSession(type = 'qm-data-session-request') {
		const port = { postMessage: vi.fn() }
		container.dispatchEvent(
			Object.assign(new Event('message'), { data: { type }, ports: [port] }),
		)
		return port.postMessage
	}
	return {
		requestSession,
		[Symbol.dispose]() {
			if (original) Object.defineProperty(navigator, 'serviceWorker', original)
			else Reflect.deleteProperty(navigator, 'serviceWorker')
		},
	}
}

test("a restarted worker's session request gets the current session, or null signed out", async () => {
	using _cache = freshCache()
	using worker = fakeServiceWorkers()
	function Page() {
		const [userId, setUserId] = useState<string | null>('alex')
		return (
			<>
				<ServiceWorkerDataSync userId={userId} householdId="home" />
				<button onClick={() => setUserId('sam')}>Switch to Sam</button>
				<button onClick={() => setUserId(null)}>Log out</button>
			</>
		)
	}
	const Stub = createRoutesStub([{ path: '/plan', Component: Page }])
	render(<Stub initialEntries={['/plan']} />)
	await screen.findByRole('button', { name: 'Log out' })

	expect(worker.requestSession()).toHaveBeenCalledWith({ token: 'alex-home' })

	await userEvent.click(screen.getByRole('button', { name: 'Switch to Sam' }))
	expect(worker.requestSession()).toHaveBeenCalledWith({ token: 'sam-home' })

	await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
	expect(worker.requestSession()).toHaveBeenCalledWith({ token: null })
})

test('other worker messages get no session reply', async () => {
	using _cache = freshCache()
	using worker = fakeServiceWorkers()
	const Stub = createRoutesStub([
		{
			path: '/plan',
			Component: () => (
				<ServiceWorkerDataSync userId="alex" householdId="home" />
			),
		},
	])
	render(<Stub initialEntries={['/plan']} />)
	await waitFor(() => expect(worker.requestSession()).toHaveBeenCalledTimes(1))

	expect(worker.requestSession('qm-something-else')).not.toHaveBeenCalled()
})

function stubWorkers(registration: {
	active: { postMessage: ReturnType<typeof vi.fn> }
	waiting: { postMessage: ReturnType<typeof vi.fn> } | null
}) {
	const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
	Object.defineProperty(navigator, 'serviceWorker', {
		configurable: true,
		value: Object.assign(new EventTarget(), {
			controller: null,
			ready: Promise.resolve(registration),
		}),
	})
	vi.stubGlobal('requestIdleCallback', (callback: () => void) => callback())
	return {
		[Symbol.dispose]() {
			vi.unstubAllGlobals()
			if (original) Object.defineProperty(navigator, 'serviceWorker', original)
			else Reflect.deleteProperty(navigator, 'serviceWorker')
		},
	}
}

/** A fresh module is a fresh page load. */
async function loadSyncModule() {
	vi.resetModules()
	const { ServiceWorkerDataSync: FreshSync } =
		await import('./service-worker-data-sync.tsx')
	return createRoutesStub([
		{
			path: '/plan',
			Component: () => (
				<>
					<FreshSync userId="alex" householdId="home" />
					<FreshSync userId="alex" householdId="home" />
				</>
			),
		},
	])
}

function warmsSentTo(worker: { postMessage: ReturnType<typeof vi.fn> }) {
	return worker.postMessage.mock.calls.filter(
		([message]) => message?.type === 'qm-warm-assets',
	)
}

test('each page load asks the active worker to warm its chunks once', async () => {
	using _cache = freshCache()
	const active = { postMessage: vi.fn() }
	using _workers = stubWorkers({ active, waiting: null })
	const Stub = await loadSyncModule()

	const { unmount } = render(<Stub initialEntries={['/plan']} />)
	await waitFor(() => expect(warmsSentTo(active)).toHaveLength(1))
	unmount()
	render(<Stub initialEntries={['/plan']} />)
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(warmsSentTo(active)).toHaveLength(1)
})

// A message to the outgoing worker just after the update called skipWaiting
// left Chromium holding the new worker in waiting for minutes.
test('no warm request goes to a worker that a waiting update will replace', async () => {
	using _cache = freshCache()
	const active = { postMessage: vi.fn() }
	const waiting = { postMessage: vi.fn() }
	using _workers = stubWorkers({ active, waiting })
	const Stub = await loadSyncModule()

	render(<Stub initialEntries={['/plan']} />)
	await new Promise((resolve) => setTimeout(resolve, 50))

	expect(warmsSentTo(active)).toHaveLength(0)
	expect(waiting.postMessage).not.toHaveBeenCalled()
})
