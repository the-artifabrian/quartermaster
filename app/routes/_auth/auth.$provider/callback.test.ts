import { invariant } from '@epic-web/invariant'
import { faker } from '@faker-js/faker'
import { SetCookie } from '@mjackson/headers'
import { http } from 'msw'
import { RouterContextProvider } from 'react-router'
import { afterEach, expect, test } from 'vitest'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import { getSessionExpirationDate, sessionKey } from '#app/utils/auth.server.ts'
import { GOOGLE_PROVIDER_NAME } from '#app/utils/connections.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { generateTOTP } from '#app/utils/totp.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { insertGoogleUser, deleteGoogleUsers } from '#tests/mocks/google.ts'
import { server } from '#tests/setup/mocks-setup.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { BASE_URL, convertSetCookieToCookie } from '#tests/utils.ts'
import { loader } from './callback.ts'
import '#tests/setup/db-setup.ts'

const ROUTE_PATH = '/auth/google/callback'
const PARAMS = { provider: 'google' }
const LOADER_ARGS_BASE = {
	params: PARAMS,
	context: new RouterContextProvider(),
	pattern: ROUTE_PATH,
	url: new URL(`${BASE_URL}${ROUTE_PATH}`),
}

afterEach(async () => {
	await deleteGoogleUsers()
})

test('when auth fails, send the user to login with a toast', async () => {
	consoleError.mockImplementation(() => {})
	server.use(
		http.post('https://oauth2.googleapis.com/token', async () => {
			return new Response(null, { status: 400 })
		}),
	)
	const request = await setupRequest()
	const response = await loader({
		request,
		...LOADER_ARGS_BASE,
	}).catch((e) => e)
	invariant(response instanceof Response, 'response should be a Response')
	expect(response).toHaveRedirect('/login')
	await expect(response).toSendToast(
		expect.objectContaining({
			title: 'Auth Failed',
			type: 'error',
		}),
	)
	expect(consoleError).toHaveBeenCalledTimes(1)
})

// Failure list for signing in with Google until it goes (#439):
// 1. Signed in, connecting a new Google account is refused and stores no
//    connection.
// 2. Signed out, a Google account whose email matches an existing account is
//    linked only when Google says the email is verified. Otherwise nothing is
//    linked, no session is made, and the person is told to log in with their
//    password.
// 3. An answer from Google with no verified field counts as unverified.
// 3a. An unverified email with no account doesn't start a signup either.
// 4. A verified match is linked and signed in, as before.
// 5. An existing connection still signs in (tests below).

test('when a user is logged in, connecting a new Google account is refused', async () => {
	const googleUser = await insertGoogleUser()
	const session = await setupUser()
	const request = await setupRequest({
		sessionId: session.id,
		code: googleUser.code,
	})
	const response = await loader({
		request,
		...LOADER_ARGS_BASE,
	})
	expect(response).toHaveRedirect('/settings/profile/connections')
	await expect(response).toSendToast(
		expect.objectContaining({ title: 'Not connected' }),
	)
	expect(
		await prisma.connection.count({ where: { userId: session.userId } }),
	).toBe(0)
})

async function matchingAccount(email: string) {
	return prisma.user.create({
		data: { ...createUser(), email: email.toLowerCase() },
		select: { id: true },
	})
}

test.each([
	['says it is not verified', { verified_email: false }],
	['leaves the verified field out', { verified_email: undefined }],
])(
	'an account with the same email isn’t linked when Google %s',
	async (_, overrides) => {
		const googleUser = await insertGoogleUser(undefined, overrides)
		const user = await matchingAccount(googleUser.profile.email)
		const request = await setupRequest({ code: googleUser.code })

		const response = await loader({ request, ...LOADER_ARGS_BASE }).catch(
			(thrown: unknown) => thrown as Response,
		)

		expect(response).toHaveRedirect('/login')
		await expect(response).toSendToast(
			expect.objectContaining({ type: 'error' }),
		)
		expect(await prisma.connection.count({ where: { userId: user.id } })).toBe(
			0,
		)
		expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
	},
)

test('an unverified email with no account doesn’t start a signup', async () => {
	const googleUser = await insertGoogleUser(undefined, {
		verified_email: false,
	})
	const request = await setupRequest({ code: googleUser.code })

	const response = await loader({ request, ...LOADER_ARGS_BASE }).catch(
		(thrown: unknown) => thrown as Response,
	)

	expect(response).toHaveRedirect('/login')
	await expect(response).toSendToast(expect.objectContaining({ type: 'error' }))
	expect(
		response.headers
			.getSetCookie()
			.some((cookie) => cookie.startsWith('en_verification=')),
	).toBe(false)
	expect(
		await prisma.user.count({ where: { email: googleUser.profile.email } }),
	).toBe(0)
})

test('an account with the same email is linked when Google says it is verified', async () => {
	const googleUser = await insertGoogleUser()
	const user = await matchingAccount(googleUser.profile.email)
	const request = await setupRequest({ code: googleUser.code })

	const response = await loader({ request, ...LOADER_ARGS_BASE })

	expect(response).toHaveRedirect('/')
	expect(await prisma.connection.count({ where: { userId: user.id } })).toBe(1)
	expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1)
})

test(`when a user is logged in and has already connected, it doesn't do anything and just redirects the user back to the connections page`, async () => {
	const session = await setupUser()
	const googleUser = await insertGoogleUser()
	await prisma.connection.create({
		data: {
			providerName: GOOGLE_PROVIDER_NAME,
			userId: session.userId,
			providerId: googleUser.profile.id.toString(),
		},
	})
	const request = await setupRequest({
		sessionId: session.id,
		code: googleUser.code,
	})
	const response = await loader({
		request,
		...LOADER_ARGS_BASE,
	})
	expect(response).toHaveRedirect('/settings/profile/connections')
	await expect(response).toSendToast(
		expect.objectContaining({
			title: 'Already Connected',
			description: expect.stringContaining(
				googleUser.profile.email.split('@')[0]!,
			),
		}),
	)
})

test('gives an error if the account is already connected to another user', async () => {
	const googleUser = await insertGoogleUser()
	await prisma.user.create({
		data: {
			...createUser(),
			connections: {
				create: {
					providerName: GOOGLE_PROVIDER_NAME,
					providerId: googleUser.profile.id.toString(),
				},
			},
		},
	})
	const session = await setupUser()
	const request = await setupRequest({
		sessionId: session.id,
		code: googleUser.code,
	})
	const response = await loader({
		request,
		...LOADER_ARGS_BASE,
	})
	expect(response).toHaveRedirect('/settings/profile/connections')
	await expect(response).toSendToast(
		expect.objectContaining({
			title: 'Already Connected',
			description: expect.stringContaining(
				'already connected to another account',
			),
		}),
	)
})

test('if a user is not logged in, but the connection exists, make a session', async () => {
	const googleUser = await insertGoogleUser()
	const { userId } = await setupUser()
	await prisma.connection.create({
		data: {
			providerName: GOOGLE_PROVIDER_NAME,
			providerId: googleUser.profile.id.toString(),
			userId,
		},
	})
	const request = await setupRequest({ code: googleUser.code })
	const response = await loader({
		request,
		...LOADER_ARGS_BASE,
	})
	expect(response).toHaveRedirect('/')
	await expect(response).toHaveSessionForUser(userId)
})

test('if a user is not logged in, but the connection exists and they have enabled 2FA, send them to verify their 2FA and do not make a session', async () => {
	const googleUser = await insertGoogleUser()
	const { userId } = await setupUser()
	await prisma.connection.create({
		data: {
			providerName: GOOGLE_PROVIDER_NAME,
			providerId: googleUser.profile.id.toString(),
			userId,
		},
	})
	const { otp: _otp, ...config } = await generateTOTP()
	await prisma.verification.create({
		data: {
			type: twoFAVerificationType,
			target: userId,
			...config,
		},
	})
	const request = await setupRequest({ code: googleUser.code })
	const response = await loader({
		request,
		...LOADER_ARGS_BASE,
	})
	const searchParams = new URLSearchParams({
		type: twoFAVerificationType,
		target: userId,
		redirectTo: '/',
	})
	expect(response).toHaveRedirect(`/verify?${searchParams}`)
})

async function setupRequest({
	sessionId,
	code = faker.string.uuid(),
}: { sessionId?: string; code?: string } = {}) {
	const url = new URL(ROUTE_PATH, BASE_URL)
	const state = faker.string.uuid()
	const codeVerifier = faker.string.uuid()
	url.searchParams.set('state', state)
	url.searchParams.set('code', code)
	const authSession = await authSessionStorage.getSession()
	if (sessionId) authSession.set(sessionKey, sessionId)
	const setSessionCookieHeader =
		await authSessionStorage.commitSession(authSession)
	// remix-auth-oauth2 StateStore format: state={state}&{state}={codeVerifier}
	// Cookie name must be {cookieName}:{uuid}
	const storeParams = new URLSearchParams()
	storeParams.set('state', state)
	storeParams.set(state, codeVerifier)
	const cookieId = faker.string.uuid()
	const authCookie = new SetCookie({
		name: `google:${cookieId}`,
		value: storeParams.toString(),
		path: '/',
		sameSite: 'Lax',
		httpOnly: true,
		maxAge: 60 * 5,
		secure: process.env.NODE_ENV === 'production' || undefined,
	})
	const request = new Request(url.toString(), {
		method: 'GET',
		headers: {
			cookie: [
				authCookie.toString(),
				convertSetCookieToCookie(setSessionCookieHeader),
			].join('; '),
		},
	})
	return request
}

async function setupUser(userData = createUser()) {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: {
				create: {
					...userData,
				},
			},
		},
		select: {
			id: true,
			userId: true,
		},
	})

	return session
}
