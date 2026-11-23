import type * as SimpleWebAuthnServer from '@simplewebauthn/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { RouterContextProvider } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { generateTOTP } from '#app/utils/totp.server.ts'
import { createPassword, createUser } from '#tests/db-utils.ts'
import {
	BASE_URL,
	convertSetCookieToCookie,
	getSessionCookieHeader,
} from '#tests/utils.ts'
import { loader as passkeysPageLoader } from '#app/routes/settings/profile/passkeys.tsx'
import { action } from './registration.ts'
import {
	getWebAuthnConfig,
	passkeyCookie,
	webauthnUserHandle,
} from './utils.server.ts'
import '#tests/setup/db-setup.ts'

// Failure list for adding a passkey from Settings:
// 1. No password sent. Refused, and no challenge is handed out.
// 2. A wrong password. Refused with an error on the password, no challenge.
// 3. The right password. Options come back with a challenge cookie. They ask
//    for a discoverable passkey and exclude the passkeys already saved.
// 4. An account with no password (it only ever logged in with Google).
//    Refused with a pointer to a password reset, no challenge.
// 5. A 2FA user past the reverify window, with the right password. Sent to
//    reverify and back to the Passkeys page, no challenge.
// 6. A 2FA user inside the window gets options.
// 7. Saving with no challenge cookie (the password step skipped). Nothing is
//    saved and no email goes out.
// 8. Saving with a challenge cookie handed to another account. Refused.
// 9. Saving with a challenge cookie past its few minutes. Refused.
// 10. Saving with the sign-in challenge cookie. Refused.
// 11. Saving after the password step. The passkey is saved to this account and
//     one notice goes to the account's email.
// 12. A response that fails WebAuthn verification. Nothing saved, no email.
// 13. A passkey that is already saved. No second row, no email.
// 14. A signed-out request is sent to log in.
// 15. A 2FA user past the window who opens the Passkeys page is sent to
//     reverify before typing a password, and comes back to the page.
// 16. The challenge cookie from one password check is sent again, by the
//     same browser or a copy, to save a second passkey. Refused: one passkey,
//     one notice.
// 17. The saved passkey is checked against the challenge from the cookie,
//     with user verification required and this app's origin and RP ID.
// 18. Each refusal names its reason (password needed, already registered,
//     not saved), so the page shows the right message.
// 19. The account can't be read while saving. Nothing is saved, so no
//     passkey exists without its notice.
// 20. A save that worked is sent again (its answer was lost). It says the
//     passkey is already registered, not that the password is needed.

vi.mock('@simplewebauthn/server', async (importOriginal) => ({
	...(await importOriginal<typeof SimpleWebAuthnServer>()),
	verifyRegistrationResponse: vi.fn(),
}))

vi.mock('#app/utils/email.server.ts', () => ({
	sendEmail: vi.fn(async () => ({
		status: 'success',
		data: { id: 'mocked' },
	})),
}))

const password = 'current-password-1234'
const credentialId = 'Y3JlZGVudGlhbC0x'

const registrationResponse = {
	id: credentialId,
	rawId: credentialId,
	response: {
		clientDataJSON: 'e30',
		attestationObject: 'e30',
		transports: ['internal'],
	},
	clientExtensionResults: {},
	type: 'public-key',
}

function verifiedRegistration(id: string) {
	return {
		verified: true,
		registrationInfo: {
			fmt: 'none',
			aaguid: '00000000-0000-0000-0000-000000000000',
			credential: {
				id,
				publicKey: new Uint8Array([1, 2, 3]),
				counter: 0,
				transports: ['internal'],
			},
			credentialType: 'public-key',
			attestationObject: new Uint8Array(),
			userVerified: true,
			credentialDeviceType: 'multiDevice',
			credentialBackedUp: true,
			origin: BASE_URL,
		},
	} as Awaited<ReturnType<typeof verifyRegistrationResponse>>
}

beforeEach(() => {
	vi.mocked(sendEmail).mockClear()
	vi.mocked(verifyRegistrationResponse).mockReset()
	vi.mocked(verifyRegistrationResponse).mockResolvedValue(
		verifiedRegistration(credentialId),
	)
})

async function signedInUser({
	withPassword = true,
	twoFA = false,
}: { withPassword?: boolean; twoFA?: boolean } = {}) {
	const user = await prisma.user.create({
		data: {
			...createUser(),
			...(withPassword
				? { password: { create: createPassword(password) } }
				: {}),
		},
		select: { id: true, email: true },
	})
	if (twoFA) {
		const { otp: _otp, ...config } = await generateTOTP()
		await prisma.verification.create({
			data: { ...config, type: twoFAVerificationType, target: user.id },
		})
	}
	const session = await prisma.session.create({
		data: { expirationDate: getSessionExpirationDate(), userId: user.id },
		select: { id: true },
	})
	return { user, cookie: await getSessionCookieHeader(session) }
}

function post(body: unknown, cookie?: string) {
	const url = `${BASE_URL}/webauthn/registration`
	const request = new Request(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify(body),
	})
	return action({
		request,
		url: new URL(url),
		params: {},
		pattern: '/webauthn/registration',
		context: new RouterContextProvider(),
	})
}

function challengeCookieOf(response: Response) {
	const setCookie = response.headers
		.getSetCookie()
		.find((c) => c.startsWith('webauthn-challenge=') && !/Max-Age=0/i.test(c))
	return setCookie ? convertSetCookieToCookie(setCookie) : null
}

async function startWithPassword(cookie: string) {
	const response = await post({ intent: 'options', password }, cookie)
	expect(response.status).toBe(200)
	const challengeCookie = challengeCookieOf(response)
	expect(challengeCookie).not.toBeNull()
	return { response, cookie: `${cookie}; ${challengeCookie}` }
}

async function savedPasskeyCount(userId: string) {
	return prisma.passkey.count({ where: { userId } })
}

test('asking for options without a password hands out no challenge', async () => {
	const { cookie } = await signedInUser()
	const response = await post({ intent: 'options' }, cookie)
	expect(response.status).toBe(400)
	expect(challengeCookieOf(response)).toBeNull()
})

test('a wrong password hands out no challenge and says the password is wrong', async () => {
	const { cookie } = await signedInUser()
	const response = await post({ intent: 'options', password: 'nope' }, cookie)
	expect(response.status).toBe(400)
	expect(await response.json()).toEqual({
		status: 'error',
		field: 'password',
		error: expect.stringMatching(/incorrect password/i),
	})
	expect(challengeCookieOf(response)).toBeNull()
})

test('the right password returns options for a discoverable passkey, without the ones already saved', async () => {
	const { user, cookie } = await signedInUser()
	await prisma.passkey.create({
		data: {
			id: 'ZXhpc3Rpbmc',
			aaguid: '00000000-0000-0000-0000-000000000000',
			publicKey: Buffer.from([1]),
			userId: user.id,
			webauthnUserId: webauthnUserHandle(user.id),
			counter: 0,
			deviceType: 'multiDevice',
			backedUp: true,
		},
	})
	const { response } = await startWithPassword(cookie)
	const json = (await response.json()) as {
		status: string
		options: {
			authenticatorSelection: unknown
			excludeCredentials: unknown
			user: { id: string }
		}
	}
	expect(json.status).toBe('ready')
	expect(json.options.authenticatorSelection).toMatchObject({
		residentKey: 'required',
		requireResidentKey: true,
	})
	expect(json.options.excludeCredentials).toEqual([
		expect.objectContaining({ id: 'ZXhpc3Rpbmc' }),
	])
	expect(json.options.user.id).toBe(webauthnUserHandle(user.id))
})

test('an account with no password is pointed at a reset and gets no challenge', async () => {
	const { cookie } = await signedInUser({ withPassword: false })
	const response = await post({ intent: 'options', password }, cookie)
	expect(response.status).toBe(400)
	expect(await response.json()).toMatchObject({
		status: 'error',
		error: expect.stringMatching(/reset your password/i),
	})
	expect(challengeCookieOf(response)).toBeNull()
})

test('a 2FA user past the reverify window is sent to reverify, back to the Passkeys page', async () => {
	const { cookie } = await signedInUser({ twoFA: true })
	const response = await post({ intent: 'options', password }, cookie)
	expect(response.status).toBe(403)
	const json = (await response.json()) as { status: string; location: string }
	expect(json.status).toBe('reverify')
	const location = new URL(json.location, BASE_URL)
	expect(location.pathname).toBe('/verify')
	expect(location.searchParams.get('redirectTo')).toBe(
		'/settings/profile/passkeys',
	)
	expect(challengeCookieOf(response)).toBeNull()
})

test('a 2FA user who reverified recently gets options', async () => {
	const { cookie } = await signedInUser({ twoFA: true })
	const { authSessionStorage } = await import('#app/utils/session.server.ts')
	const authSession = await authSessionStorage.getSession(cookie)
	authSession.set('verified-time', Date.now())
	const freshCookie = convertSetCookieToCookie(
		await authSessionStorage.commitSession(authSession),
	)
	await startWithPassword(freshCookie)
})

test('saving without the password step saves nothing and sends nothing', async () => {
	const { user, cookie } = await signedInUser()
	const response = await post(
		{ intent: 'verify', response: registrationResponse },
		cookie,
	)
	expect(response.status).toBe(400)
	expect(await savedPasskeyCount(user.id)).toBe(0)
	expect(sendEmail).not.toHaveBeenCalled()
})

test('a challenge handed to another account can’t save a passkey here', async () => {
	const other = await signedInUser()
	const { cookie: otherWithChallenge } = await startWithPassword(other.cookie)
	const challengeCookie = otherWithChallenge.split('; ').at(-1)!
	const { user, cookie } = await signedInUser()
	const response = await post(
		{ intent: 'verify', response: registrationResponse },
		`${cookie}; ${challengeCookie}`,
	)
	expect(response.status).toBe(400)
	expect(await savedPasskeyCount(user.id)).toBe(0)
	expect(await savedPasskeyCount(other.user.id)).toBe(0)
	expect(sendEmail).not.toHaveBeenCalled()
})

test('a challenge older than its few minutes can’t save a passkey', async () => {
	const { user, cookie } = await signedInUser()
	const stale = convertSetCookieToCookie(
		await passkeyCookie.serialize({
			purpose: 'add-passkey',
			challenge: 'Y2hhbGxlbmdl',
			webauthnUserId: webauthnUserHandle(user.id),
			userId: user.id,
			expiresAt: Date.now() - 1000,
		}),
	)
	const response = await post(
		{ intent: 'verify', response: registrationResponse },
		`${cookie}; ${stale}`,
	)
	expect(response.status).toBe(400)
	expect(await savedPasskeyCount(user.id)).toBe(0)
	expect(sendEmail).not.toHaveBeenCalled()
})

test('the sign-in challenge can’t save a passkey', async () => {
	const { user, cookie } = await signedInUser()
	const signIn = convertSetCookieToCookie(
		await passkeyCookie.serialize({ challenge: 'Y2hhbGxlbmdl' }),
	)
	const response = await post(
		{ intent: 'verify', response: registrationResponse },
		`${cookie}; ${signIn}`,
	)
	expect(response.status).toBe(400)
	expect(await savedPasskeyCount(user.id)).toBe(0)
	expect(sendEmail).not.toHaveBeenCalled()
})

test('after the password step the passkey is saved and one notice goes to the account’s email', async () => {
	const { user, cookie } = await signedInUser()
	const started = await startWithPassword(cookie)
	const response = await post(
		{ intent: 'verify', response: registrationResponse },
		started.cookie,
	)
	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ status: 'success' })
	const saved = await prisma.passkey.findMany({
		where: { userId: user.id },
		select: { id: true, webauthnUserId: true },
	})
	expect(saved).toEqual([
		{ id: credentialId, webauthnUserId: webauthnUserHandle(user.id) },
	])
	expect(sendEmail).toHaveBeenCalledTimes(1)
	expect(sendEmail).toHaveBeenCalledWith(
		expect.objectContaining({ to: user.email }),
	)
})

test('a response that fails verification saves nothing and sends nothing', async () => {
	vi.mocked(verifyRegistrationResponse).mockResolvedValue({
		verified: false,
	})
	const { user, cookie } = await signedInUser()
	const started = await startWithPassword(cookie)
	const response = await post(
		{ intent: 'verify', response: registrationResponse },
		started.cookie,
	)
	expect(response.status).toBe(400)
	expect(await savedPasskeyCount(user.id)).toBe(0)
	expect(sendEmail).not.toHaveBeenCalled()
})

test('a passkey that is already saved isn’t saved again and sends nothing', async () => {
	const { user, cookie } = await signedInUser()
	await prisma.passkey.create({
		data: {
			id: credentialId,
			aaguid: '00000000-0000-0000-0000-000000000000',
			publicKey: Buffer.from([1]),
			userId: user.id,
			webauthnUserId: webauthnUserHandle(user.id),
			counter: 0,
			deviceType: 'multiDevice',
			backedUp: true,
		},
	})
	const started = await startWithPassword(cookie)
	const response = await post(
		{ intent: 'verify', response: registrationResponse },
		started.cookie,
	)
	expect(response.status).toBe(400)
	expect(await savedPasskeyCount(user.id)).toBe(1)
	expect(sendEmail).not.toHaveBeenCalled()
})

test('a signed-out request is sent to log in', async () => {
	const thrown = await post({ intent: 'options', password }).then(
		() => null,
		(error: unknown) => error,
	)
	expect(thrown).toBeInstanceOf(Response)
	expect((thrown as Response).headers.get('location')).toMatch(/^\/login/)
})

test('a 2FA user past the reverify window opening the Passkeys page reverifies first', async () => {
	const { cookie } = await signedInUser({ twoFA: true })
	const url = `${BASE_URL}/settings/profile/passkeys.data`
	const thrown = await passkeysPageLoader({
		request: new Request(url, { headers: { cookie } }),
		url: new URL(url),
		params: {},
		pattern: '/settings/profile/passkeys',
		context: new RouterContextProvider(),
	}).then(
		() => null,
		(error: unknown) => error,
	)
	expect(thrown).toBeInstanceOf(Response)
	const location = new URL(
		(thrown as Response).headers.get('location')!,
		BASE_URL,
	)
	expect(location.pathname).toBe('/verify')
	expect(location.searchParams.get('redirectTo')).toBe(
		'/settings/profile/passkeys',
	)
})

function verifyResponse(id: string) {
	return { ...registrationResponse, id, rawId: id }
}

test('one password check saves one passkey, even when its cookie is sent again', async () => {
	const { user, cookie } = await signedInUser()
	const started = await startWithPassword(cookie)
	const first = await post(
		{ intent: 'verify', response: registrationResponse },
		started.cookie,
	)
	expect(first.status).toBe(200)

	const secondId = 'c2Vjb25kLWNyZWQ'
	vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce(
		verifiedRegistration(secondId),
	)
	const replay = await post(
		{ intent: 'verify', response: verifyResponse(secondId) },
		started.cookie,
	)
	expect(replay.status).toBe(400)
	expect(await replay.json()).toMatchObject({
		status: 'error',
		code: 'enter-password',
	})
	expect(await savedPasskeyCount(user.id)).toBe(1)
	expect(sendEmail).toHaveBeenCalledTimes(1)
})

test('a refused save can’t be retried with the same cookie either', async () => {
	vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
		verified: false,
	})
	const { user, cookie } = await signedInUser()
	const started = await startWithPassword(cookie)
	const refused = await post(
		{ intent: 'verify', response: registrationResponse },
		started.cookie,
	)
	expect(refused.status).toBe(400)
	const retry = await post(
		{ intent: 'verify', response: registrationResponse },
		started.cookie,
	)
	expect(await retry.json()).toMatchObject({ code: 'enter-password' })
	expect(await savedPasskeyCount(user.id)).toBe(0)
})

test('the passkey is checked against the cookie’s challenge, with user verification', async () => {
	const { cookie } = await signedInUser()
	const started = await startWithPassword(cookie)
	const { options } = (await started.response.json()) as {
		options: { challenge: string }
	}
	await post(
		{ intent: 'verify', response: registrationResponse },
		started.cookie,
	)
	const { origin, rpID } = getWebAuthnConfig()
	expect(verifyRegistrationResponse).toHaveBeenCalledTimes(1)
	expect(verifyRegistrationResponse).toHaveBeenCalledWith(
		expect.objectContaining({
			expectedChallenge: options.challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			requireUserVerification: true,
		}),
	)
})

test('each refusal names its reason', async () => {
	const { user, cookie } = await signedInUser()

	const noProof = await post(
		{ intent: 'verify', response: registrationResponse },
		cookie,
	)
	expect(await noProof.json()).toEqual({
		status: 'error',
		code: 'enter-password',
		error: 'Enter your password and try again.',
	})

	vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
		verified: false,
	})
	const unverified = await post(
		{ intent: 'verify', response: registrationResponse },
		(await startWithPassword(cookie)).cookie,
	)
	expect(await unverified.json()).toMatchObject({ code: 'not-saved' })

	await prisma.passkey.create({
		data: {
			id: credentialId,
			aaguid: '00000000-0000-0000-0000-000000000000',
			publicKey: Buffer.from([1]),
			userId: user.id,
			webauthnUserId: webauthnUserHandle(user.id),
			counter: 0,
			deviceType: 'multiDevice',
			backedUp: true,
		},
	})
	const duplicate = await post(
		{ intent: 'verify', response: registrationResponse },
		(await startWithPassword(cookie)).cookie,
	)
	expect(await duplicate.json()).toMatchObject({
		code: 'already-registered',
		error: expect.stringMatching(/already/i),
	})
})

test('when the account can’t be read while saving, no passkey is saved', async () => {
	const { user, cookie } = await signedInUser()
	const started = await startWithPassword(cookie)
	vi.spyOn(prisma.user, 'findUniqueOrThrow').mockRejectedValueOnce(
		new Error('database unavailable'),
	)
	const response = await post(
		{ intent: 'verify', response: registrationResponse },
		started.cookie,
	)
	expect(response.status).toBe(400)
	expect(await savedPasskeyCount(user.id)).toBe(0)
	expect(sendEmail).not.toHaveBeenCalled()
})

test('a save that worked, sent again, says the passkey is already registered', async () => {
	const { user, cookie } = await signedInUser()
	const started = await startWithPassword(cookie)
	const first = await post(
		{ intent: 'verify', response: registrationResponse },
		started.cookie,
	)
	expect(first.status).toBe(200)
	const resend = await post(
		{ intent: 'verify', response: registrationResponse },
		started.cookie,
	)
	expect(await resend.json()).toMatchObject({
		status: 'error',
		code: 'already-registered',
	})
	expect(await savedPasskeyCount(user.id)).toBe(1)
	expect(sendEmail).toHaveBeenCalledTimes(1)
})
