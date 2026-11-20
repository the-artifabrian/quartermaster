import { expect, test, vi } from 'vitest'
import { BACKSTOP_MS, MAX_GROWTH, growth } from '#tests/growth.ts'
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

test('URLs sent to PostHog lose their codes, tokens and email addresses', () => {
	vi.clearAllMocks()
	posthog.__loaded = false
	initializePostHog({
		apiKey: 'phc_test',
		host: 'https://analytics.example.com',
	})
	const options = posthog.init.mock.calls[0]![1]
	const beforeSend = options.before_send as (event: {
		event: string
		properties?: Record<string, unknown>
		$set?: Record<string, unknown>
		$set_once?: Record<string, unknown>
	}) => { properties: Record<string, unknown> } & Record<string, unknown>

	const sent = beforeSend({
		event: '$pageview',
		properties: {
			$current_url:
				'https://useqm.app/verify?type=onboarding&target=ada%40example.com&code=Q2W3E4',
			$referrer: 'https://useqm.app/household/join?token=invite-abc',
			$pathname: '/verify',
			route_id: 'routes/_auth/verify',
			count: 3,
			$elements_chain:
				'a.link:attr__class="link"attr__href="/signup?redirectTo=%2Fhousehold%2Fjoin%3Ftoken%3Dinvite-abc"href="/signup?redirectTo=%2Fhousehold%2Fjoin%3Ftoken%3Dinvite-abc"nth-child="2"text="Create an account"',
			$elements: [
				{
					tag_name: 'a',
					attr__href:
						'/signup?redirectTo=%2Fhousehold%2Fjoin%3Ftoken%3Dinvite-abc',
					$el_text: 'Create an account',
				},
			],
			$web_vitals_LCP_event: {
				name: 'LCP',
				value: 1200,
				$current_url: 'https://useqm.app/verify?code=Q2W3E4',
			},
		},
		$set: { $current_url: 'https://useqm.app/household/join?token=invite-abc' },
		$set_once: {
			$initial_current_url: 'https://useqm.app/verify?code=Q2W3E4',
		},
	})
	const text = JSON.stringify(sent)
	expect(text).not.toMatch(/Q2W3E4|invite-abc|example\.com/)
	expect(sent.properties.$pathname).toBe('/verify')
	expect(sent.properties.route_id).toBe('routes/_auth/verify')
	expect(sent.properties.count).toBe(3)
	expect(sent.properties.$elements_chain).toContain('text="Create an account"')
	expect(sent.properties.$elements_chain).toContain('href="/signup?redirectTo=')

	const sessionRecording = options.session_recording as {
		maskCapturedNetworkRequestFn: (request: {
			name: string
		}) => { name: string } | null
	}
	expect(
		sessionRecording.maskCapturedNetworkRequestFn({
			name: 'https://useqm.app/verify.data?code=Q2W3E4',
		})?.name,
	).toBe('https://useqm.app/verify.data?code=redacted')
})

test('error messages and replay page addresses lose their codes and tokens', () => {
	vi.clearAllMocks()
	posthog.__loaded = false
	initializePostHog({
		apiKey: 'phc_test',
		host: 'https://analytics.example.com',
	})
	const options = posthog.init.mock.calls[0]![1]
	const beforeSend = options.before_send as (event: {
		event: string
		properties: Record<string, unknown>
	}) => { properties: Record<string, unknown> }

	const exception = beforeSend({
		event: '$exception',
		properties: {
			$exception_message:
				'Failed to fetch https://useqm.app/verify.data?code=Q2W3E4&type=onboarding (and /household/join?token=invite-abc)',
			$exception_list: [
				{
					type: 'TypeError',
					value: 'Failed to fetch /verify?code=Q2W3E4',
					stacktrace: {
						frames: [{ filename: 'https://useqm.app/assets/root.js' }],
					},
				},
			],
		},
	})
	const exceptionText = JSON.stringify(exception)
	expect(exceptionText).not.toMatch(/Q2W3E4|invite-abc/)
	expect(exception.properties.$exception_message).toContain(
		'Failed to fetch https://useqm.app/verify.data?code=redacted&type=onboarding',
	)
	expect(exceptionText).toContain('https://useqm.app/assets/root.js')

	const snapshot = beforeSend({
		event: '$snapshot',
		properties: {
			$snapshot_data: [
				{
					type: 4,
					data: {
						href: 'https://useqm.app/verify?target=ada%40example.com&code=Q2W3E4',
						width: 390,
					},
				},
				{
					type: 5,
					data: {
						tag: '$pageview',
						payload: {
							href: 'https://useqm.app/household/join?token=invite-abc',
						},
					},
				},
				{ type: 2, data: 'compressed-full-snapshot', cv: '2024-10' },
			],
		},
	})
	const snapshotText = JSON.stringify(snapshot)
	expect(snapshotText).not.toMatch(/Q2W3E4|invite-abc|example\.com/)
	expect(snapshotText).toContain('compressed-full-snapshot')
	expect(snapshotText).toContain('"width":390')
})

// Failure list for long error messages, which run in the browser before an
// event is sent:
// - A message made of a long run of slashes, or of "a/", which a URL search
//   would retry from every slash: the work must stop growing with the
//   message.
// - A URL with a token past the part that is read must not be sent as it is.
function sendException(message: string) {
	vi.clearAllMocks()
	posthog.__loaded = false
	initializePostHog({
		apiKey: 'phc_test',
		host: 'https://analytics.example.com',
	})
	const beforeSend = posthog.init.mock.calls[0]![1].before_send as (event: {
		event: string
		properties: Record<string, unknown>
	}) => { properties: Record<string, unknown> }
	return (text = message) =>
		beforeSend({
			event: '$exception',
			properties: {
				$exception_message: text,
				$exception_list: [{ type: 'Error', value: text }],
			},
		})
}

test.each([
	['slashes', '/'],
	['"a/"', 'a/'],
])('a long error message of %s grows no faster than its length', (_, fill) => {
	const { ratio, largeMs } = growth((size) => {
		const send = sendException(fill.repeat((2_000 * size) / fill.length))
		return () => send()
	})
	expect(ratio).toBeLessThan(MAX_GROWTH)
	expect(largeMs).toBeLessThan(BACKSTOP_MS)
})

test('a long error message is cut, so a token past the cut is not sent', () => {
	const message = `${'x '.repeat(5_000)}/household/join?token=invite-abc`
	const event = sendException(message)()
	const text = JSON.stringify(event)
	expect(text).not.toContain('invite-abc')
	expect(String(event.properties.$exception_message).length).toBeLessThan(3_000)
})

// Failure list for what replays record of form fields:
// - every input type the SDK masks when told to mask all inputs stays masked
// - hidden inputs, which carry invite tokens and redirectTo values on the
//   login, signup, onboarding, verify and join forms, are masked too; the
//   SDK's "mask all inputs" list leaves them out, and it replaces any list
//   of our own, so it has to be off for ours to count
test('replays mask every input type, hidden ones included', () => {
	vi.clearAllMocks()
	posthog.__loaded = false
	initializePostHog({
		apiKey: 'phc_test',
		host: 'https://analytics.example.com',
	})
	const recording = posthog.init.mock.calls[0]![1].session_recording as {
		maskAllInputs?: boolean
		maskInputOptions?: Record<string, boolean>
	}
	expect(recording.maskAllInputs).toBe(false)
	for (const type of [
		'color',
		'date',
		'datetime-local',
		'email',
		'month',
		'number',
		'range',
		'search',
		'tel',
		'text',
		'time',
		'url',
		'week',
		'textarea',
		'select',
		'password',
		'hidden',
	]) {
		expect(recording.maskInputOptions?.[type], type).toBe(true)
	}
})
