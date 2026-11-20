import { RouterContextProvider } from 'react-router'
import { expect, test, vi } from 'vitest'
import { requireEmail } from '#tests/mocks/utils.ts'
import { action } from './signup.tsx'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

// Failure list: the emailed one-time-code link (and the verify page the
// signup redirects to) must name APP_ORIGIN, whatever the request says.
// 1. A forwarded-host header naming another host.
// 2. A forwarded-proto header asking for a different scheme.
// 3. A Host header naming another host.
// 4. A request URL on another host: the Express adapter builds request.url
//    from the forwarded host, so it is no safer than the headers.

const APP_ORIGIN = 'https://app.example'

/** Stubs env vars for one test; `using` restores them when it ends. */
function stubEnv(vars: Record<string, string>) {
	for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value)
	return { [Symbol.dispose]: () => vi.unstubAllEnvs() }
}

test('a signup request naming another host still emails a link to APP_ORIGIN', async () => {
	using _env = stubEnv({ APP_ORIGIN })
	const email = `origin-check-${Date.now()}@example.com`
	const url = new URL('http://other.example/signup')
	const response = await action({
		request: new Request(url, {
			method: 'POST',
			headers: {
				'X-Forwarded-Host': 'other.example',
				'X-Forwarded-Proto': 'http',
				Host: 'other.example',
			},
			body: new URLSearchParams({ email }),
		}),
		url,
		params: {},
		pattern: '/signup',
		context: new RouterContextProvider(),
	})

	expect(response).toBeInstanceOf(Response)
	const location = new URL((response as Response).headers.get('location')!)
	expect(location.origin).toBe(APP_ORIGIN)
	expect(location.pathname).toBe('/verify')

	const sent = await requireEmail(email)
	const links = [...sent.text.matchAll(/https?:\/\/[^\s"<>)\]]+/g)].map(
		([link]) => new URL(link),
	)
	expect(links.map((link) => `${link.origin}${link.pathname}`)).toContain(
		`${APP_ORIGIN}/verify`,
	)
	expect(sent.text + sent.html).not.toContain('other.example')
})
