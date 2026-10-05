import { parseWithZod } from '@conform-to/zod/v4'
import { RouterContextProvider } from 'react-router'
import * as setCookieParser from 'set-cookie-parser'
import { expect, test } from 'vitest'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import {
	getPasswordHash,
	getSessionExpirationDate,
} from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { generateTOTP } from '#app/utils/totp.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { createUser, ensureUserRole } from '#tests/db-utils.ts'
import { BASE_URL, convertSetCookieToCookie } from '#tests/utils.ts'
import { action as loginAction } from './login.tsx'
import { handleNewSession, handleVerification } from './login.server.ts'
import {
	action as providerOnboardingAction,
	providerIdKey,
} from './onboarding/$provider.tsx'
import {
	action as onboardingAction,
	onboardingEmailSessionKey,
} from './onboarding/index.tsx'
import { VerifySchema } from './verify.tsx'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

// The iOS app is a shell around a web view, and WKWebView drops a session
// cookie without an expiry when iOS kills the app. So in the shell every
// login and signup ends with an expiring cookie, whatever "Remember me" says.

const SAFARI_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const SHELL_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 QuartermasterShell/1'

function post(
	path: string,
	{
		userAgent,
		body,
		cookie,
	}: { userAgent: string; body: Record<string, string>; cookie?: string },
) {
	const headers = new Headers({ 'User-Agent': userAgent })
	if (cookie) headers.set('Cookie', cookie)
	return new Request(`${BASE_URL}${path}`, {
		method: 'POST',
		headers,
		body: new URLSearchParams(body),
	})
}

function routeArgs<Params extends Record<string, string>>(
	request: Request,
	pattern: string,
	params: Params = {} as Params,
) {
	return {
		request,
		params,
		pattern,
		url: new URL(request.url),
		context: new RouterContextProvider(),
	}
}

function sessionCookie(response: unknown) {
	if (!(response instanceof Response)) {
		throw new Error(`Expected a Response, got ${String(response)}`)
	}
	const cookie = setCookieParser
		.parse(response.headers.getSetCookie())
		.find((c) => c.name === 'en_session')
	if (!cookie) throw new Error('No en_session cookie was set')
	return cookie
}

async function insertPasswordUser() {
	await ensureUserRole()
	const userData = createUser()
	const password = 'correct horse battery staple'
	const user = await prisma.user.create({
		select: { id: true, username: true },
		data: {
			...userData,
			roles: { connect: { name: 'user' } },
			password: { create: { hash: await getPasswordHash(password) } },
		},
	})
	return { ...user, password }
}

async function verifyCookie(values: Record<string, unknown>) {
	const verifySession = await verifySessionStorage.getSession()
	for (const [key, value] of Object.entries(values)) {
		verifySession.set(key, value)
	}
	return convertSetCookieToCookie(
		await verifySessionStorage.commitSession(verifySession),
	)
}

async function prepareSignup() {
	await ensureUserRole()
	const { username, name } = createUser()
	return {
		username,
		name,
		password: 'a long and unusual passphrase',
		confirmPassword: 'a long and unusual passphrase',
		agreeToTermsOfServiceAndPrivacyPolicy: 'on',
	}
}

test('password login in the shell sets an expiring cookie with Remember me unchecked', async () => {
	const user = await insertPasswordUser()
	const response = await loginAction(
		routeArgs(
			post('/login', {
				userAgent: SHELL_UA,
				body: { username: user.username, password: user.password },
			}),
			'/login',
		),
	)
	expect(sessionCookie(response).expires).toBeInstanceOf(Date)
})

test('password login in a browser with Remember me unchecked keeps a browser-session cookie', async () => {
	const user = await insertPasswordUser()
	const response = await loginAction(
		routeArgs(
			post('/login', {
				userAgent: SAFARI_UA,
				body: { username: user.username, password: user.password },
			}),
			'/login',
		),
	)
	expect(sessionCookie(response).expires).toBeUndefined()
})

test('password login in a browser with Remember me checked sets an expiring cookie', async () => {
	const user = await insertPasswordUser()
	const response = await loginAction(
		routeArgs(
			post('/login', {
				userAgent: SAFARI_UA,
				body: {
					username: user.username,
					password: user.password,
					remember: 'on',
				},
			}),
			'/login',
		),
	)
	expect(sessionCookie(response).expires).toBeInstanceOf(Date)
})

test('a shell login that stops for two-factor still ends with an expiring cookie', async () => {
	const user = await insertPasswordUser()
	const { otp: _otp, ...config } = await generateTOTP()
	await prisma.verification.create({
		data: { type: twoFAVerificationType, target: user.id, ...config },
	})

	const loginResponse = await loginAction(
		routeArgs(
			post('/login', {
				userAgent: SHELL_UA,
				body: { username: user.username, password: user.password },
			}),
			'/login',
		),
	)
	if (!(loginResponse instanceof Response)) throw new Error('Expected redirect')
	expect(
		new URL(loginResponse.headers.get('location')!, BASE_URL).pathname,
	).toBe('/verify')
	const verifySetCookie = loginResponse.headers.get('set-cookie')!

	const body = new URLSearchParams({
		code: '123456',
		type: twoFAVerificationType,
		target: user.id,
	})
	// The verify request comes without the token, so only the value the login
	// stored in the verify session can make this cookie expire.
	const verified = await handleVerification({
		request: post('/verify', {
			userAgent: SAFARI_UA,
			body: Object.fromEntries(body),
			cookie: convertSetCookieToCookie(verifySetCookie),
		}),
		body,
		submission: parseWithZod(body, { schema: VerifySchema }),
	})
	expect(sessionCookie(verified).expires).toBeInstanceOf(Date)
})

test('passkey login in the shell sets an expiring cookie although the body says remember: false', async () => {
	// The passkey action verifies the WebAuthn assertion and then hands the new
	// session to handleNewSession with `remember` from the JSON body, which
	// defaults to false. The assertion needs a real authenticator, so this test
	// starts at that hand-off; Playwright covers the passkey flow itself.
	const user = await insertPasswordUser()
	const session = await prisma.session.create({
		select: { id: true, userId: true, expirationDate: true },
		data: { userId: user.id, expirationDate: getSessionExpirationDate() },
	})
	const response = await handleNewSession({
		request: new Request(`${BASE_URL}/webauthn/authentication`, {
			method: 'POST',
			headers: { 'User-Agent': SHELL_UA },
		}),
		session,
		remember: false,
	})
	expect(sessionCookie(response).expires).toBeInstanceOf(Date)
})

test('email onboarding in the shell sets an expiring cookie with Remember me unchecked', async () => {
	const fields = await prepareSignup()
	const response = await onboardingAction(
		routeArgs(
			post('/onboarding', {
				userAgent: SHELL_UA,
				body: fields,
				cookie: await verifyCookie({
					[onboardingEmailSessionKey]: `${fields.username}@example.com`,
				}),
			}),
			'/onboarding',
		),
	)
	expect(sessionCookie(response).expires).toBeInstanceOf(Date)
})

test('email onboarding in a browser with Remember me unchecked keeps a browser-session cookie', async () => {
	const fields = await prepareSignup()
	const response = await onboardingAction(
		routeArgs(
			post('/onboarding', {
				userAgent: SAFARI_UA,
				body: fields,
				cookie: await verifyCookie({
					[onboardingEmailSessionKey]: `${fields.username}@example.com`,
				}),
			}),
			'/onboarding',
		),
	)
	expect(sessionCookie(response).expires).toBeUndefined()
})

test('provider onboarding in the shell sets an expiring cookie with Remember me unchecked', async () => {
	const { username, name, agreeToTermsOfServiceAndPrivacyPolicy } =
		await prepareSignup()
	const response = await providerOnboardingAction(
		routeArgs(
			post('/onboarding/google', {
				userAgent: SHELL_UA,
				body: { username, name, agreeToTermsOfServiceAndPrivacyPolicy },
				cookie: await verifyCookie({
					[onboardingEmailSessionKey]: `${username}@example.com`,
					[providerIdKey]: `google-${username}`,
				}),
			}),
			'/onboarding/:provider',
			{ provider: 'google' },
		),
	)
	expect(sessionCookie(response).expires).toBeInstanceOf(Date)
})

test('provider onboarding in a browser with Remember me unchecked keeps a browser-session cookie', async () => {
	const { username, name, agreeToTermsOfServiceAndPrivacyPolicy } =
		await prepareSignup()
	const response = await providerOnboardingAction(
		routeArgs(
			post('/onboarding/google', {
				userAgent: SAFARI_UA,
				body: { username, name, agreeToTermsOfServiceAndPrivacyPolicy },
				cookie: await verifyCookie({
					[onboardingEmailSessionKey]: `${username}@example.com`,
					[providerIdKey]: `google-${username}`,
				}),
			}),
			'/onboarding/:provider',
			{ provider: 'google' },
		),
	)
	expect(sessionCookie(response).expires).toBeUndefined()
})
