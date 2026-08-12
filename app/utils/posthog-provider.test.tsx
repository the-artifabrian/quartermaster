/**
 * @vitest-environment jsdom
 */
import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, test, vi } from 'vitest'
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

function setupAnalyticsEnvironment() {
	const originalEnv = window.ENV
	runWhenIdle = undefined
	vi.clearAllMocks()
	window.ENV = {
		MODE: 'test',
		POSTHOG_API_KEY: 'phc_test',
		POSTHOG_HOST: 'https://analytics.example.com',
		ALLOW_INDEXING: 'false',
	}
	vi.stubGlobal(
		'requestIdleCallback',
		vi.fn((callback: IdleRequestCallback) => {
			runWhenIdle = callback
			return 17
		}),
	)
	vi.stubGlobal('cancelIdleCallback', vi.fn())

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
