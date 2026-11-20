import { expect, test, vi } from 'vitest'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { handleError } from './entry.server.tsx'

// Failure list for the server_error event sent when a loader or action
// throws:
// - a code, a token or an email address in the request's query string must
//   not reach PostHog, also when it is nested in redirectTo
// - the path and parameters that aren't secret stay, so the error can be
//   found
// - an aborted request sends nothing

const { captureServerEvent } = vi.hoisted(() => ({
	captureServerEvent: vi.fn(),
}))
vi.mock('./utils/posthog.server.ts', () => ({ captureServerEvent }))

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
