import { UNSAFE_ErrorResponseImpl as ErrorResponseImpl } from 'react-router'
import { expect, test, vi } from 'vitest'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { backgroundWorkSettled } from './utils/background.server.ts'
import { connectSources, handleError } from './entry.server.tsx'

// handleError sends server_error to PostHog when a loader or action throws. A
// request the app turns away sends nothing, since the request log already has
// its status.

const { captureServerEvent } = vi.hoisted(() => ({
	captureServerEvent: vi.fn(),
}))
vi.mock('./utils/posthog.server.ts', () => ({ captureServerEvent }))

/** Reports one error and waits for whatever it sent in the background. */
async function report(error: unknown) {
	handleError(error, {
		request: new Request('https://useqm.app/login'),
		params: {},
		context: {},
	} as unknown as Parameters<typeof handleError>[1])
	await backgroundWorkSettled()
}

function fail(url: string, signal?: AbortSignal) {
	consoleError.mockImplementation(() => {})
	const request = new Request(url, { signal })
	handleError(new Error('Loader failed'), {
		request,
		params: {},
		context: {},
	} as unknown as Parameters<typeof handleError>[1])
}

test('the server_error event carries the URL without codes or tokens', async () => {
	captureServerEvent.mockClear()
	fail(
		'https://useqm.app/verify?type=onboarding&target=ada%40example.com&code=Q2W3E4&redirectTo=%2Fhousehold%2Fjoin%3Ftoken%3Dinvite-abc',
	)
	await vi.waitFor(() => expect(captureServerEvent).toHaveBeenCalledTimes(1))
	const [, event, properties] = captureServerEvent.mock.calls[0]!
	expect(event).toBe('server_error')
	const url = String((properties as { url: unknown }).url)
	expect(url).toContain('https://useqm.app/verify?type=onboarding')
	expect(url).not.toMatch(/Q2W3E4|invite-abc|ada%40example\.com/)
})

test('an aborted request sends nothing', async () => {
	captureServerEvent.mockClear()
	const controller = new AbortController()
	controller.abort()
	fail('https://useqm.app/verify?code=Q2W3E4', controller.signal)
	await new Promise((resolve) => setTimeout(resolve, 20))
	expect(captureServerEvent).not.toHaveBeenCalled()
})

test('a request the app turns away sends nothing and prints nothing', async () => {
	captureServerEvent.mockClear()
	// React Router's own, as it builds them for a missing action or route.
	await report(
		new ErrorResponseImpl(
			405,
			'Method Not Allowed',
			new Error('You made a POST request to "/" but did not provide an action'),
			true,
		),
	)
	await report(
		new ErrorResponseImpl(
			404,
			'Not Found',
			new Error('No route matches URL "/nope"'),
			true,
		),
	)
	await report(new Response('Bad Request', { status: 400 }))
	await report(new Response(null, { status: 403 }))
	expect(captureServerEvent).not.toHaveBeenCalled()
	expect(consoleError).not.toHaveBeenCalled()
})

test('a 5xx response and a thrown value that is not an Error still send server_error', async () => {
	captureServerEvent.mockClear()
	consoleError.mockImplementation(() => {})
	await report(
		new ErrorResponseImpl(
			500,
			'Internal Server Error',
			new Error('Unexpected Server Error'),
			true,
		),
	)
	await report(new Response('Unavailable', { status: 503 }))
	await report('a string thrown from a loader')
	expect(captureServerEvent.mock.calls.map(([, event]) => event)).toEqual([
		'server_error',
		'server_error',
		'server_error',
	])
})

// React Router's origin check answers 400 but hands over a plain Error. A
// mismatch can mean the proxy or its X-Forwarded-Host setup broke, which turns
// away every form on the site.
test('a failed origin check is still reported, though it answers 400', async () => {
	captureServerEvent.mockClear()
	consoleError.mockImplementation(() => {})
	await report(
		new Error(
			'The `request.url` host does not match `origin` header from a forwarded action request. Aborting the action.',
		),
	)
	expect(captureServerEvent).toHaveBeenCalledTimes(1)
	expect(captureServerEvent.mock.calls[0]![1]).toBe('server_error')
})

// A PostHog proxy host such as t.useqm.app is both the API host and the asset
// host, so it must be listed once.
test('connect-src lists a PostHog proxy host once', () => {
	const sources = connectSources({
		mode: 'production',
		posthogHost: 'https://t.useqm.app',
		posthogAssetHost: 'https://t.useqm.app',
	})
	expect(sources).toEqual(['https://t.useqm.app', "'self'"])

	const withSlash = connectSources({
		mode: 'production',
		posthogHost: 'https://t.useqm.app/',
		posthogAssetHost: 'https://t.useqm.app',
	})
	expect(withSlash).toEqual(['https://t.useqm.app', "'self'"])
})

test('connect-src keeps both PostHog Cloud hosts', () => {
	const sources = connectSources({
		mode: 'production',
		posthogHost: 'https://eu.i.posthog.com',
		posthogAssetHost: 'https://eu-assets.i.posthog.com',
	})
	expect(sources).toEqual([
		'https://eu.i.posthog.com',
		'https://eu-assets.i.posthog.com',
		"'self'",
	])
})

test('connect-src without PostHog lists the app, plus the websocket in development', () => {
	expect(connectSources({ mode: 'production' })).toEqual(["'self'"])
	expect(connectSources({ mode: 'development' })).toEqual(['ws:', "'self'"])
})
