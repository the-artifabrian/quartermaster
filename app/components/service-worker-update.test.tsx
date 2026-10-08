/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { expect, test, vi } from 'vitest'
import {
	PWA_UPDATE_ACCEPTED,
	PWA_UPDATE_PROMPT_SHOWN,
} from '#app/utils/posthog-events.ts'
import {
	getPwaUpdateTelemetry,
	PWA_UPDATE_STORAGE_KEY,
} from '#app/utils/pwa-update-telemetry.ts'
import {
	ACTIVATION_RELOAD_DEADLINE_MS,
	hasPendingRouterWork,
	RESUME_ACTIVATION_AFTER_MS,
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

const MINUTE = 60 * 1000
const ACTIVATE = { type: 'qm-activate-update' }

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
	vi.useFakeTimers({ toFake: ['Date'] })
	vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
	vi.stubGlobal('ENV', {
		MODE: 'production',
		APP_BUILD: 'old-build',
	})
	const readyState = vi
		.spyOn(document, 'readyState', 'get')
		.mockReturnValue('complete')
	const visibility = vi
		.spyOn(document, 'visibilityState', 'get')
		.mockReturnValue('visible')
	const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
	page.reload.mockClear()
	analytics.capture.mockClear()
	sessionStorage.clear()

	return {
		readyState,
		visibility,
		online,
		[Symbol.dispose]() {
			vi.useRealTimers()
			vi.unstubAllGlobals()
			vi.restoreAllMocks()
			if (originalServiceWorker) {
				Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker)
			} else {
				Reflect.deleteProperty(navigator, 'serviceWorker')
			}
		},
	}
}

type Environment = ReturnType<typeof setupBrowserEnvironment>

/** Background the page, let `minutes` pass, and bring it back. */
async function returnAfter(environment: Environment, minutes: number) {
	await act(async () => {
		environment.visibility.mockReturnValue('hidden')
		document.dispatchEvent(new Event('visibilitychange'))
	})
	vi.setSystemTime(Date.now() + minutes * MINUTE)
	await act(async () => {
		environment.visibility.mockReturnValue('visible')
		document.dispatchEvent(new Event('visibilitychange'))
	})
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
		nextLoader,
		registered,
	}: {
		controller?: ServiceWorker | null
		nextLoader?: () => Promise<unknown>
		registered?: Promise<FakeRegistration>
	} = {},
) {
	const serviceWorkers = new FakeServiceWorkerContainer(registration)
	serviceWorkers.controller = controller
	if (registered) {
		serviceWorkers.register.mockImplementation(
			() => registered as unknown as Promise<ServiceWorkerRegistration>,
		)
	}
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
					{ path: 'next', element: <div>Next</div>, loader: nextLoader },
				],
			},
		],
		{ initialEntries: ['/'] },
	)
	const view = render(<RouterProvider router={router} />)
	return { router, serviceWorkers, view }
}

/** Launch without an update, then have a worker finish installing. */
async function launchThenInstallUpdate(
	options: Parameters<typeof renderUpdateControl>[1] = {},
) {
	const registration = new FakeRegistration()
	const worker = new FakeWorker()
	worker.state = 'installing'
	registration.installing = worker
	const rendered = renderUpdateControl(registration, options)
	await waitFor(() =>
		expect(rendered.serviceWorkers.register).toHaveBeenCalled(),
	)
	await act(async () => {
		registration.installing = null
		registration.waiting = worker
		worker.transitionTo('installed')
	})
	return { ...rendered, registration, worker }
}

// Failure list: a cold launch with a waiting worker activates it before the
// first interaction and reloads at most once.
test('a cold launch applies a waiting update without asking and reloads once', async () => {
	using _environment = setupBrowserEnvironment()
	const worker = new FakeWorker()
	const registration = new FakeRegistration()
	registration.waiting = worker
	const { serviceWorkers } = renderUpdateControl(registration)

	await waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(ACTIVATE))
	expect(screen.queryByRole('button')).not.toBeInTheDocument()
	expect(screen.queryByRole('status')).not.toBeInTheDocument()
	expect(analytics.capture).toHaveBeenCalledWith(
		PWA_UPDATE_PROMPT_SHOWN,
		{ worker_state: 'installed', trigger: 'launch' },
		{ uuid: expect.any(String), timestamp: expect.any(Date) },
	)
	expect(analytics.capture).toHaveBeenCalledWith(
		PWA_UPDATE_ACCEPTED,
		expect.objectContaining({ from_build: 'old-build' }),
		{ uuid: expect.any(String), timestamp: expect.any(Date) },
	)
	expect(page.reload).not.toHaveBeenCalled()

	act(() => {
		worker.transitionTo('activated')
		serviceWorkers.dispatchEvent(new Event('controllerchange'))
		serviceWorkers.dispatchEvent(new Event('controllerchange'))
	})
	expect(page.reload).toHaveBeenCalledTimes(1)
	expect(worker.postMessage).toHaveBeenCalledTimes(1)
	const telemetry = getPwaUpdateTelemetry({ toBuild: 'new-build' })
	expect(telemetry.prompt?.properties).toEqual({
		worker_state: 'installed',
		trigger: 'launch',
	})
	expect(telemetry.completed?.properties).toMatchObject({
		from_build: 'old-build',
		to_build: 'new-build',
		build_changed: true,
	})
})

// Failure list: a browser can hold the activation for minutes. The reload
// must not land on someone who has started using the page meanwhile.
test('an activation that completes after a tap keeps the page', async () => {
	using _environment = setupBrowserEnvironment()
	const worker = new FakeWorker()
	const registration = new FakeRegistration()
	registration.waiting = worker
	const { serviceWorkers } = renderUpdateControl(registration)
	await waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(ACTIVATE))

	await act(async () => {
		window.dispatchEvent(new Event('pointerdown'))
	})
	act(() => {
		worker.transitionTo('activated')
		serviceWorkers.dispatchEvent(new Event('controllerchange'))
	})

	expect(page.reload).not.toHaveBeenCalled()
})

test('an activation that completes after the reload deadline keeps the page', async () => {
	using _environment = setupBrowserEnvironment()
	const worker = new FakeWorker()
	const registration = new FakeRegistration()
	registration.waiting = worker
	const { serviceWorkers } = renderUpdateControl(registration, {
		controller: null,
	})
	await waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(ACTIVATE))

	vi.setSystemTime(Date.now() + ACTIVATION_RELOAD_DEADLINE_MS + 1)
	act(() => {
		worker.transitionTo('activated')
		serviceWorkers.dispatchEvent(new Event('controllerchange'))
	})

	expect(page.reload).not.toHaveBeenCalled()
})

test('a launch update reloads after activation when the page is not controlled', async () => {
	using _environment = setupBrowserEnvironment()
	const worker = new FakeWorker()
	const registration = new FakeRegistration()
	registration.waiting = worker
	renderUpdateControl(registration, { controller: null })

	await waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(ACTIVATE))
	act(() => worker.transitionTo('activated'))

	await waitFor(() => expect(page.reload).toHaveBeenCalledTimes(1))
})

// Failure list: a worker that becomes waiting mid-session does not reload.
test('a worker that becomes waiting mid-session stays waiting', async () => {
	using _environment = setupBrowserEnvironment()
	const { worker } = await launchThenInstallUpdate()

	await act(async () => {})
	expect(worker.postMessage).not.toHaveBeenCalled()
	expect(page.reload).not.toHaveBeenCalled()
	expect(analytics.capture).not.toHaveBeenCalled()
})

// Failure list: a resume after 29 minutes does not reload; after 31 it does,
// once. Thirty minutes is the boundary.
test.each([
	{ minutes: 1, activates: false },
	{ minutes: 29, activates: false },
	{ minutes: RESUME_ACTIVATION_AFTER_MS / MINUTE, activates: true },
	{ minutes: 31, activates: true },
])(
	'a return after $minutes minutes away applies the update: $activates',
	async ({ minutes, activates }) => {
		using environment = setupBrowserEnvironment()
		const { worker } = await launchThenInstallUpdate()

		await returnAfter(environment, minutes)

		if (!activates) {
			expect(worker.postMessage).not.toHaveBeenCalled()
			expect(analytics.capture).not.toHaveBeenCalled()
			return
		}
		await waitFor(() =>
			expect(worker.postMessage).toHaveBeenCalledWith(ACTIVATE),
		)
		expect(analytics.capture).toHaveBeenCalledWith(
			PWA_UPDATE_PROMPT_SHOWN,
			{ worker_state: 'installed', trigger: 'resume' },
			expect.anything(),
		)
	},
)

test('a long resume activates once and reloads once', async () => {
	using environment = setupBrowserEnvironment()
	const { worker, serviceWorkers } = await launchThenInstallUpdate()

	await returnAfter(environment, 31)
	await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))

	act(() => {
		worker.transitionTo('activated')
		serviceWorkers.dispatchEvent(new Event('controllerchange'))
		serviceWorkers.dispatchEvent(new Event('controllerchange'))
	})
	expect(page.reload).toHaveBeenCalledTimes(1)
	expect(worker.postMessage).toHaveBeenCalledTimes(1)
})

test('becoming visible without having been hidden is not a resume', async () => {
	using environment = setupBrowserEnvironment()
	const { worker } = await launchThenInstallUpdate()

	vi.setSystemTime(Date.now() + 31 * MINUTE)
	await act(async () => {
		environment.visibility.mockReturnValue('visible')
		document.dispatchEvent(new Event('visibilitychange'))
	})

	expect(worker.postMessage).not.toHaveBeenCalled()
})

test('a launch that found no update does not apply one installed later in the session', async () => {
	using _environment = setupBrowserEnvironment()
	const registration = new FakeRegistration()
	const { serviceWorkers } = renderUpdateControl(registration)
	await waitFor(() => expect(serviceWorkers.register).toHaveBeenCalled())
	await act(async () => {})

	const worker = new FakeWorker()
	await act(async () => {
		registration.waiting = worker
		registration.dispatchEvent(new Event('updatefound'))
	})
	await act(async () => {})

	expect(worker.postMessage).not.toHaveBeenCalled()
})

// Failure list: offline resume, no activation and no reload loop.
test('offline launches and resumes keep the current page', async () => {
	using environment = setupBrowserEnvironment()
	environment.online.mockReturnValue(false)
	const worker = new FakeWorker()
	const registration = new FakeRegistration()
	registration.waiting = worker
	const { serviceWorkers } = renderUpdateControl(registration)
	await waitFor(() => expect(serviceWorkers.register).toHaveBeenCalled())
	await act(async () => {})

	await returnAfter(environment, 31)
	// Coming back online is not a launch either.
	environment.online.mockReturnValue(true)
	await act(async () => {
		window.dispatchEvent(new Event('online'))
	})
	expect(worker.postMessage).not.toHaveBeenCalled()
	expect(page.reload).not.toHaveBeenCalled()
	expect(analytics.capture).not.toHaveBeenCalled()

	// The next long resume online applies it.
	await returnAfter(environment, 31)
	await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
})

test('an activation the worker cannot receive keeps the page and forgets its telemetry', async () => {
	using _environment = setupBrowserEnvironment()
	const worker = new FakeWorker()
	worker.postMessage.mockImplementation(() => {
		throw new DOMException('The worker is gone', 'InvalidStateError')
	})
	const registration = new FakeRegistration()
	registration.waiting = worker
	renderUpdateControl(registration)

	await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
	await act(async () => {})

	expect(worker.postMessage).toHaveBeenCalledTimes(1)
	expect(page.reload).not.toHaveBeenCalled()
	expect(sessionStorage.getItem(PWA_UPDATE_STORAGE_KEY)).toBeNull()
})

// Failure list: two open windows. The other window's activation must not
// reload this one; the retained N-1 cache keeps it working.
test('an update applied by another window does not reload this one', async () => {
	using environment = setupBrowserEnvironment()
	const { worker, registration, serviceWorkers } =
		await launchThenInstallUpdate()

	await act(async () => {
		worker.transitionTo('activated')
		registration.active = worker
		registration.waiting = null
		serviceWorkers.dispatchEvent(new Event('controllerchange'))
	})
	await returnAfter(environment, 31)

	expect(page.reload).not.toHaveBeenCalled()
	expect(worker.postMessage).not.toHaveBeenCalled()
})

// Failure list: the iOS shell's pull to refresh is not a launch.
test('pull to refresh in the iOS shell does not apply a waiting update', async () => {
	using _environment = setupBrowserEnvironment()
	const { worker } = await launchThenInstallUpdate()

	await act(async () => {
		window.dispatchEvent(new CustomEvent('qm:refresh'))
	})

	expect(worker.postMessage).not.toHaveBeenCalled()
	expect(page.reload).not.toHaveBeenCalled()
})

test('a launch update waits for a pending navigation to finish', async () => {
	using _environment = setupBrowserEnvironment()
	const loader = deferred<null>()
	const registered = deferred<FakeRegistration>()
	const worker = new FakeWorker()
	const registration = new FakeRegistration()
	registration.waiting = worker
	const { router } = renderUpdateControl(registration, {
		nextLoader: () => loader.promise,
		registered: registered.promise,
	})

	let navigation = Promise.resolve()
	act(() => {
		navigation = router.navigate('/next')
	})
	await waitFor(() => expect(router.state.navigation.state).toBe('loading'))
	await act(async () => registered.resolve(registration))
	expect(worker.postMessage).not.toHaveBeenCalled()

	await act(async () => {
		loader.resolve(null)
		await navigation
	})
	await waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(ACTIVATE))
})

test.each(['pointerdown', 'keydown'])(
	'a %s before the launch update could start keeps the page as it is',
	async (interaction) => {
		using _environment = setupBrowserEnvironment()
		const registered = deferred<FakeRegistration>()
		const worker = new FakeWorker()
		const registration = new FakeRegistration()
		registration.waiting = worker
		const { serviceWorkers } = renderUpdateControl(registration, {
			registered: registered.promise,
		})
		await waitFor(() => expect(serviceWorkers.register).toHaveBeenCalled())

		await act(async () => {
			window.dispatchEvent(new Event(interaction))
		})
		await act(async () => registered.resolve(registration))
		await act(async () => {})

		expect(worker.postMessage).not.toHaveBeenCalled()
	},
)

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

test('a first installation is not treated as an update', async () => {
	using _environment = setupBrowserEnvironment()
	const registration = new FakeRegistration()
	registration.active = null
	const worker = new FakeWorker()
	registration.waiting = worker
	const { serviceWorkers } = renderUpdateControl(registration)

	await waitFor(() => expect(serviceWorkers.register).toHaveBeenCalled())
	await act(async () => {})
	expect(worker.postMessage).not.toHaveBeenCalled()
	expect(analytics.capture).not.toHaveBeenCalled()
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

	vi.setSystemTime(Date.now() + UPDATE_CHECK_INTERVAL_MS)
	await act(async () => {
		document.dispatchEvent(new Event('visibilitychange'))
	})
	await waitFor(() => expect(registration.update).toHaveBeenCalledTimes(1))
	await act(async () => {
		document.dispatchEvent(new Event('visibilitychange'))
	})
	expect(registration.update).toHaveBeenCalledTimes(1)

	vi.setSystemTime(Date.now() + UPDATE_CHECK_INTERVAL_MS)
	await act(async () => {
		document.dispatchEvent(new Event('visibilitychange'))
	})
	await waitFor(() => expect(registration.update).toHaveBeenCalledTimes(2))
	// A worker found by a foreground check waits for the next launch or long
	// resume.
	await act(async () => {})
	expect(worker.postMessage).not.toHaveBeenCalled()
})
