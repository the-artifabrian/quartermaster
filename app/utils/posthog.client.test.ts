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
	register: vi.fn(),
	unregister: vi.fn(),
	get_property: vi.fn(),
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
			capture_performance: { web_vitals: true },
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
	client.register({ is_demo: true })
	client.unregister('is_demo')
	expect(posthog.register).toHaveBeenCalledWith({ is_demo: true })
	expect(posthog.unregister).toHaveBeenCalledWith('is_demo')
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
})

test('error messages lose their codes and tokens', () => {
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
})

// Error messages are cleaned in the browser before an event is sent. A URL
// search would retry from every slash in a run of slashes or "a/", so the work
// must not grow with the message.
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

test('session recordings and heatmaps stay off whatever the PostHog project says', () => {
	vi.clearAllMocks()
	posthog.__loaded = false
	initializePostHog({
		apiKey: 'phc_test',
		host: 'https://analytics.example.com',
	})
	const options = posthog.init.mock.calls[0]![1]
	expect(options.disable_session_recording).toBe(true)
	// Heatmap data is keyed by the page's full URL, which before_send can't reach.
	expect(options.capture_heatmaps).toBe(false)
})

function sendChain(chain: string) {
	vi.clearAllMocks()
	posthog.__loaded = false
	initializePostHog({
		apiKey: 'phc_test',
		host: 'https://analytics.example.com',
	})
	const beforeSend = posthog.init.mock.calls[0]![1].before_send as (event: {
		event: string
		properties: Record<string, unknown>
	}) => { properties: { $elements_chain: string } }
	return beforeSend({
		event: '$autocapture',
		properties: { $elements_chain: chain },
	}).properties.$elements_chain
}

test('a form’s action in a click or submit event loses its tokens and email address', () => {
	const chain = sendChain(
		'form:attr__action="/verify?type=onboarding&target=ada%40example.com&token=link-abc"attr__method="post"nth-child="1"',
	)
	expect(chain).toBe(
		'form:attr__action="/verify?type=onboarding&target=redacted&token=redacted"attr__method="post"nth-child="1"',
	)
	expect(
		sendChain('form:attr__action="/household/join?token=invite-abc"'),
	).toBe('form:attr__action="/household/join?token=redacted"')
})

test('a button’s formaction loses its tokens', () => {
	expect(
		sendChain(
			'button:attr__formaction="https://useqm.app/household/join?token=invite-abc"text="Accept"',
		),
	).toBe(
		'button:attr__formaction="https://useqm.app/household/join?token=redacted"text="Accept"',
	)
})

test('a link’s href keeps being redacted', () => {
	expect(
		sendChain(
			'a:attr__href="/verify?code=Q2W3E4"href="/verify?code=Q2W3E4"text="Verify"',
		),
	).toBe(
		'a:attr__href="/verify?code=redacted"href="/verify?code=redacted"text="Verify"',
	)
})

test('an attribute that is not a URL is sent as it is', () => {
	const chain =
		'button.ph-no-capture:attr__aria-label="token=abc?code=1"attr__class="ph-no-capture"text="/join?token=shown"'
	expect(sendChain(chain)).toBe(chain)
})

test('an escaped quote inside an attribute value does not end the value early', () => {
	expect(
		sendChain(
			'form:attr__action="/search?q=\\"pasta\\"&token=invite-abc"attr__method="get"',
		),
	).toBe(
		'form:attr__action="/search?q=\\"pasta\\"&token=redacted"attr__method="get"',
	)
})

test('resetIfRegistered resets only a browser that has the super property', () => {
	vi.clearAllMocks()
	posthog.__loaded = true
	const client = initializePostHog({
		apiKey: 'phc_test',
		host: 'https://analytics.example.com',
	})

	posthog.get_property.mockReturnValueOnce(undefined)
	client.resetIfRegistered('is_demo')
	expect(posthog.get_property).toHaveBeenCalledWith('is_demo')
	expect(posthog.reset).not.toHaveBeenCalled()

	posthog.get_property.mockReturnValueOnce(true)
	client.resetIfRegistered('is_demo')
	expect(posthog.reset).toHaveBeenCalledTimes(1)
})
