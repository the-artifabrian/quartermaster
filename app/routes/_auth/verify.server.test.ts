import { describe, expect, test } from 'vitest'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import { getSessionExpirationDate, sessionKey } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { generateTOTP } from '#app/utils/totp.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL } from '#tests/utils.ts'
import { shouldRequestTwoFA } from './login.server.ts'
import { prepareVerification, validateRequest } from './verify.server.ts'
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
		expect(authSession?.get(sessionKey)).toBe(pendingSession.id)
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
	async function requestChange(userId: string) {
		const request = new Request(`${BASE_URL}/settings/profile/change-email`)
		const { otp } = await prepareVerification({
			period: 10 * 60,
			request,
			target: userId,
			type: 'change-email',
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
		const otherCode = await requestChange(otherUser.id)
		const cookie = await cookieHeader({
			sessionId: session.id,
			verify: { 'new-email-address': newEmail() },
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
		const code = await requestChange(user.id)
		const cookie = await cookieHeader({
			sessionId: session.id,
			verifiedTime: twoHoursAgo(60),
			verify: { 'new-email-address': newEmail() },
		})

		const outcome = await submitVerify(
			{ code, type: 'change-email', target: user.id },
			cookie,
		)

		expect(outcome.status).toBe(302)
		const location = new URL(outcome.location!)
		expect(location.pathname).toBe('/verify')
		expect(location.searchParams.get('type')).toBe('2fa')
		expect(
			await prisma.verification.findUnique({
				where: { target_type: { target: user.id, type: 'change-email' } },
				select: { id: true },
			}),
		).not.toBeNull()
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
		const code = await requestChange(user.id)
		const address = newEmail()
		const search = `?type=change-email&target=${user.id}`
		let cookie = await cookieHeader({
			sessionId: session.id,
			verifiedTime: twoHoursAgo(60),
			verify: { 'new-email-address': address },
		})
		const changeEmail = { code, type: 'change-email', target: user.id }

		const sentToReverify = await submitVerify(changeEmail, cookie, search)
		const reverifyUrl = new URL(sentToReverify.location!)
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
	})
})
