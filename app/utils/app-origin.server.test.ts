import { expect, test, vi } from 'vitest'
import { loader as robotsLoader } from '#app/routes/_seo/robots[.]txt.ts'
import { getAppOrigin } from './app-origin.server.ts'

// Absolute URLs the app hands out (the robots.txt Sitemap line, and everything
// else built on getAppOrigin) must name the configured origin, never one taken
// from the request. The emailed verify link is covered end to end in
// routes/_auth/verify-link-origin.test.ts.

const APP_ORIGIN = 'https://app.example'

/** Stubs env vars for one test; `using` restores them when it ends. */
function stubEnv(vars: Record<string, string>) {
	for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value)
	return { [Symbol.dispose]: () => vi.unstubAllEnvs() }
}

test('robots.txt names APP_ORIGIN in its Sitemap line', async () => {
	using _env = stubEnv({ NODE_ENV: 'production', APP_ORIGIN })
	const response = await robotsLoader()
	const body = await response.text()
	expect(body).toContain(`Sitemap: ${APP_ORIGIN}/sitemap.xml`)
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
