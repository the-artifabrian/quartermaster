import { RouterContextProvider } from 'react-router'
import { expect, test, vi } from 'vitest'

const PROVIDER_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

const mocks = vi.hoisted(() => ({
	/** Like the OAuth strategy: reads the body, then redirects to Google. */
	authenticate: vi.fn(async (_provider: string, request: Request) => {
		await request.text()
		throw new Response(null, {
			status: 302,
			headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth' },
		})
	}),
}))

vi.mock('#app/utils/auth.server.ts', () => ({
	authenticator: { authenticate: mocks.authenticate },
}))
vi.mock('#app/utils/connections.server.ts', () => ({
	handleMockAction: async () => {},
}))

import { action } from './index.ts'

const BASE_URL = 'https://useqm.app'

function post(body?: Record<string, string>, referrer?: string) {
	const url = new URL(`${BASE_URL}/auth/google`)
	return action({
		request: new Request(url, {
			method: 'POST',
			headers: {
				'X-Forwarded-Proto': 'https',
				...(referrer ? { referer: `${BASE_URL}${referrer}` } : {}),
			},
			...(body ? { body: new URLSearchParams(body) } : {}),
		}),
		params: { provider: 'google' },
		context: new RouterContextProvider(),
		pattern: '/auth/:provider',
		url,
	}).catch((error: unknown) => error)
}

/** The page the redirectTo cookie will send the user back to. */
function rememberedPage(response: unknown) {
	const setCookie = (response as Response).headers.get('set-cookie') ?? ''
	const value = /^redirectTo=([^;]*);/.exec(setCookie)?.[1]
	return value === undefined ? null : decodeURIComponent(value)
}

test('remembers the posted redirectTo after the strategy reads the body', async () => {
	const response = await post({ redirectTo: '/recipes/abc' })

	expect(response).toBeInstanceOf(Response)
	expect((response as Response).headers.get('location')).toBe(PROVIDER_URL)
	expect(rememberedPage(response)).toBe('/recipes/abc')
})

test('falls back to the referring page without a posted redirectTo', async () => {
	const response = await post({}, '/plan?weekStart=2026-10-05')

	expect(rememberedPage(response)).toBe('/plan?weekStart=2026-10-05')
})

test('falls back to the referring page when the body is not a form', async () => {
	const response = await post(undefined, '/shopping')

	expect((response as Response).headers.get('location')).toBe(PROVIDER_URL)
	expect(rememberedPage(response)).toBe('/shopping')
})

test('passes on an error that is not a redirect', async () => {
	mocks.authenticate.mockRejectedValueOnce(new Error('strategy broke'))

	expect(await post({ redirectTo: '/recipes' })).toEqual(
		new Error('strategy broke'),
	)
})
