import { type Request, type Response } from 'express'
import { expect, test, vi } from 'vitest'
import { httpsRedirect } from './https-redirect.ts'

// Failure list: the HTTP→HTTPS redirect must send the browser to the app's
// own host, whatever the request says about where it was sent.
// 1. A forwarded-host header naming another host.
// 2. A Host header naming another host.
// 3. Both at once, with a port, on a path with a query string.
// 4. A request that is already HTTPS, or isn't a GET, passes through.
//
// In production, www plus the app's host moves to the app's own origin, since
// passkeys, emailed links and Stripe returns only work there:
// 5. A GET or HEAD on www keeps its path and query and gets a 301.
// 6. The Host header in capitals or with a port still counts as www.
// 7. The app's own host, the fly.dev host and other hosts pass through,
//    including one that only contains the www host.
// 8. The healthcheck never redirects, whatever the host.
// 9. A POST on www passes through, so a form submission isn't turned into a
//    GET.
// 10. Outside production nothing moves.
// 11. A host with a trailing dot ("www.app.example.") is the same host.
// 12. A request target that isn't a path (absolute form, or anything else
//     that doesn't start with "/") never moves, so the Location can't be the
//     origin glued to another URL.

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
	nodeEnv = 'production',
}: {
	method?: string
	url?: string
	headers: Record<string, string>
	nodeEnv?: string
}) {
	using _env = stubEnv({ NODE_ENV: nodeEnv, APP_ORIGIN })
	const lowered = Object.fromEntries(
		Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
	)
	const req = {
		method,
		originalUrl: url,
		path: url.split('?')[0],
		get: (key: string) => lowered[key.toLowerCase()],
	} as unknown as Request
	let location: string | null = null
	let status: number | null = null
	const res = {
		set: () => res,
		redirect: (first: string | number, second?: string) => {
			if (typeof first === 'number') {
				status = first
				location = second ?? null
			} else {
				status = 302
				location = first
			}
		},
	} as unknown as Response
	const next = vi.fn()
	httpsRedirect()(req, res, next)
	return { location, status, passedThrough: next.mock.calls.length === 1 }
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
	).toEqual({ location: null, status: null, passedThrough: true })
	expect(
		run({
			method: 'POST',
			headers: { 'X-Forwarded-Proto': 'http', Host: 'other.example' },
		}),
	).toEqual({ location: null, status: null, passedThrough: true })
})

const passedThrough = { location: null, status: null, passedThrough: true }

test.each(['GET', 'HEAD'])(
	'a %s on www moves to the app origin for good, keeping path and query',
	(method) => {
		expect(
			run({
				method,
				url: '/share/abc?utm_source=chat&x=1',
				headers: { 'X-Forwarded-Proto': 'https', Host: 'www.app.example' },
			}),
		).toEqual({
			location: 'https://app.example/share/abc?utm_source=chat&x=1',
			status: 301,
			passedThrough: false,
		})
	},
)

test('www in capitals or with a port still moves to the app origin', () => {
	for (const host of ['WWW.App.Example', 'www.app.example:443']) {
		expect(
			run({ headers: { 'X-Forwarded-Proto': 'https', Host: host } }),
		).toMatchObject({
			location: 'https://app.example/recipes?view=all',
			status: 301,
		})
	}
})

test('the app host, the fly.dev host and other hosts pass through', () => {
	for (const host of [
		'app.example',
		'quartermaster.fly.dev',
		'www.app.example.other',
		'xwww.app.example',
		'www.www.app.example',
	]) {
		expect(
			run({ headers: { 'X-Forwarded-Proto': 'https', Host: host } }),
		).toEqual(passedThrough)
	}
})

test('the healthcheck never redirects, even on www', () => {
	expect(
		run({
			url: '/resources/healthcheck',
			headers: { 'X-Forwarded-Proto': 'https', Host: 'www.app.example' },
		}),
	).toEqual(passedThrough)
})

test('a POST on www passes through', () => {
	expect(
		run({
			method: 'POST',
			headers: { 'X-Forwarded-Proto': 'https', Host: 'www.app.example' },
		}),
	).toEqual(passedThrough)
})

test('outside production www passes through', () => {
	expect(
		run({
			nodeEnv: 'development',
			headers: { 'X-Forwarded-Proto': 'https', Host: 'www.app.example' },
		}),
	).toEqual(passedThrough)
})

test('www with a trailing dot moves to the app origin', () => {
	expect(
		run({
			headers: { 'X-Forwarded-Proto': 'https', Host: 'www.app.example.' },
		}),
	).toMatchObject({
		location: 'https://app.example/recipes?view=all',
		status: 301,
	})
})

test('a request target that is not a path never redirects', () => {
	for (const url of [
		'http://app.example/recipes',
		'a.evil.com://x',
		'https:evil.com',
		'*',
	]) {
		for (const headers of [
			{ 'X-Forwarded-Proto': 'https', Host: 'www.app.example' },
			{ 'X-Forwarded-Proto': 'http', Host: 'app.example' },
		]) {
			expect(run({ url, headers })).toEqual(passedThrough)
		}
	}
})
