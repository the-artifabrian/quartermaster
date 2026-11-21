import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import { action as profileAction } from '#app/routes/settings/profile/index.tsx'
import {
	getSessionExpirationDate,
	getUserId,
	logout,
	sessionKey,
} from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { generateTOTP } from '#app/utils/totp.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL } from '#tests/utils.ts'
import { handleNewSession, shouldRequestTwoFA } from './login.server.ts'
import {
	prepareVerification,
	requireRecentVerification,
	validateRequest,
} from './verify.server.ts'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

// Failure list: what could let a code verify one account and act on another,
// or lose a code the user still needs.
//
// 2FA sign-in (a pending session waits in the verify cookie):
// 1. The pending session belongs to one user, and the code and target belong
//    to another user with 2FA. The pending session must not be signed in.
// 2. The pending session and the target are the same user. Signing in works.
// Reverify (no pending session):
// 3. The signed-in user differs from the target whose code was entered. Their
//    session must not be marked as recently verified.
// 4. Nobody is signed in and nothing is pending (the verify cookie expired).
//    A valid code signs nobody in and sends the user back to sign in.
// 5. The signed-in user enters their own code. Their session counts as
//    recently verified.
// Reverify window:
// 6. Verified 90 minutes ago: no reverify yet.
// 7. Verified 3 hours ago: reverify.
// Change email:
// 8. The signed-in user differs from the target. Neither account's email
//    changes.
// 9. The signed-in user is due to reverify. They are sent to reverify, and the
//    change-email code survives.
// 10. Request change, go stale, submit code, reverify, submit the code again:
//     the email changes, which needs both the code and the new address kept
//     through the reverify step. The used code then stops working.
// Shared browser (someone starts a 2FA sign-in and walks away):
// 11. Another person then signs in without 2FA. Their sign-in clears the
//     pending state, and pages that need a recent verification open.
// 12. The pending state is still there next to someone else's session (it
//     arrived after they signed in). It doesn't make them reverify.
// 13. That person has 2FA and is due to reverify. Their own code works.
// 14. Signing out clears the pending state with the session, and so do the
//     other ways a session ends here: deleting the account, and a session
//     that has expired or gone.
// 15. Pending state that belongs to the signed-in user still asks for 2FA,
//     and the person who started the sign-in can still finish it (2).
// A pending 2FA sign-in's limits (only someone with the password makes one):
// 16. Older than 10 minutes, the right code doesn't finish it, its Session
//     row is deleted, and it no longer asks the signed-in user for 2FA.
// 17. Five wrong codes end it: the row goes, the answer sends the user to log
//     in again, and the right code no longer works.
// 18. Four wrong codes and then the right one still sign in.
// 19. Wrong codes sent all at once each count.
// 20. A code for an account that is neither pending on this browser nor
//     signed in on it gets the same answer whether it is right or wrong.
// 21. A finished sign-in gets a new session id, so a kept copy of the verify
//     cookie can't end or reuse the signed-in session.

const twoHoursAgo = (extraMinutes: number) =>
	Date.now() - 1000 * 60 * (120 + extraMinutes)

async function createUserWithTwoFA() {
	const user = await prisma.user.create({
		data: createUser(),
		select: { id: true, email: true },
	})
	const { otp: _otp, ...totpConfig } = await generateTOTP()
	await prisma.verification.create({
		data: { ...totpConfig, type: twoFAVerificationType, target: user.id },
	})
	return { ...user, totpConfig }
}

async function createSession(userId: string) {
	return prisma.session.create({
		data: { expirationDate: getSessionExpirationDate(), userId },
		select: { id: true },
	})
}

function cookiePair(setCookie: string) {
	return setCookie.split(';')[0]!
}

async function cookieHeader({
	sessionId,
	verifiedTime,
	verify = {},
}: {
	sessionId?: string
	verifiedTime?: number
	verify?: Record<string, unknown>
}) {
	const authSession = await authSessionStorage.getSession()
	if (sessionId) authSession.set(sessionKey, sessionId)
	if (verifiedTime !== undefined) authSession.set('verified-time', verifiedTime)
	const verifySession = await verifySessionStorage.getSession()
	for (const [key, value] of Object.entries(verify))
		verifySession.set(key, value)
	return [
		cookiePair(await authSessionStorage.commitSession(authSession)),
		cookiePair(await verifySessionStorage.commitSession(verifySession)),
	].join('; ')
}

// Replaces cookies in `cookie` with any the response set, as a browser would.
function applySetCookies(cookie: string, setCookies: Array<string>) {
	const jar = new Map(
		cookie.split('; ').map((pair) => [pair.split('=')[0]!, pair] as const),
	)
	for (const setCookie of setCookies) {
		const pair = cookiePair(setCookie)
		jar.set(pair.split('=')[0]!, pair)
	}
	return [...jar.values()].join('; ')
}

type Outcome = {
	status: number
	location: string | null
	setCookies: Array<string>
	formErrors: unknown
}

async function submitVerify(
	fields: Record<string, string>,
	cookie: string,
	search = '',
): Promise<Outcome> {
	const body = new FormData()
	for (const [key, value] of Object.entries(fields)) body.set(key, value)
	const request = new Request(`${BASE_URL}/verify${search}`, {
		method: 'POST',
		headers: { cookie },
		body,
	})
	const result: unknown = await validateRequest(request, body).catch(
		(error: unknown) => error,
	)
	if (result instanceof Response) {
		return {
			status: result.status,
			location: result.headers.get('location'),
			setCookies: result.headers.getSetCookie(),
			formErrors: null,
		}
	}
	const { data, init } = result as {
		data: { result: { error?: unknown } }
		init?: { status?: number; headers?: HeadersInit }
	}
	return {
		status: init?.status ?? 200,
		location: null,
		setCookies: new Headers(init?.headers).getSetCookie(),
		formErrors: data.result.error,
	}
}

async function authSessionFrom(outcome: Outcome) {
	const authCookie = outcome.setCookies.find((c) => c.startsWith('en_session='))
	return authCookie
		? authSessionStorage.getSession(cookiePair(authCookie))
		: null
}

async function totpFor(user: {
	totpConfig: Parameters<typeof generateTOTP>[0]
}) {
	return (await generateTOTP(user.totpConfig)).otp
}

describe('2FA sign-in', () => {
	test('a code for another account does not sign in the pending session', async () => {
		const pendingUser = await createUserWithTwoFA()
		const otherUser = await createUserWithTwoFA()
		const pendingSession = await createSession(pendingUser.id)
		const cookie = await cookieHeader({
			verify: { 'unverified-session-id': pendingSession.id },
		})

		const outcome = await submitVerify(
			{ code: await totpFor(otherUser), type: '2fa', target: otherUser.id },
			cookie,
		)

		expect(outcome.status).toBe(400)
		expect(outcome.formErrors).toEqual({ code: ['Invalid code'] })
		expect(await authSessionFrom(outcome)).toBeNull()
	})

	test('the pending session’s own code signs it in', async () => {
		const user = await createUserWithTwoFA()
		const pendingSession = await createSession(user.id)
		const cookie = await cookieHeader({
			verify: { 'unverified-session-id': pendingSession.id },
		})

		const outcome = await submitVerify(
			{ code: await totpFor(user), type: '2fa', target: user.id },
			cookie,
		)

		expect(outcome.status).toBe(302)
		expect(outcome.location).toBe('/recipes')
		const authSession = await authSessionFrom(outcome)
		const signedInId = authSession?.get(sessionKey) as string
		expect(
			await prisma.session.findUnique({
				where: { id: signedInId },
				select: { userId: true },
			}),
		).toEqual({ userId: user.id })
	})
})

describe('pending 2FA sign-in limits', () => {
	const pendingKey = 'unverified-session-id'

	async function pendingSignIn() {
		const user = await createUserWithTwoFA()
		const pending = await createSession(user.id)
		const cookie = await cookieHeader({ verify: { [pendingKey]: pending.id } })
		return { user, pending, cookie }
	}

	async function wrongCodeFor(user: Parameters<typeof totpFor>[0]) {
		const right = await totpFor(user)
		return String((Number(right) + 500_000) % 1_000_000).padStart(6, '0')
	}

	function sessionExists(id: string) {
		return prisma.session.count({ where: { id } }).then((n) => n === 1)
	}

	test('a pending sign-in older than 10 minutes can’t be finished, and goes', async () => {
		const { user, pending, cookie } = await pendingSignIn()
		await prisma.session.update({
			where: { id: pending.id },
			data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) },
		})
		const signedIn = await createSession(user.id)
		const withSession = await cookieHeader({
			sessionId: signedIn.id,
			verifiedTime: Date.now(),
			verify: { [pendingKey]: pending.id },
		})
		expect(
			await shouldRequestTwoFA(
				new Request(BASE_URL, { headers: { cookie: withSession } }),
			),
		).toBe(false)

		const outcome = await submitVerify(
			{ code: await totpFor(user), type: '2fa', target: user.id },
			cookie,
		)

		expect(outcome.location).toBe('/login')
		expect(await authSessionFrom(outcome)).toBeNull()
		expect(await sessionExists(pending.id)).toBe(false)
	})

	test('five wrong codes end the pending sign-in', async () => {
		const { user, pending, cookie } = await pendingSignIn()
		const wrong = await wrongCodeFor(user)

		for (let i = 0; i < 4; i++) {
			const outcome = await submitVerify(
				{ code: wrong, type: '2fa', target: user.id },
				cookie,
			)
			expect(outcome.formErrors).toEqual({ code: ['Invalid code'] })
		}
		const fifth = await submitVerify(
			{ code: wrong, type: '2fa', target: user.id },
			cookie,
		)
		expect(fifth.location).toBe('/login')
		expect(await sessionExists(pending.id)).toBe(false)

		const right = await submitVerify(
			{ code: await totpFor(user), type: '2fa', target: user.id },
			cookie,
		)
		expect(right.location).toBe('/login')
		expect(await authSessionFrom(right)).toBeNull()
	})

	test('four wrong codes and then the right one still sign in', async () => {
		const { user, cookie } = await pendingSignIn()
		const wrong = await wrongCodeFor(user)
		for (let i = 0; i < 4; i++) {
			await submitVerify({ code: wrong, type: '2fa', target: user.id }, cookie)
		}

		const outcome = await submitVerify(
			{ code: await totpFor(user), type: '2fa', target: user.id },
			cookie,
		)

		expect(outcome.location).toBe('/recipes')
		expect((await authSessionFrom(outcome))?.get(sessionKey)).toBeTruthy()
	})

	test('wrong codes sent all at once each count', async () => {
		const { user, pending, cookie } = await pendingSignIn()
		const wrong = await wrongCodeFor(user)

		await Promise.all(
			Array.from({ length: 5 }, () =>
				submitVerify({ code: wrong, type: '2fa', target: user.id }, cookie),
			),
		)

		expect(await sessionExists(pending.id)).toBe(false)
		const right = await submitVerify(
			{ code: await totpFor(user), type: '2fa', target: user.id },
			cookie,
		)
		expect(await authSessionFrom(right)).toBeNull()
	})

	test('a code for an account not pending or signed in here answers the same, right or wrong', async () => {
		const user = await createUserWithTwoFA()
		const someoneElse = await createUserWithTwoFA()
		const cookies = [
			await cookieHeader({}),
			await cookieHeader({
				verify: { [pendingKey]: (await createSession(someoneElse.id)).id },
			}),
			await cookieHeader({
				sessionId: (await createSession(someoneElse.id)).id,
			}),
		]
		for (const cookie of cookies) {
			const right = await submitVerify(
				{ code: await totpFor(user), type: '2fa', target: user.id },
				cookie,
			)
			const wrong = await submitVerify(
				{ code: await wrongCodeFor(user), type: '2fa', target: user.id },
				cookie,
			)
			expect({ ...right, setCookies: [] }).toEqual({
				...wrong,
				setCookies: [],
			})
			expect(await authSessionFrom(right)).toBeNull()
		}
	})

	test('a kept copy of the verify cookie can’t touch the session it became', async () => {
		const { user, pending, cookie } = await pendingSignIn()
		const finished = await submitVerify(
			{ code: await totpFor(user), type: '2fa', target: user.id },
			cookie,
		)
		const signedInId = (await authSessionFrom(finished))?.get(
			sessionKey,
		) as string
		expect(signedInId).not.toBe(pending.id)
		expect(await sessionExists(pending.id)).toBe(false)

		const wrong = await wrongCodeFor(user)
		for (let i = 0; i < 5; i++) {
			await submitVerify({ code: wrong, type: '2fa', target: user.id }, cookie)
		}
		const reused = await submitVerify(
			{ code: await totpFor(user), type: '2fa', target: user.id },
			cookie,
		)

		expect(await authSessionFrom(reused)).toBeNull()
		expect(await sessionExists(signedInId)).toBe(true)
	})
})

describe('reverify', () => {
	test('another account’s code does not mark the signed-in session as verified', async () => {
		const signedIn = await createUserWithTwoFA()
		const otherUser = await createUserWithTwoFA()
		const session = await createSession(signedIn.id)
		const cookie = await cookieHeader({ sessionId: session.id })

		const outcome = await submitVerify(
			{ code: await totpFor(otherUser), type: '2fa', target: otherUser.id },
			cookie,
		)

		expect(outcome.status).toBe(400)
		expect(outcome.formErrors).toEqual({ code: ['Invalid code'] })
		expect(await authSessionFrom(outcome)).toBeNull()
	})

	test('a code entered while signed out with nothing pending sends the user to sign in', async () => {
		const user = await createUserWithTwoFA()
		const cookie = await cookieHeader({})

		const outcome = await submitVerify(
			{ code: await totpFor(user), type: '2fa', target: user.id },
			cookie,
		)

		expect(outcome.status).toBe(302)
		expect(outcome.location).toBe('/login')
		expect(await authSessionFrom(outcome)).toBeNull()
	})

	test('the signed-in user’s own code counts as a recent verification', async () => {
		const user = await createUserWithTwoFA()
		const session = await createSession(user.id)
		const cookie = await cookieHeader({
			sessionId: session.id,
			verifiedTime: twoHoursAgo(60),
		})
		const staleRequest = new Request(BASE_URL, { headers: { cookie } })
		expect(await shouldRequestTwoFA(staleRequest)).toBe(true)

		const outcome = await submitVerify(
			{
				code: await totpFor(user),
				type: '2fa',
				target: user.id,
				redirectTo: '/settings/profile/two-factor/disable',
			},
			cookie,
		)

		expect(outcome.status).toBe(302)
		expect(outcome.location).toBe('/settings/profile/two-factor/disable')
		const freshRequest = new Request(BASE_URL, {
			headers: { cookie: applySetCookies(cookie, outcome.setCookies) },
		})
		expect(await shouldRequestTwoFA(freshRequest)).toBe(false)
	})
})

describe('shared browser', () => {
	const pendingKey = 'unverified-session-id'

	async function createSessionFor(userId: string) {
		return prisma.session.create({
			data: { expirationDate: getSessionExpirationDate(), userId },
			select: { id: true, userId: true, expirationDate: true },
		})
	}

	async function signIn(
		session: Awaited<ReturnType<typeof createSessionFor>>,
		cookie: string,
	) {
		const response = await handleNewSession({
			request: new Request(`${BASE_URL}/login`, {
				method: 'POST',
				headers: { cookie },
			}),
			session,
			remember: false,
		})
		return applySetCookies(cookie, response.headers.getSetCookie())
	}

	async function pendingIn(cookie: string) {
		const verifySession = await verifySessionStorage.getSession(cookie)
		return verifySession.get(pendingKey) as string | undefined
	}

	async function opensRecentVerificationPage(cookie: string) {
		const result = await requireRecentVerification(
			new Request(`${BASE_URL}/settings/profile/change-email`, {
				headers: { cookie },
			}),
		).then(
			() => 'open',
			(error: unknown) =>
				error instanceof Response ? error.headers.get('location') : error,
		)
		return result
	}

	test('a sign-in without 2FA clears another person’s pending 2FA sign-in', async () => {
		const walkedAway = await createUserWithTwoFA()
		const nextUser = await prisma.user.create({
			data: createUser(),
			select: { id: true },
		})
		let cookie = await signIn(await createSessionFor(walkedAway.id), '')
		expect(await pendingIn(cookie)).toBeDefined()

		cookie = await signIn(await createSessionFor(nextUser.id), cookie)

		expect(await pendingIn(cookie)).toBeUndefined()
		expect(await opensRecentVerificationPage(cookie)).toBe('open')
	})

	test('another person’s pending sign-in does not make the signed-in user reverify', async () => {
		const walkedAway = await createUserWithTwoFA()
		const signedIn = await prisma.user.create({
			data: createUser(),
			select: { id: true },
		})
		const cookie = await cookieHeader({
			sessionId: (await createSession(signedIn.id)).id,
			verify: { [pendingKey]: (await createSession(walkedAway.id)).id },
		})

		expect(
			await shouldRequestTwoFA(new Request(BASE_URL, { headers: { cookie } })),
		).toBe(false)
		expect(await opensRecentVerificationPage(cookie)).toBe('open')
	})

	test('a 2FA user due to reverify can do it past another person’s pending sign-in', async () => {
		const walkedAway = await createUserWithTwoFA()
		const signedIn = await createUserWithTwoFA()
		const signedInSession = await createSession(signedIn.id)
		const pendingSession = await createSession(walkedAway.id)
		const cookie = await cookieHeader({
			sessionId: signedInSession.id,
			verifiedTime: twoHoursAgo(60),
			verify: { [pendingKey]: pendingSession.id },
		})

		const outcome = await submitVerify(
			{ code: await totpFor(signedIn), type: '2fa', target: signedIn.id },
			cookie,
		)

		expect(outcome.status).toBe(302)
		const fresh = applySetCookies(cookie, outcome.setCookies)
		expect(await opensRecentVerificationPage(fresh)).toBe('open')
		// Still the same person's session, and the other sign-in wasn't
		// finished on their behalf: it stays pending, untouched.
		const authSession = await authSessionStorage.getSession(fresh)
		expect(authSession.get(sessionKey)).toBe(signedInSession.id)
		expect(await pendingIn(fresh)).toBe(pendingSession.id)
	})

	test('signing out clears a pending 2FA sign-in', async () => {
		const walkedAway = await createUserWithTwoFA()
		const signedIn = await prisma.user.create({
			data: createUser(),
			select: { id: true },
		})
		const cookie = await cookieHeader({
			sessionId: (await createSession(signedIn.id)).id,
			verify: { [pendingKey]: (await createSession(walkedAway.id)).id },
		})

		const response = await logout({
			request: new Request(`${BASE_URL}/logout`, {
				method: 'POST',
				headers: { cookie },
			}),
		}).then(
			() => {
				throw new Error('Signing out should answer with a redirect')
			},
			(error: unknown) => error as Response,
		)

		const after = applySetCookies(cookie, response.headers.getSetCookie())
		expect(await pendingIn(after)).toBeUndefined()
	})

	async function pendingNextToSessionOf(userId: string) {
		const walkedAway = await createUserWithTwoFA()
		return cookieHeader({
			sessionId: (await createSession(userId)).id,
			verify: { [pendingKey]: (await createSession(walkedAway.id)).id },
		})
	}

	test('deleting the account clears a pending 2FA sign-in', async () => {
		const leaving = await prisma.user.create({
			data: createUser(),
			select: { id: true },
		})
		const cookie = await pendingNextToSessionOf(leaving.id)
		const url = new URL(`${BASE_URL}/settings/profile`)

		const response = (await profileAction({
			request: new Request(url, {
				method: 'POST',
				headers: {
					cookie,
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({ intent: 'delete-data' }),
			}),
			params: {},
			context: new RouterContextProvider(),
			pattern: '/settings/profile',
			url,
		})) as Response

		expect(await prisma.user.findUnique({ where: { id: leaving.id } })).toBe(
			null,
		)
		const after = applySetCookies(cookie, response.headers.getSetCookie())
		expect(await pendingIn(after)).toBeUndefined()
	})

	test('a session that has gone clears a pending 2FA sign-in on its way out', async () => {
		const signedIn = await prisma.user.create({
			data: createUser(),
			select: { id: true },
		})
		const cookie = await pendingNextToSessionOf(signedIn.id)
		await prisma.session.deleteMany({ where: { userId: signedIn.id } })

		const response = await getUserId(
			new Request(BASE_URL, { headers: { cookie } }),
		).then(
			() => {
				throw new Error('A gone session should answer with a redirect')
			},
			(error: unknown) => error as Response,
		)

		const after = applySetCookies(cookie, response.headers.getSetCookie())
		expect(await pendingIn(after)).toBeUndefined()
	})

	test('a pending sign-in of the signed-in user’s own still asks for 2FA', async () => {
		const user = await createUserWithTwoFA()
		const cookie = await cookieHeader({
			sessionId: (await createSession(user.id)).id,
			verifiedTime: Date.now(),
			verify: { [pendingKey]: (await createSession(user.id)).id },
		})

		expect(
			await shouldRequestTwoFA(new Request(BASE_URL, { headers: { cookie } })),
		).toBe(true)
	})
})

describe('reverify window', () => {
	async function needsReverify(verifiedTime: number) {
		const user = await createUserWithTwoFA()
		const session = await createSession(user.id)
		const cookie = await cookieHeader({ sessionId: session.id, verifiedTime })
		return shouldRequestTwoFA(new Request(BASE_URL, { headers: { cookie } }))
	}

	test('a verification from 90 minutes ago is still recent', async () => {
		expect(await needsReverify(twoHoursAgo(-30))).toBe(false)
	})

	test('a verification from 3 hours ago asks for a reverify', async () => {
		expect(await needsReverify(twoHoursAgo(60))).toBe(true)
	})
})

describe('change email', () => {
	async function requestChange(userId: string, address: string) {
		let otp = ''
		await prepareVerification({
			target: userId,
			type: 'change-email',
			address,
			send: async (email) => {
				otp = email.otp
				return { status: 'success' as const }
			},
		})
		return otp
	}

	const newEmail = () =>
		`new-${Math.random().toString(36).slice(2)}@example.com`.toLowerCase()

	test('a code for another account changes neither account’s email', async () => {
		const signedIn = await prisma.user.create({
			data: createUser(),
			select: { id: true, email: true },
		})
		const otherUser = await prisma.user.create({
			data: createUser(),
			select: { id: true, email: true },
		})
		const session = await createSession(signedIn.id)
		const address = newEmail()
		const otherCode = await requestChange(otherUser.id, address)
		const cookie = await cookieHeader({
			sessionId: session.id,
			verify: { 'new-email-address': [address] },
		})

		const outcome = await submitVerify(
			{ code: otherCode, type: 'change-email', target: otherUser.id },
			cookie,
		)

		expect(outcome.status).toBe(400)
		expect(outcome.formErrors).toEqual({ code: ['Invalid code'] })
		const emails = await prisma.user.findMany({
			where: { id: { in: [signedIn.id, otherUser.id] } },
			select: { id: true, email: true },
		})
		expect(emails).toEqual(
			expect.arrayContaining([
				{ id: signedIn.id, email: signedIn.email },
				{ id: otherUser.id, email: otherUser.email },
			]),
		)
	})

	test('a user due to reverify keeps their change-email code', async () => {
		const user = await createUserWithTwoFA()
		const session = await createSession(user.id)
		const address = newEmail()
		const code = await requestChange(user.id, address)
		const cookie = await cookieHeader({
			sessionId: session.id,
			verifiedTime: twoHoursAgo(60),
			verify: { 'new-email-address': [address] },
		})

		const outcome = await submitVerify(
			{ code, type: 'change-email', target: user.id },
			cookie,
		)

		expect(outcome.status).toBe(302)
		const location = new URL(outcome.location!, BASE_URL)
		expect(location.pathname).toBe('/verify')
		expect(location.searchParams.get('type')).toBe('2fa')
		expect(
			await prisma.emailCode.count({
				where: { target: user.id, type: 'change-email' },
			}),
		).toBe(1)
		expect(
			await prisma.user.findUniqueOrThrow({
				where: { id: user.id },
				select: { email: true },
			}),
		).toEqual({ email: user.email })
	})

	test('the email changes after a reverify in the middle, and the code is then spent', async () => {
		const user = await createUserWithTwoFA()
		const session = await createSession(user.id)
		const address = newEmail()
		const code = await requestChange(user.id, address)
		const search = `?type=change-email&target=${user.id}`
		let cookie = await cookieHeader({
			sessionId: session.id,
			verifiedTime: twoHoursAgo(60),
			verify: { 'new-email-address': [address] },
		})
		const changeEmail = { code, type: 'change-email', target: user.id }

		const sentToReverify = await submitVerify(changeEmail, cookie, search)
		const reverifyUrl = new URL(sentToReverify.location!, BASE_URL)
		cookie = applySetCookies(cookie, sentToReverify.setCookies)

		const reverified = await submitVerify(
			{
				code: await totpFor(user),
				type: '2fa',
				target: user.id,
				redirectTo: reverifyUrl.searchParams.get('redirectTo')!,
			},
			cookie,
		)
		expect(reverified.location).toBe(`/verify${search}`)
		cookie = applySetCookies(cookie, reverified.setCookies)

		const changed = await submitVerify(changeEmail, cookie, search)
		expect(changed.status).toBe(302)
		expect(changed.location).toBe('/settings/profile')
		expect(
			await prisma.user.findUniqueOrThrow({
				where: { id: user.id },
				select: { email: true },
			}),
		).toEqual({ email: address })

		const reused = await submitVerify(changeEmail, cookie, search)
		expect(reused.status).toBe(400)
		expect(reused.formErrors).toEqual({ code: ['Invalid code'] })
	})
})
