import { expect, test, vi } from 'vitest'
import { initializePostHog } from './posthog.client.ts'

const posthog = vi.hoisted(() => ({
	__loaded: false,
	init: vi.fn<(apiKey: string, options: Record<string, unknown>) => void>(),
	capture: vi.fn(),
	captureException: vi.fn(),
	identify: vi.fn(),
	group: vi.fn(),
	register_for_session: vi.fn(),
	reset: vi.fn(),
	getFeatureFlag: vi.fn(),
}))

vi.mock('posthog-js', () => ({ default: posthog }))

test('initializes the deferred SDK with the existing privacy and performance behavior', () => {
	vi.clearAllMocks()
	posthog.__loaded = false
	posthog.init.mockImplementation(() => {
		posthog.__loaded = true
	})

	const client = initializePostHog({
		apiKey: 'phc_test',
		host: 'https://analytics.example.com',
	})

	expect(posthog.init).toHaveBeenCalledWith(
		'phc_test',
		expect.objectContaining({
			api_host: 'https://analytics.example.com',
			capture_pageview: false,
			capture_pageleave: true,
			person_profiles: 'identified_only',
			persistence: 'localStorage+cookie',
			capture_exceptions: true,
			capture_performance: { web_vitals: true, network_timing: true },
		}),
	)

	const options = posthog.init.mock.calls[0]![1]
	const beforeSend = options.before_send as (event: {
		event: string
		properties?: Record<string, unknown>
	}) => unknown
	expect(
		beforeSend({
			event: '$exception',
			properties: { message: 'Object Not Found Matching Id:7' },
		}),
	).toBeNull()

	const captureOptions = {
		uuid: '00000000-0000-4000-8000-000000000001',
		timestamp: new Date(1_000),
	}
	client.capture('$pageview', { path: '/recipes' }, captureOptions)
	client.registerForSession({ display_mode: 'standalone' })
	client.identify('user-1', { name: 'Ada' })
	expect(posthog.capture).toHaveBeenCalledWith(
		'$pageview',
		{ path: '/recipes' },
		captureOptions,
	)
	expect(posthog.identify).toHaveBeenCalledWith('user-1', { name: 'Ada' })
	expect(posthog.register_for_session).toHaveBeenCalledWith({
		display_mode: 'standalone',
	})

	initializePostHog({
		apiKey: 'phc_test',
		host: 'https://analytics.example.com',
	})
	expect(posthog.init).toHaveBeenCalledTimes(1)
})
