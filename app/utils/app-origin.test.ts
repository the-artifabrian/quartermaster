import { expect, test, vi } from 'vitest'
import { loader as robotsLoader } from '#app/routes/_seo/robots[.]txt.ts'
import { getAppOrigin } from './app-origin.ts'
import { getReferrerRoute } from './misc.tsx'

// Failure list: absolute URLs the app hands out (the robots.txt Sitemap line,
// the referrer check, and everything else built on getAppOrigin) must name the
// configured origin, never one taken from the request. The emailed verify
// link is covered end to end in routes/_auth/verify-link-origin.test.ts.
// 1. robots.txt: the Sitemap line is APP_ORIGIN's.
// 2. A referrer on another host, sent with forwarded headers naming that
//    host, is not treated as one of the app's pages.
// 3. A referrer on a host that merely starts with the app's host is not one
//    of the app's pages either.
// 4. Production with no configured origin (validation bypassed) fails loudly
//    instead of falling back to the request.
// 5. Development with no configured origin works without editing .env: it
//    uses localhost on PORT.

const APP_ORIGIN = 'https://app.example'

/** Stubs env vars for one test; `using` restores them when it ends. */
function stubEnv(vars: Record<string, string>) {
	for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value)
	return { [Symbol.dispose]: () => vi.unstubAllEnvs() }
}

function spoofedRequest(path = '/forgot-password', headers = {}) {
	return new Request(`http://other.example${path}`, {
		headers: {
			'X-Forwarded-Host': 'other.example',
			'X-Forwarded-Proto': 'http',
			Host: 'other.example',
			...headers,
		},
	})
}

test('robots.txt names APP_ORIGIN in its Sitemap line', async () => {
	using _env = stubEnv({ NODE_ENV: 'production', APP_ORIGIN })
	const response = await robotsLoader()
	const body = await response.text()
	expect(body).toContain(`Sitemap: ${APP_ORIGIN}/sitemap.xml`)
})

test('a referrer on another host is not one of the app pages', () => {
	using _env = stubEnv({ APP_ORIGIN })
	expect(
		getReferrerRoute(
			spoofedRequest('/auth/google', {
				'X-Forwarded-Proto': 'https',
				referer: 'https://other.example/recipes',
			}),
		),
	).toBe('/')
})

test('a referrer on a host that starts with the app host is not one of the app pages', () => {
	using _env = stubEnv({ APP_ORIGIN })
	expect(
		getReferrerRoute(
			spoofedRequest('/auth/google', {
				referer: 'https://app.example.other.example/recipes',
			}),
		),
	).toBe('/')
	// Control: the app's own page is returned as a path.
	expect(
		getReferrerRoute(
			spoofedRequest('/auth/google', {
				referer: 'https://app.example/recipes?tab=all',
			}),
		),
	).toBe('/recipes?tab=all')
})

test('production without a configured origin fails instead of using the request', () => {
	using _env = stubEnv({ NODE_ENV: 'production', APP_ORIGIN: '' })
	expect(getAppOrigin).toThrow(/APP_ORIGIN/)
})

test('development without a configured origin uses localhost on PORT', () => {
	using _env = stubEnv({
		NODE_ENV: 'development',
		APP_ORIGIN: '',
		PORT: '4321',
	})
	expect(getAppOrigin()).toBe('http://localhost:4321')
})
