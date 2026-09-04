/**
 * @vitest-environment jsdom
 */
import { act, render, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, test, vi } from 'vitest'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import {
	PWA_LAUNCHED,
	PWA_UPDATE_ACCEPTED,
	PWA_UPDATE_COMPLETED,
	PWA_UPDATE_PROMPT_SHOWN,
} from './posthog-events.ts'
import {
	type AnalyticsClient,
	PostHogIdentify,
	PostHogPageview,
	PostHogProvider,
	PostHogPwaLifecycle,
	PWA_RESUME_THRESHOLD_MS,
} from './posthog-provider.tsx'
import {
	markPendingPwaUpdateActivated,
	rememberPendingPwaUpdate,
	rememberPwaUpdatePrompt,
} from './pwa-update-telemetry.ts'

const PROMPT_UUID = '00000000-0000-4000-8000-000000000001'
const ACCEPTED_UUID = '00000000-0000-4000-8000-000000000002'

const posthogClientModule = vi.hoisted(() => ({
	initializePostHog: vi.fn(),
}))

vi.mock('./posthog.client.ts', () => posthogClientModule)

let runWhenIdle: IdleRequestCallback | undefined

function makeClient(): AnalyticsClient {
	return {
		capture: vi.fn(),
		captureException: vi.fn(),
		identify: vi.fn(),
		group: vi.fn(),
		registerForSession: vi.fn(),
		reset: vi.fn(),
		getFeatureFlag: vi.fn(),
	}
}

function setupAnalyticsEnvironment({
	hasIdleCallback = true,
}: { hasIdleCallback?: boolean } = {}) {
	const originalEnv = window.ENV
	runWhenIdle = undefined
	vi.clearAllMocks()
	sessionStorage.clear()
	window.ENV = {
		MODE: 'test',
		POSTHOG_API_KEY: 'phc_test',
		POSTHOG_HOST: 'https://analytics.example.com',
		APP_BUILD: 'abc123def456',
		ALLOW_INDEXING: 'false',
	}
	if (hasIdleCallback) {
		vi.stubGlobal(
			'requestIdleCallback',
			vi.fn((callback: IdleRequestCallback) => {
				runWhenIdle = callback
				return 17
			}),
		)
		vi.stubGlobal('cancelIdleCallback', vi.fn())
	} else {
		vi.stubGlobal('requestIdleCallback', undefined)
		vi.stubGlobal('cancelIdleCallback', undefined)
	}

	return {
		[Symbol.dispose]() {
			vi.unstubAllGlobals()
			if (originalEnv) window.ENV = originalEnv
			else Reflect.deleteProperty(window, 'ENV')
		},
	}
}

function renderAnalytics(
	element: React.ReactNode,
	initialEntry = '/recipes?view=mine',
) {
	const router = createMemoryRouter(
		[
			{
				id: 'routes/test',
				path: '*',
				element,
			},
		],
		{ initialEntries: [initialEntry] },
	)
	return render(
		<PostHogProvider>
			<RouterProvider router={router} />
		</PostHogProvider>,
	)
}

test('loads PostHog only when the browser is idle and replays initial analytics', async () => {
	using _environment = setupAnalyticsEnvironment()
	const client = makeClient()
	posthogClientModule.initializePostHog.mockReturnValue(client)

	renderAnalytics(
		<>
			<PostHogIdentify
				user={{ id: 'user-1', name: 'Ada', username: 'ada' }}
				householdId="household-1"
			/>
			<PostHogPageview />
		</>,
	)

	expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
		timeout: 2_000,
	})
	expect(posthogClientModule.initializePostHog).not.toHaveBeenCalled()
	expect(client.capture).not.toHaveBeenCalled()
	expect(client.identify).not.toHaveBeenCalled()

	await act(async () => {
		runWhenIdle?.({ didTimeout: false, timeRemaining: () => 50 })
	})

	await waitFor(() => {
		expect(posthogClientModule.initializePostHog).toHaveBeenCalledWith({
			apiKey: 'phc_test',
			host: 'https://analytics.example.com',
		})
	})
	expect(client.capture).toHaveBeenCalledWith('$pageview', {
		$current_url: window.location.href,
		route_id: 'routes/test',
	})
	expect(client.registerForSession).toHaveBeenCalledWith({
		app_build: 'abc123def456',
		display_mode: 'browser',
		initial_route: 'routes/test',
		navigation_type: 'unknown',
		initial_visibility: 'visible',
		service_worker_controlled: false,
		service_worker_state: 'uncontrolled',
	})
	expect(client.identify).toHaveBeenCalledWith('user-1', {
		name: 'Ada',
		username: 'ada',
	})
	expect(client.group).toHaveBeenCalledWith('household', 'household-1')
	expect(vi.mocked(client.identify).mock.invocationCallOrder[0]).toBeLessThan(
		vi.mocked(client.capture).mock.invocationCallOrder[0]!,
	)
	expect(
		vi.mocked(client.registerForSession).mock.invocationCallOrder[0],
	).toBeLessThan(vi.mocked(client.capture).mock.invocationCallOrder[0]!)
})

test('does not load or queue analytics when PostHog is not configured', () => {
	using _environment = setupAnalyticsEnvironment()
	window.ENV.POSTHOG_API_KEY = undefined

	renderAnalytics(<PostHogPageview />, '/')

	expect(requestIdleCallback).not.toHaveBeenCalled()
	expect(posthogClientModule.initializePostHog).not.toHaveBeenCalled()
})

test('gives the main thread a grace period when idle callbacks are unavailable', async () => {
	using _environment = setupAnalyticsEnvironment({ hasIdleCallback: false })
	const client = makeClient()
	posthogClientModule.initializePostHog.mockReturnValue(client)
	using setTimeoutSpy = vi.spyOn(window, 'setTimeout')

	renderAnalytics(<PostHogPageview />, '/')

	expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1_000)
	expect(posthogClientModule.initializePostHog).not.toHaveBeenCalled()

	const runFallback = setTimeoutSpy.mock.calls.find(
		([, timeout]) => timeout === 1_000,
	)?.[0]
	if (typeof runFallback === 'function') runFallback()

	await waitFor(() => {
		expect(posthogClientModule.initializePostHog).toHaveBeenCalledOnce()
	})
	expect(client.capture).toHaveBeenCalledWith('$pageview', {
		$current_url: window.location.href,
		route_id: 'routes/test',
	})
})

test('contains SDK initialization failures instead of failing the app', async () => {
	using _environment = setupAnalyticsEnvironment()
	const loadError = new Error('SDK unavailable')
	posthogClientModule.initializePostHog.mockImplementation(() => {
		throw loadError
	})
	consoleError.mockImplementation(() => undefined)

	renderAnalytics(<PostHogPageview />, '/')

	await act(async () => {
		runWhenIdle?.({ didTimeout: false, timeRemaining: () => 50 })
	})

	await waitFor(() => {
		expect(consoleError).toHaveBeenCalledWith(
			'Failed to load analytics',
			loadError,
		)
	})
})

test('reports one installed PWA launch before its first pageview', async () => {
	using _environment = setupAnalyticsEnvironment()
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({ matches: true })),
	)
	const client = makeClient()
	posthogClientModule.initializePostHog.mockReturnValue(client)

	renderAnalytics(<PostHogPageview />, '/recipes')
	await act(async () =>
		runWhenIdle?.({ didTimeout: false, timeRemaining: () => 50 }),
	)
	await waitFor(() =>
		expect(posthogClientModule.initializePostHog).toHaveBeenCalledOnce(),
	)

	expect(client.capture).toHaveBeenNthCalledWith(1, PWA_LAUNCHED, {
		app_build: 'abc123def456',
		display_mode: 'standalone',
		initial_route: 'routes/test',
		navigation_type: 'unknown',
		initial_visibility: 'visible',
		service_worker_controlled: false,
		service_worker_state: 'uncontrolled',
	})
	expect(client.capture).toHaveBeenNthCalledWith(2, '$pageview', {
		$current_url: window.location.href,
		route_id: 'routes/test',
	})
})

test('does not count a standalone document reload as a new PWA launch', async () => {
	using _environment = setupAnalyticsEnvironment()
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({ matches: true })),
	)
	vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
		{ type: 'reload' } as PerformanceNavigationTiming,
	])
	const client = makeClient()
	posthogClientModule.initializePostHog.mockReturnValue(client)

	renderAnalytics(<PostHogPageview />, '/recipes')
	await act(async () =>
		runWhenIdle?.({ didTimeout: false, timeRemaining: () => 50 }),
	)
	await waitFor(() =>
		expect(posthogClientModule.initializePostHog).toHaveBeenCalledOnce(),
	)

	expect(client.capture).not.toHaveBeenCalledWith(
		PWA_LAUNCHED,
		expect.anything(),
	)
	expect(client.capture).toHaveBeenCalledWith('$pageview', {
		$current_url: window.location.href,
		route_id: 'routes/test',
	})
})

test('reports an activated update after the replacement page loads', async () => {
	using _environment = setupAnalyticsEnvironment()
	using _now = vi.spyOn(Date, 'now').mockReturnValue(1_350)
	rememberPwaUpdatePrompt({
		workerState: 'installed',
		shownAt: 900,
		eventUuid: PROMPT_UUID,
	})
	rememberPendingPwaUpdate({
		fromBuild: 'old-build',
		acceptedAt: 1_000,
		eventUuid: ACCEPTED_UUID,
	})
	markPendingPwaUpdateActivated(1_200)
	const client = makeClient()
	posthogClientModule.initializePostHog.mockReturnValue(client)

	renderAnalytics(<PostHogPageview />, '/recipes')
	await act(async () =>
		runWhenIdle?.({ didTimeout: false, timeRemaining: () => 50 }),
	)
	await waitFor(() =>
		expect(posthogClientModule.initializePostHog).toHaveBeenCalledOnce(),
	)

	expect(client.capture).toHaveBeenCalledWith(
		PWA_UPDATE_PROMPT_SHOWN,
		{ worker_state: 'installed' },
		{ uuid: PROMPT_UUID, timestamp: new Date(900) },
	)
	expect(client.capture).toHaveBeenCalledWith(
		PWA_UPDATE_ACCEPTED,
		{ from_build: 'old-build', prompt_to_accepted_ms: 100 },
		{ uuid: ACCEPTED_UUID, timestamp: new Date(1_000) },
	)
	expect(client.capture).toHaveBeenCalledWith(
		PWA_UPDATE_COMPLETED,
		{
			from_build: 'old-build',
			to_build: 'abc123def456',
			build_changed: true,
			accepted_to_activated_ms: 200,
			accepted_to_completed_ms: 350,
		},
		{ uuid: expect.any(String), timestamp: new Date(1_350) },
	)
})

test('reports one warm resume after a meaningful background interval', async () => {
	using _environment = setupAnalyticsEnvironment()
	const originalVisibility = Object.getOwnPropertyDescriptor(
		document,
		'visibilityState',
	)
	using _visibility = {
		[Symbol.dispose]() {
			if (originalVisibility)
				Object.defineProperty(document, 'visibilityState', originalVisibility)
			else Reflect.deleteProperty(document, 'visibilityState')
		},
	}
	let now = new Date('2026-09-03T08:00:00Z').getTime()
	vi.spyOn(Date, 'now').mockImplementation(() => now)
	const client = makeClient()
	posthogClientModule.initializePostHog.mockReturnValue(client)
	let visibilityState: DocumentVisibilityState = 'visible'
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => visibilityState,
	})

	renderAnalytics(<PostHogPwaLifecycle />, '/plan')
	await act(async () =>
		runWhenIdle?.({ didTimeout: false, timeRemaining: () => 50 }),
	)
	await waitFor(() =>
		expect(posthogClientModule.initializePostHog).toHaveBeenCalledOnce(),
	)

	act(() => {
		visibilityState = 'hidden'
		document.dispatchEvent(new Event('visibilitychange'))
		now += PWA_RESUME_THRESHOLD_MS - 1
		visibilityState = 'visible'
		document.dispatchEvent(new Event('visibilitychange'))
	})
	expect(client.capture).not.toHaveBeenCalled()

	act(() => {
		visibilityState = 'hidden'
		document.dispatchEvent(new Event('visibilitychange'))
		now += PWA_RESUME_THRESHOLD_MS
		visibilityState = 'visible'
		document.dispatchEvent(new Event('visibilitychange'))
		document.dispatchEvent(new Event('visibilitychange'))
	})

	expect(client.capture).toHaveBeenCalledTimes(1)
	expect(client.capture).toHaveBeenCalledWith('pwa_resumed', {
		background_duration_ms: PWA_RESUME_THRESHOLD_MS,
		route_id: 'routes/test',
		service_worker_controlled: false,
		service_worker_state: 'uncontrolled',
	})
})
