/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { expect, test, vi } from 'vitest'
import {
	PWA_UPDATE_ACCEPTED,
	PWA_UPDATE_PROMPT_SHOWN,
} from '#app/utils/posthog-events.ts'
import { getPwaUpdateTelemetry } from '#app/utils/pwa-update-telemetry.ts'
import {
	hasPendingRouterWork,
	ServiceWorkerUpdate,
	UPDATE_CHECK_INTERVAL_MS,
} from './service-worker-update.tsx'

const page = vi.hoisted(() => ({ reload: vi.fn() }))
const analytics = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock('#app/utils/reload-page.client.ts', () => ({
	reloadPage: page.reload,
}))
vi.mock('#app/utils/posthog-provider.tsx', () => ({
	usePostHog: () => analytics,
}))

class FakeWorker extends EventTarget {
	state: ServiceWorkerState = 'installed'
	postMessage = vi.fn()

	transitionTo(state: ServiceWorkerState) {
		this.state = state
		this.dispatchEvent(new Event('statechange'))
	}
}

class FakeRegistration extends EventTarget {
	active: FakeWorker | null = new FakeWorker()
	waiting: FakeWorker | null = null
	installing: FakeWorker | null = null
	update = vi.fn(async () => {})
}

class FakeServiceWorkerContainer extends EventTarget {
	controller: ServiceWorker | null = {} as ServiceWorker

	constructor(private readonly registration: FakeRegistration) {
		super()
	}

	register = vi.fn(
		async () => this.registration as unknown as ServiceWorkerRegistration,
	)
}

function setupBrowserEnvironment() {
	const originalServiceWorker = Object.getOwnPropertyDescriptor(
		navigator,
		'serviceWorker',
	)
	vi.stubGlobal('ENV', {
		MODE: 'production',
		APP_BUILD: 'old-build',
	})
	const readyState = vi
		.spyOn(document, 'readyState', 'get')
		.mockReturnValue('complete')
	vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
	page.reload.mockClear()
	analytics.capture.mockClear()
	sessionStorage.clear()

	return {
		readyState,
		[Symbol.dispose]() {
			vi.unstubAllGlobals()
			if (originalServiceWorker) {
				Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker)
			} else {
				Reflect.deleteProperty(navigator, 'serviceWorker')
			}
		},
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

function renderUpdateControl(
	registration: FakeRegistration,
	{
		controller = {} as ServiceWorker,
		nextElement = <div>Next</div>,
		nextLoader,
	}: {
		controller?: ServiceWorker | null
		nextElement?: React.ReactNode
		nextLoader?: () => Promise<unknown>
	} = {},
) {
	const serviceWorkers = new FakeServiceWorkerContainer(registration)
	serviceWorkers.controller = controller
	Object.defineProperty(navigator, 'serviceWorker', {
		configurable: true,
		value: serviceWorkers,
	})
	const router = createMemoryRouter(
		[
			{
				path: '/',
				element: (
					<>
						<ServiceWorkerUpdate />
						<Outlet />
					</>
				),
				children: [
					{ index: true, element: <div>Home</div> },
					{ path: 'next', element: nextElement, loader: nextLoader },
				],
			},
		],
		{ initialEntries: ['/'] },
	)
	render(<RouterProvider router={router} />)
	return { router, serviceWorkers }
}

test('a waiting update requires confirmation and reloads once after activation', async () => {
	using _environment = setupBrowserEnvironment()
	const user = userEvent.setup()
	const worker = new FakeWorker()
	const registration = new FakeRegistration()
	registration.waiting = worker
	const { serviceWorkers } = renderUpdateControl(registration)
	const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

	const update = await screen.findByRole('button', {
		name: 'Update available',
	})
	await waitFor(() =>
		expect(analytics.capture).toHaveBeenCalledWith(
			PWA_UPDATE_PROMPT_SHOWN,
			{ worker_state: 'installed' },
			{
				uuid: expect.any(String),
				timestamp: expect.any(Date),
			},
		),
	)
	expect(registration.update).not.toHaveBeenCalled()

	await user.click(update)
	expect(confirm).toHaveBeenCalledWith(expect.stringContaining('unsaved edits'))
	expect(worker.postMessage).not.toHaveBeenCalled()

	confirm.mockReturnValue(true)
	await user.click(update)
	expect(worker.postMessage).toHaveBeenCalledWith({
		type: 'qm-activate-update',
	})
	expect(analytics.capture).toHaveBeenCalledWith(
		PWA_UPDATE_ACCEPTED,
		expect.objectContaining({ from_build: 'old-build' }),
		{
			uuid: expect.any(String),
			timestamp: expect.any(Date),
		},
	)
	expect(update).toBeDisabled()

	act(() => {
		worker.transitionTo('activated')
		serviceWorkers.dispatchEvent(new Event('controllerchange'))
		serviceWorkers.dispatchEvent(new Event('controllerchange'))
	})
	expect(page.reload).toHaveBeenCalledTimes(1)
	expect(
		getPwaUpdateTelemetry({ toBuild: 'new-build' }).completed?.properties,
	).toMatchObject({
		from_build: 'old-build',
		to_build: 'new-build',
		build_changed: true,
	})
})

test('an accepted update reloads after activation when the page is not controlled', async () => {
	using _environment = setupBrowserEnvironment()
	const user = userEvent.setup()
	const worker = new FakeWorker()
	const registration = new FakeRegistration()
	registration.waiting = worker
	renderUpdateControl(registration, { controller: null })
	vi.spyOn(window, 'confirm').mockReturnValue(true)

	const update = await screen.findByRole('button', {
		name: 'Update available',
	})
	await user.click(update)
	expect(worker.postMessage).toHaveBeenCalledWith({
		type: 'qm-activate-update',
	})
	expect(update).toHaveAccessibleName('Updating…')

	act(() => worker.transitionTo('activated'))

	await waitFor(() => expect(page.reload).toHaveBeenCalledTimes(1))
})

test('accepting a worker that has just activated still reloads the page', async () => {
	using _environment = setupBrowserEnvironment()
	const user = userEvent.setup()
	const worker = new FakeWorker()
	const registration = new FakeRegistration()
	registration.waiting = worker
	renderUpdateControl(registration, { controller: null })
	vi.spyOn(window, 'confirm').mockReturnValue(true)

	const update = await screen.findByRole('button', {
		name: 'Update available',
	})
	act(() => worker.transitionTo('activated'))
	await user.click(update)

	await waitFor(() => expect(page.reload).toHaveBeenCalledTimes(1))
})

test('registration waits until the initial page load has completed', async () => {
	using environment = setupBrowserEnvironment()
	environment.readyState.mockReturnValue('loading')
	const registration = new FakeRegistration()
	const { serviceWorkers } = renderUpdateControl(registration)

	expect(serviceWorkers.register).not.toHaveBeenCalled()
	window.dispatchEvent(new Event('load'))
	await waitFor(() =>
		expect(serviceWorkers.register).toHaveBeenCalledWith('/sw.js'),
	)
})

test('a first installation is not presented as an update', async () => {
	using _environment = setupBrowserEnvironment()
	const registration = new FakeRegistration()
	registration.active = null
	registration.waiting = new FakeWorker()
	const { serviceWorkers } = renderUpdateControl(registration)

	await waitFor(() => expect(serviceWorkers.register).toHaveBeenCalled())
	expect(
		screen.queryByRole('button', { name: 'Update available' }),
	).not.toBeInTheDocument()
})

test('the update action waits for an active navigation to finish', async () => {
	using _environment = setupBrowserEnvironment()
	const loader = deferred<null>()
	const worker = new FakeWorker()
	const registration = new FakeRegistration()
	registration.waiting = worker
	const { router } = renderUpdateControl(registration, {
		nextLoader: () => loader.promise,
	})

	await screen.findByRole('button', { name: 'Update available' })
	let navigation = Promise.resolve()
	act(() => {
		navigation = router.navigate('/next')
	})
	await waitFor(() => expect(router.state.navigation.state).toBe('loading'))
	expect(
		screen.queryByRole('button', { name: 'Update available' }),
	).not.toBeInTheDocument()

	await act(async () => {
		loader.resolve(null)
		await navigation
	})
	await screen.findByRole('button', { name: 'Update available' })
})

test('fetcher mutations count as pending work but fetcher loads do not', () => {
	const idleNavigation = { state: 'idle' } as const
	const mutation = {
		state: 'submitting',
		formMethod: 'POST',
	} as const
	const load = {
		state: 'loading',
		formMethod: 'GET',
	} as const

	expect(hasPendingRouterWork(idleNavigation, [mutation])).toBe(true)
	expect(hasPendingRouterWork(idleNavigation, [load])).toBe(false)
})

test('foreground checks are throttled and recover after a failed request', async () => {
	using _environment = setupBrowserEnvironment()
	let now = 1_000
	vi.spyOn(Date, 'now').mockImplementation(() => now)
	const worker = new FakeWorker()
	const registration = new FakeRegistration()
	registration.update
		.mockRejectedValueOnce(new TypeError('Offline'))
		.mockImplementationOnce(async () => {
			registration.waiting = worker
		})
	renderUpdateControl(registration)

	await waitFor(() => expect(registration.update).not.toHaveBeenCalled())
	await act(async () => {
		document.dispatchEvent(new Event('visibilitychange'))
	})
	expect(registration.update).not.toHaveBeenCalled()

	now += UPDATE_CHECK_INTERVAL_MS
	await act(async () => {
		document.dispatchEvent(new Event('visibilitychange'))
	})
	await waitFor(() => expect(registration.update).toHaveBeenCalledTimes(1))
	await act(async () => {
		document.dispatchEvent(new Event('visibilitychange'))
	})
	expect(registration.update).toHaveBeenCalledTimes(1)
	expect(
		screen.queryByRole('button', { name: 'Update available' }),
	).not.toBeInTheDocument()

	now += UPDATE_CHECK_INTERVAL_MS
	await act(async () => {
		document.dispatchEvent(new Event('visibilitychange'))
	})
	await screen.findByRole('button', { name: 'Update available' })
	expect(registration.update).toHaveBeenCalledTimes(2)
})

test('a controller change accepted in another window does not reload this one', async () => {
	using _environment = setupBrowserEnvironment()
	const registration = new FakeRegistration()
	registration.waiting = new FakeWorker()
	const { serviceWorkers } = renderUpdateControl(registration)

	await screen.findByRole('button', { name: 'Update available' })
	await act(async () => {
		serviceWorkers.dispatchEvent(new Event('controllerchange'))
	})

	await waitFor(() =>
		expect(
			screen.queryByRole('button', { name: 'Update available' }),
		).not.toBeInTheDocument(),
	)
	expect(page.reload).not.toHaveBeenCalled()
})

test('an offline client keeps its current page instead of accepting the update', async () => {
	using _environment = setupBrowserEnvironment()
	vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
	const registration = new FakeRegistration()
	const worker = new FakeWorker()
	registration.waiting = worker
	renderUpdateControl(registration)

	const update = await screen.findByRole('button', {
		name: 'Update when online',
	})
	expect(update).toBeDisabled()
	expect(worker.postMessage).not.toHaveBeenCalled()
	expect(page.reload).not.toHaveBeenCalled()
})

test('an installing worker becomes visible only after it is waiting', async () => {
	using _environment = setupBrowserEnvironment()
	const worker = new FakeWorker()
	worker.state = 'installing'
	const registration = new FakeRegistration()
	registration.installing = worker
	renderUpdateControl(registration)

	expect(
		screen.queryByRole('button', { name: 'Update available' }),
	).not.toBeInTheDocument()
	registration.waiting = worker
	act(() => worker.transitionTo('installed'))

	await screen.findByRole('button', { name: 'Update available' })
})
