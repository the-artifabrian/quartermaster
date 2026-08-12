/**
 * @vitest-environment jsdom
 */
import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, test, vi } from 'vitest'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import {
	type AnalyticsClient,
	PostHogIdentify,
	PostHogPageview,
	PostHogProvider,
} from './posthog-provider.tsx'

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
	window.ENV = {
		MODE: 'test',
		POSTHOG_API_KEY: 'phc_test',
		POSTHOG_HOST: 'https://analytics.example.com',
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

test('loads PostHog only when the browser is idle and replays initial analytics', async () => {
	using _environment = setupAnalyticsEnvironment()
	const client = makeClient()
	posthogClientModule.initializePostHog.mockReturnValue(client)

	render(
		<PostHogProvider>
			<MemoryRouter initialEntries={['/recipes?view=mine']}>
				<PostHogPageview />
				<PostHogIdentify
					user={{ id: 'user-1', name: 'Ada', username: 'ada' }}
					householdId="household-1"
				/>
			</MemoryRouter>
		</PostHogProvider>,
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
	})
	expect(client.identify).toHaveBeenCalledWith('user-1', {
		name: 'Ada',
		username: 'ada',
	})
	expect(client.group).toHaveBeenCalledWith('household', 'household-1')
})

test('does not load or queue analytics when PostHog is not configured', () => {
	using _environment = setupAnalyticsEnvironment()
	window.ENV.POSTHOG_API_KEY = undefined

	render(
		<PostHogProvider>
			<MemoryRouter>
				<PostHogPageview />
			</MemoryRouter>
		</PostHogProvider>,
	)

	expect(requestIdleCallback).not.toHaveBeenCalled()
	expect(posthogClientModule.initializePostHog).not.toHaveBeenCalled()
})

test('gives the main thread a grace period when idle callbacks are unavailable', async () => {
	using _environment = setupAnalyticsEnvironment({ hasIdleCallback: false })
	const client = makeClient()
	posthogClientModule.initializePostHog.mockReturnValue(client)
	using setTimeoutSpy = vi.spyOn(window, 'setTimeout')

	render(
		<PostHogProvider>
			<MemoryRouter>
				<PostHogPageview />
			</MemoryRouter>
		</PostHogProvider>,
	)

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
	})
})

test('contains SDK initialization failures instead of failing the app', async () => {
	using _environment = setupAnalyticsEnvironment()
	const loadError = new Error('SDK unavailable')
	posthogClientModule.initializePostHog.mockImplementation(() => {
		throw loadError
	})
	consoleError.mockImplementation(() => undefined)

	render(
		<PostHogProvider>
			<MemoryRouter>
				<PostHogPageview />
			</MemoryRouter>
		</PostHogProvider>,
	)

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
