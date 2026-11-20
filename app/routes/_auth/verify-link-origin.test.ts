import { RouterContextProvider } from 'react-router'
import { expect, test, vi } from 'vitest'
import { action as changeEmailAction } from '#app/routes/settings/profile/change-email.tsx'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { generateTOTP } from '#app/utils/totp.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { requireEmail } from '#tests/mocks/utils.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import { action as signupAction } from './signup.tsx'
import { requireRecentVerification } from './verify.server.ts'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

// Failure list. The emailed one-time-code link leaves the site, so it must
// name APP_ORIGIN whatever the request says:
// 1. A forwarded-host header naming another host.
// 2. A forwarded-proto header asking for plain http.
// 3. A Host header naming another host.
// 4. A request URL on another host. The Express adapter builds request.url
//    from the forwarded host, so it is no safer than the headers.
// Redirects within the site stay relative, so the browser stays on the host
// it used and keeps its cookies (a LAN IP in dev, the fly.dev host):
// 5. Signup's redirect to the verify page.
// 6. Change Email's redirect to the verify page.
// 7. The reverify redirect before a sensitive settings page.

const APP_ORIGIN = 'https://app.example'

/** Stubs env vars for one test; `using` restores them when it ends. */
function stubEnv(vars: Record<string, string>) {
	for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value)
	return { [Symbol.dispose]: () => vi.unstubAllEnvs() }
}

function uniqueEmail() {
	return `origin-check-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
}

async function signup({
	url = 'https://app.example/signup',
	headers = {},
}: {
	url?: string
	headers?: Record<string, string>
}) {
	const email = uniqueEmail()
	const requestUrl = new URL(url)
	const response = await signupAction({
		request: new Request(requestUrl, {
			method: 'POST',
			headers,
			body: new URLSearchParams({ email }),
		}),
		url: requestUrl,
		params: {},
		pattern: '/signup',
		context: new RouterContextProvider(),
	})
	expect(response).toBeInstanceOf(Response)
	return { response: response as Response, email }
}

/** The /verify links in an email, as `origin + pathname`. */
async function emailedVerifyLinks(email: string) {
	const sent = await requireEmail(email)
	const links = [...sent.text.matchAll(/https?:\/\/[^\s"<>)\]]+/g)].map(
		([link]) => new URL(link),
	)
	return {
		links: links.map((link) => `${link.origin}${link.pathname}`),
		body: sent.text + sent.html,
	}
}

async function expectLinkOnAppOrigin(email: string) {
	const { links, body } = await emailedVerifyLinks(email)
	expect(links).toContain(`${APP_ORIGIN}/verify`)
	expect(body).not.toContain('other.example')
}

function expectRelativeVerifyRedirect(response: Response) {
	const location = response.headers.get('location')
	expect(location).toMatch(/^\/verify\?/)
}

async function signedInSession({ twoFA = false } = {}) {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
	})
	if (twoFA) {
		const { otp: _otp, ...config } = await generateTOTP()
		await prisma.verification.create({
			data: { ...config, type: twoFAVerificationType, target: session.userId },
		})
	}
	return { session, cookie: await getSessionCookieHeader(session) }
}

test('a forwarded host naming another site still emails a link to APP_ORIGIN', async () => {
	using _env = stubEnv({ APP_ORIGIN })
	const { email } = await signup({
		headers: { 'X-Forwarded-Host': 'other.example' },
	})
	await expectLinkOnAppOrigin(email)
})

test('a forwarded proto of http still emails an https link', async () => {
	using _env = stubEnv({ APP_ORIGIN })
	const { email } = await signup({ headers: { 'X-Forwarded-Proto': 'http' } })
	const { links } = await emailedVerifyLinks(email)
	expect(links).toContain(`${APP_ORIGIN}/verify`)
	expect(links.some((link) => link.startsWith('http:'))).toBe(false)
})

test('a Host header naming another site still emails a link to APP_ORIGIN', async () => {
	using _env = stubEnv({ APP_ORIGIN })
	const { email } = await signup({ headers: { Host: 'other.example' } })
	await expectLinkOnAppOrigin(email)
})

test('a request URL on another host still emails a link to APP_ORIGIN', async () => {
	using _env = stubEnv({ APP_ORIGIN })
	const { email } = await signup({ url: 'http://other.example/signup' })
	await expectLinkOnAppOrigin(email)
})

test('signup sends the browser to the verify page with a relative redirect', async () => {
	using _env = stubEnv({ APP_ORIGIN })
	const { response } = await signup({ url: 'http://192.168.1.20:3000/signup' })
	expectRelativeVerifyRedirect(response)
})

test('Change Email sends the browser to the verify page with a relative redirect', async () => {
	using _env = stubEnv({ APP_ORIGIN })
	const { cookie } = await signedInSession()
	const url = new URL('http://192.168.1.20:3000/settings/profile/change-email')
	const response = await changeEmailAction({
		request: new Request(url, {
			method: 'POST',
			headers: { cookie },
			body: new URLSearchParams({ email: uniqueEmail() }),
		}),
		url,
		params: {},
		pattern: '/settings/profile/change-email',
		context: new RouterContextProvider(),
	})
	expect(response).toBeInstanceOf(Response)
	expectRelativeVerifyRedirect(response as Response)
})

test('the reverify redirect before a sensitive page is relative', async () => {
	using _env = stubEnv({ APP_ORIGIN })
	const { cookie } = await signedInSession({ twoFA: true })
	const request = new Request(
		'http://192.168.1.20:3000/settings/profile/two-factor/disable',
		{ headers: { cookie } },
	)
	const thrown = await requireRecentVerification(request).then(
		() => null,
		(error: unknown) => error,
	)
	expect(thrown).toBeInstanceOf(Response)
	expectRelativeVerifyRedirect(thrown as Response)
})
