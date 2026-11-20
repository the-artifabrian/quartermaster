import { type Request, type Response } from 'express'
import { expect, test, vi } from 'vitest'
import { httpsRedirect } from './https-redirect.ts'

// Failure list: the HTTP→HTTPS redirect must send the browser to the app's
// own host, whatever the request says about where it was sent.
// 1. A forwarded-host header naming another host.
// 2. A Host header naming another host.
// 3. Both at once, with a port, on a path with a query string.
// 4. A request that is already HTTPS, or isn't a GET, passes through.

const APP_ORIGIN = 'https://app.example'

/** Stubs env vars for one test; `using` restores them when it ends. */
function stubEnv(vars: Record<string, string>) {
	for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value)
	return { [Symbol.dispose]: () => vi.unstubAllEnvs() }
}

function run({
	method = 'GET',
	url = '/recipes?view=all',
	headers,
}: {
	method?: string
	url?: string
	headers: Record<string, string>
}) {
	using _env = stubEnv({ NODE_ENV: 'production', APP_ORIGIN })
	const lowered = Object.fromEntries(
		Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
	)
	const req = {
		method,
		originalUrl: url,
		get: (key: string) => lowered[key.toLowerCase()],
	} as unknown as Request
	let location: string | null = null
	const res = {
		set: () => res,
		redirect: (to: string) => {
			location = to
		},
	} as unknown as Response
	const next = vi.fn()
	httpsRedirect()(req, res, next)
	return { location, passedThrough: next.mock.calls.length === 1 }
}

test('a forwarded host naming another site does not change the redirect target', () => {
	const { location } = run({
		headers: {
			'X-Forwarded-Proto': 'http',
			'X-Forwarded-Host': 'other.example',
			Host: 'app.example',
		},
	})
	expect(location).toBe('https://app.example/recipes?view=all')
})

test('a Host header naming another site does not change the redirect target', () => {
	const { location } = run({
		headers: { 'X-Forwarded-Proto': 'http', Host: 'other.example' },
	})
	expect(location).toBe('https://app.example/recipes?view=all')
})

test('both host headers spoofed, with a port, still redirect to the app host', () => {
	const { location } = run({
		url: '/verify?type=onboarding&target=a%40b.c',
		headers: {
			'X-Forwarded-Proto': 'http',
			'X-Forwarded-Host': 'other.example:8443',
			Host: 'third.example:81',
		},
	})
	expect(location).toBe(
		'https://app.example/verify?type=onboarding&target=a%40b.c',
	)
})

test('an HTTPS request or a non-GET passes through untouched', () => {
	expect(
		run({ headers: { 'X-Forwarded-Proto': 'https', Host: 'other.example' } }),
	).toEqual({ location: null, passedThrough: true })
	expect(
		run({
			method: 'POST',
			headers: { 'X-Forwarded-Proto': 'http', Host: 'other.example' },
		}),
	).toEqual({ location: null, passedThrough: true })
})
