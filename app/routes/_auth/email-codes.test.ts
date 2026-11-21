import { createHash } from 'node:crypto'
import { http, HttpResponse } from 'msw'
import { RouterContextProvider } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { action as changeEmailAction } from '#app/routes/settings/profile/change-email.tsx'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import { action as createPasswordAction } from '#app/routes/settings/profile/password_.create.tsx'
import { action as changePasswordAction } from '#app/routes/settings/profile/password.tsx'
import {
	getSessionExpirationDate,
	resetUserPassword,
} from '#app/utils/auth.server.ts'
import { backgroundWorkSettled } from '#app/utils/background.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	checkEmailCode,
	emailCodeDigest,
} from '#app/utils/email-code.server.ts'
import { redactUrl } from '#app/utils/redact-url.ts'
import { toastKey, toastSessionStorage } from '#app/utils/toast.server.ts'
import { generateTOTP } from '#app/utils/totp.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { createPassword, createUser } from '#tests/db-utils.ts'
import { server } from '#tests/setup/mocks-setup.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as forgotPasswordAction } from './forgot-password.tsx'
import { onboardingEmailSessionKey } from './onboarding/index.tsx'
import { action as signupAction } from './signup.tsx'
import {
	isCodeValid,
	prepareVerification,
	validateRequest,
} from './verify.server.ts'
import '#tests/setup/db-setup.ts'

// Failure list for emailed codes (signup, password reset, email change).
//
// Someone who knows only a username or email address:
// 1. Asks for reset codes for the owner, by username and by email, again and
//    again. The code the owner got first still works, and so does its link.
// 2. Fills the cap. The owner's earliest code still works, the next request
//    answers exactly like the others and sends nothing, and once the codes
//    expire a request sends again.
// 3. Sends many requests at once. No more than the cap go out or get stored.
// 4. Submits many wrong codes, from many addresses. The owner's code still
//    works afterwards.
// 5. Asks for a reset for an account that doesn't exist. The answer is the
//    same, nothing is stored and nothing is sent.
//
// Reset by username and by email:
// 6. Asked for by username, then by email: one bucket and one cap, and both
//    codes work, whichever form of the account the verify step is given.
//
// Using codes:
// 7. The same code submitted twice at once: exactly one succeeds.
// 8. A used code stops working, and using one code ends the target's other
//    live codes.
// 9. A code past its 10 minutes fails.
// 10. A code typed in lowercase works.
// 11. The emailed link works without the typed code, and a link for one
//     target fails for another.
// 12. A code for one target fails for another target, and a reset code fails
//     as a signup code.
// 13. Codes and link tokens are never stored as they were sent.
// 14. A code whose email is still going out can't be used yet.
//
// Code kinds:
// 15. An emailed code submitted as a 2FA code fails, and an authenticator
//     code submitted as an emailed code fails, at the form and in the
//     functions behind it.
//
// Sending:
// 16. A failed email send stores nothing and leaves earlier codes working.
// 17. Signup with a mixed-case address stores the code under the address as
//     the account will store it.
//
// Email change:
// 18. A request for address A and then for B: A's code can't set the email
//     to B.
// 19. A code submitted without the requesting device's cookie fails.
//
// Past the cap, what the person is told:
// 20. Forgot-password answers exactly as it does under the cap.
// 21. Signup already says when an address has an account, so past the cap it
//     says plainly that no new email went out and earlier codes still work.
// 22. Change email is signed in, so it says the same, and keeps the address
//     list in the cookie as it was.
//
// Logs:
// 23. The link token is redacted, including inside redirectTo.
//
// A new password or email ends reset codes:
// 24. A reset code sent to the old address stops working once the email
//     changes.
// 25. Changing the password in Settings ends reset codes.
// 26. Creating a first password ends reset codes.
// 27. The reset itself ends codes asked for after the verify step.
//
// More:
// 28. A code sent from one device can't be used on another device that
//     asked for a different address.
// 29. In a burst of requests each one ends as sent or as past the cap; none
//     fails on the database.
// 30. A stored hash can't be checked without the server's secret: it isn't a
//     plain SHA-256 of the code or token, and a code stops checking under
//     another secret.
// 31. If the code can't be marked as sent after its email went out, the
//     person is told the send failed, and no half-made code holds a place
//     under the cap.
//
// Forgot-password answers before it sends:
// 32. A known account gets its answer while the email is still going out, so
//     it doesn't answer slower than an unknown one. The code then arrives and
//     works.
// 33. A send that fails after the answer leaves no working code, and the
//     failure is logged rather than lost or thrown at the request.
// 34. The work after the answer throws (the database read fails): the error
//     is caught and logged, and never becomes an unhandled rejection, which
//     would take the process down.
//
// GET /verify consuming nothing is checked in tests/e2e/onboarding.test.ts,
// through the real page.

const CAP = 5
const CODE_LIFETIME_MS = 10 * 60 * 1000

afterEach(() => {
	vi.useRealTimers()
})

type Sent = { to: string; text: string }

/** Keeps the emails sent while the test runs. */
function captureEmails(onSend?: (email: Sent) => Promise<void>) {
	const sent: Sent[] = []
	server.use(
		http.post('https://api.resend.com/emails', async ({ request }) => {
			const body = (await request.json()) as Sent
			await onSend?.(body)
			sent.push({ to: body.to, text: body.text })
			return HttpResponse.json({ id: `email-${sent.length}` })
		}),
	)
	return sent
}

function failEmails() {
	consoleError.mockImplementation(() => {})
	server.use(
		http.post('https://api.resend.com/emails', () =>
			HttpResponse.json({ message: 'down' }, { status: 500 }),
		),
	)
}

/** The typed code, and the verify link's fields, from one email. */
function readCode(email: Sent | undefined) {
	const text = email?.text ?? ''
	const code = /verification code: ([A-Z0-9]+)/.exec(text)?.[1]
	const link = /https?:\/\/\S+\/verify\?\S+/.exec(text)?.[0]
	if (!code || !link) throw new Error('No code in the email')
	const url = new URL(link)
	return {
		code,
		type: url.searchParams.get('type')!,
		target: url.searchParams.get('target')!,
		token: url.searchParams.get('token'),
		link: url,
	}
}

// Each route types its own action arguments; these tests build the same
// shape for all of them.
type AnyAction = (args: never) => unknown

async function callAction(
	action: AnyAction,
	path: string,
	fields: Record<string, string>,
	cookie?: string,
) {
	const url = new URL(path, BASE_URL)
	const args = {
		request: new Request(url, {
			method: 'POST',
			headers: cookie ? { cookie } : {},
			body: new URLSearchParams(fields),
		}),
		url,
		params: {},
		pattern: path,
		context: new RouterContextProvider(),
	}
	return (await action(args as never)) as unknown
}

/** Asks for a reset, and waits for the email it sends after answering. */
async function forgotPassword(usernameOrEmail: string) {
	const answer = await callAction(forgotPasswordAction, '/forgot-password', {
		usernameOrEmail,
	})
	await backgroundWorkSettled()
	return answer
}

async function signup(email: string) {
	return (await callAction(signupAction, '/signup', { email })) as Response
}

/** The parts of an action's answer a visitor can see. */
function visible(result: unknown) {
	if (result instanceof Response) {
		return {
			status: result.status,
			location: result.headers.get('location'),
			setCookies: result.headers.getSetCookie(),
		}
	}
	const { data, init } = result as {
		data: unknown
		init?: { status?: number; headers?: HeadersInit }
	}
	return {
		status: init?.status ?? 200,
		body: data,
		setCookies: new Headers(init?.headers).getSetCookie(),
	}
}

async function toastFrom(setCookies: string[]) {
	const cookie = setCookies.find((c) => c.startsWith('en_toast='))
	if (!cookie) return null
	const session = await toastSessionStorage.getSession(cookie.split(';')[0])
	return session.get(toastKey) as { title?: string; description: string }
}

async function createAccount() {
	return prisma.user.create({
		data: createUser(),
		select: { id: true, username: true, email: true },
	})
}

function cookiePair(setCookie: string) {
	return setCookie.split(';')[0]!
}

// Replaces cookies in `cookie` with any the response set, as a browser would.
function applySetCookies(cookie: string, setCookies: string[]) {
	const jar = new Map(
		cookie
			.split('; ')
			.filter(Boolean)
			.map((pair) => [pair.split('=')[0]!, pair] as const),
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
	setCookies: string[]
	errors: unknown
}

async function submitVerify(
	fields: Record<string, string | null | undefined>,
	{ cookie = '', address = '203.0.113.7' } = {},
): Promise<Outcome> {
	const body = new FormData()
	for (const [key, value] of Object.entries(fields)) {
		if (value != null) body.set(key, value)
	}
	const request = new Request(`${BASE_URL}/verify`, {
		method: 'POST',
		headers: { cookie, 'x-forwarded-for': address },
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
			errors: null,
		}
	}
	const { data, init } = result as {
		data: { result: { error?: unknown } }
		init?: { status?: number }
	}
	return {
		status: init?.status ?? 200,
		location: null,
		setCookies: [],
		errors: data.result.error,
	}
}

type Emailed = ReturnType<typeof readCode>

/** Submits the typed code from an email. */
function useCode(emailed: Emailed, overrides: Record<string, string> = {}) {
	return submitVerify({
		code: emailed.code,
		type: emailed.type,
		target: emailed.target,
		...overrides,
	})
}

/** Submits the token from an email's link, as the verify page does. */
function useLink(emailed: Emailed, overrides: Record<string, string> = {}) {
	return submitVerify({
		token: emailed.token,
		type: emailed.type,
		target: emailed.target,
		...overrides,
	})
}

const RESET_DONE = '/reset-password'

describe('someone asking for codes for another person', () => {
	test('repeated reset requests leave the first code and its link working', async () => {
		const sent = captureEmails()
		const user = await createAccount()
		for (let i = 0; i < 4; i++) {
			await forgotPassword(i % 2 ? user.email : user.username)
		}
		expect(sent).toHaveLength(4)

		const first = readCode(sent[0])
		expect((await useLink(first)).location).toBe(RESET_DONE)

		const user2 = await createAccount()
		const sent2 = captureEmails()
		await forgotPassword(user2.username)
		await forgotPassword(user2.email)
		await forgotPassword(user2.username.toUpperCase())
		expect((await useCode(readCode(sent2[0]))).location).toBe(RESET_DONE)
	})

	test('past the cap, nothing is sent, the answer is the same, and the earliest code works', async () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		const sent = captureEmails()
		const user = await createAccount()
		const answers = []
		for (let i = 0; i < CAP + 1; i++) {
			answers.push(visible(await forgotPassword(user.email)))
		}
		expect(sent).toHaveLength(CAP)
		expect(answers[CAP]).toEqual(answers[0])

		vi.setSystemTime(Date.now() + CODE_LIFETIME_MS + 1000)
		await forgotPassword(user.email)
		expect(sent).toHaveLength(CAP + 1)
		expect((await useCode(readCode(sent[CAP]))).location).toBe(RESET_DONE)
	})

	test('the earliest code still works once the cap is reached', async () => {
		const sent = captureEmails()
		const user = await createAccount()
		for (let i = 0; i < CAP + 2; i++) await forgotPassword(user.username)
		expect(sent).toHaveLength(CAP)
		expect((await useCode(readCode(sent[0]))).location).toBe(RESET_DONE)
	})

	test('requests sent all at once stop at the cap, and each one ends as sent or capped', async () => {
		const sent = captureEmails()
		const user = await createAccount()
		// prepareVerification directly: forgot-password hides any error.
		const outcomes = await Promise.allSettled(
			Array.from({ length: CAP + 4 }, () =>
				prepareVerification({
					type: 'reset-password',
					target: user.id,
					send: async ({ otp }) => {
						sent.push({ to: user.email, text: otp })
						return { status: 'success' as const }
					},
				}),
			),
		)
		const statuses = outcomes.map((outcome) =>
			outcome.status === 'fulfilled' ? outcome.value.status : 'threw',
		)
		expect(statuses.filter((status) => status === 'sent')).toHaveLength(CAP)
		expect(statuses.filter((status) => status === 'capped')).toHaveLength(4)
		expect(sent).toHaveLength(CAP)
		expect(
			await prisma.emailCode.count({ where: { type: 'reset-password' } }),
		).toBe(CAP)
	})

	test('wrong codes from many addresses leave the owner’s code working', async () => {
		const sent = captureEmails()
		const user = await createAccount()
		await forgotPassword(user.email)
		const emailed = readCode(sent[0])
		for (let address = 1; address <= 10; address++) {
			for (let i = 0; i < 5; i++) {
				const wrong = await submitVerify(
					{ code: 'ABCDEFGH', type: emailed.type, target: emailed.target },
					{ address: `198.51.100.${address}` },
				)
				expect(wrong.status).toBe(400)
			}
		}
		expect((await useCode(emailed)).location).toBe(RESET_DONE)
	})

	test('a reset for an unknown account answers the same, stores nothing and sends nothing', async () => {
		const sent = captureEmails()
		const user = await createAccount()
		const known = visible(await forgotPassword(user.username))
		const unknown = visible(await forgotPassword('nobody_here_at_all'))
		const unknownEmail = visible(await forgotPassword('nobody@example.com'))
		expect(unknown).toEqual({
			...known,
			body: { ...(known.body as object), result: expect.anything() },
		})
		expect(unknownEmail.status).toBe(known.status)
		expect(sent).toHaveLength(1)
		expect(await prisma.emailCode.count()).toBe(1)
	})
})

describe('forgot-password answers before it sends', () => {
	test('a known account is answered while its email is still going out, and the code then works', async () => {
		let release!: () => void
		const held = new Promise<void>((resolve) => (release = resolve))
		const sent = captureEmails(() => held)
		const user = await createAccount()

		const answer = visible(
			await callAction(forgotPasswordAction, '/forgot-password', {
				usernameOrEmail: user.username,
			}),
		)

		expect(answer.status).toBe(200)
		expect(sent).toHaveLength(0)
		release()
		await backgroundWorkSettled()
		expect(sent).toHaveLength(1)
		expect((await useCode(readCode(sent[0]))).location).toBe(RESET_DONE)
	})

	test('a send that fails after the answer leaves no code, and is logged', async () => {
		failEmails()
		const user = await createAccount()

		const answer = visible(await forgotPassword(user.username))

		expect(answer.status).toBe(200)
		expect(await prisma.emailCode.count({ where: { target: user.id } })).toBe(0)
		expect(consoleError).toHaveBeenCalled()
	})

	test('work that throws after the answer is logged, not left unhandled', async () => {
		consoleError.mockImplementation(() => {})
		const unhandled: Array<unknown> = []
		const onUnhandled = (reason: unknown) => unhandled.push(reason)
		process.on('unhandledRejection', onUnhandled)
		try {
			const user = await createAccount()
			vi.spyOn(prisma.user, 'findUnique').mockRejectedValueOnce(
				new Error('The database went away'),
			)

			const answer = visible(
				await callAction(forgotPasswordAction, '/forgot-password', {
					usernameOrEmail: user.username,
				}),
			)
			await backgroundWorkSettled()
			// An unhandled rejection is reported after the current tasks.
			await new Promise((resolve) => setTimeout(resolve, 0))

			expect(answer.status).toBe(200)
			expect(unhandled).toEqual([])
			expect(consoleError).toHaveBeenCalledWith(
				'Background task failed: sending a password reset code',
				expect.objectContaining({ message: 'The database went away' }),
			)
		} finally {
			process.off('unhandledRejection', onUnhandled)
			vi.restoreAllMocks()
		}
	})
})

describe('reset by username and by email', () => {
	test('both forms share one cap, and both codes work', async () => {
		const sent = captureEmails()
		const user = await createAccount()
		await forgotPassword(user.username)
		await forgotPassword(user.email)
		const [byUsername, byEmail] = [readCode(sent[0]), readCode(sent[1])]
		expect(byUsername.target).toBe(byEmail.target)

		for (let i = 0; i < CAP; i++) await forgotPassword(user.email.toUpperCase())
		expect(sent).toHaveLength(CAP)

		// The verify step finds the account the same way, whichever form it
		// is given.
		expect(
			(await useCode(byEmail, { target: user.username.toUpperCase() }))
				.location,
		).toBe(RESET_DONE)
	})

	test('a stale code for the other form still checks against the account', async () => {
		const sent = captureEmails()
		const user = await createAccount()
		await forgotPassword(user.email)
		await forgotPassword(user.username)
		expect(
			(await useCode(readCode(sent[0]), { target: user.email })).location,
		).toBe(RESET_DONE)
	})
})

describe('using codes', () => {
	test('the same code submitted twice at once succeeds once', async () => {
		const sent = captureEmails()
		const user = await createAccount()
		await forgotPassword(user.username)
		const emailed = readCode(sent[0])
		const outcomes = await Promise.all([useCode(emailed), useCode(emailed)])
		expect(outcomes.map((o) => o.status).sort()).toEqual([302, 400])
	})

	test('a used code stops working, and so do the target’s other codes', async () => {
		const sent = captureEmails()
		const user = await createAccount()
		await forgotPassword(user.username)
		await forgotPassword(user.username)
		const [first, second] = [readCode(sent[0]), readCode(sent[1])]

		expect((await useCode(second)).location).toBe(RESET_DONE)
		expect((await useCode(second)).status).toBe(400)
		expect((await useCode(first)).status).toBe(400)
		expect((await useLink(first)).status).toBe(400)
		expect(await prisma.emailCode.count()).toBe(0)
	})

	test('a code past its 10 minutes fails', async () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		const sent = captureEmails()
		const user = await createAccount()
		await forgotPassword(user.username)
		vi.setSystemTime(Date.now() + CODE_LIFETIME_MS + 1000)
		const outcome = await useCode(readCode(sent[0]))
		expect(outcome.status).toBe(400)
	})

	test('a code typed in lowercase works', async () => {
		const sent = captureEmails()
		const user = await createAccount()
		await forgotPassword(user.username)
		const emailed = readCode(sent[0])
		expect(
			(await useCode(emailed, { code: emailed.code.toLowerCase() })).location,
		).toBe(RESET_DONE)
	})

	test('the link works without the typed code, and only for its own target', async () => {
		const sent = captureEmails()
		const owner = await createAccount()
		const other = await createAccount()
		await forgotPassword(owner.username)
		await forgotPassword(other.username)
		const [ownerCode, otherCode] = [readCode(sent[0]), readCode(sent[1])]

		expect(ownerCode.token).toMatch(/^[\w-]{43}$/)
		expect(ownerCode.link.searchParams.get('code')).toBeNull()
		expect(
			(await useLink(ownerCode, { target: otherCode.target })).status,
		).toBe(400)
		expect((await useLink(ownerCode)).location).toBe(RESET_DONE)
	})

	test('a code fails for another target and as another kind of code', async () => {
		const sent = captureEmails()
		const owner = await createAccount()
		const other = await createAccount()
		await forgotPassword(owner.username)
		await forgotPassword(other.username)
		const resetCode = readCode(sent[0])

		const email = `kind-${Date.now()}@example.com`
		await signup(email)
		const signupCode = readCode(sent[2])

		expect((await useCode(resetCode, { target: other.id })).status).toBe(400)
		expect(
			(await useCode(resetCode, { type: 'onboarding', target: email })).status,
		).toBe(400)
		expect(
			(
				await useCode(signupCode, {
					type: 'reset-password',
					target: resetCode.target,
				})
			).status,
		).toBe(400)
		expect((await useCode(resetCode)).location).toBe(RESET_DONE)
		expect((await useCode(signupCode)).location).toBe('/onboarding')
	})

	test('codes are eight characters, and neither the code nor the token is stored', async () => {
		const sent = captureEmails()
		const user = await createAccount()
		await forgotPassword(user.username)
		const emailed = readCode(sent[0])
		expect(emailed.code).toMatch(/^[A-HJ-NP-Z1-9]{8}$/)
		const rows = await prisma.emailCode.findMany()
		const stored = JSON.stringify(rows)
		expect(stored).not.toContain(emailed.code)
		expect(stored).not.toContain(emailed.token)
		// Without the server's secret, a stored hash can't be checked against
		// guesses.
		const sha256 = (value: string) =>
			createHash('sha256').update(value).digest('hex')
		expect(rows[0]!.codeHash).not.toBe(sha256(emailed.code))
		expect(rows[0]!.linkTokenHash).not.toBe(sha256(emailed.token!))
	})

	test('a stored code checks only with the secret it was stored under', async () => {
		const sent = captureEmails()
		const user = await createAccount()
		await forgotPassword(user.username)
		const emailed = readCode(sent[0])
		vi.stubEnv('SESSION_SECRET', 'a-different-secret')
		try {
			expect((await useCode(emailed)).status).toBe(400)
		} finally {
			vi.unstubAllEnvs()
		}
		expect((await useCode(emailed)).location).toBe(RESET_DONE)
	})

	test('a code can’t be used while its email is still going out', async () => {
		const email = `in-flight-${Date.now()}@example.com`
		let duringSend: Outcome | undefined
		const sent = captureEmails(async (body) => {
			const emailed = readCode(body)
			duringSend = await useCode(emailed)
		})
		await signup(email)
		expect(duringSend?.status).toBe(400)
		expect((await useCode(readCode(sent[0]))).location).toBe('/onboarding')
	})
})

describe('code kinds', () => {
	async function userWithTwoFA() {
		const user = await createAccount()
		const { otp: _otp, ...totpConfig } = await generateTOTP()
		await prisma.verification.create({
			data: { ...totpConfig, type: twoFAVerificationType, target: user.id },
		})
		return { ...user, totp: async () => (await generateTOTP(totpConfig)).otp }
	}

	test('an emailed code fails as a 2FA code', async () => {
		const sent = captureEmails()
		const user = await userWithTwoFA()
		await forgotPassword(user.username)
		const emailed = readCode(sent[0])
		expect((await useCode(emailed, { type: '2fa' })).status).toBe(400)
		expect(
			await isCodeValid({
				code: emailed.code,
				type: 'reset-password' as never,
				target: emailed.target,
			}),
		).toBe(false)
		expect((await useCode(emailed)).location).toBe(RESET_DONE)
	})

	test('an authenticator code fails as an emailed code', async () => {
		const user = await userWithTwoFA()
		const totp = await user.totp()
		for (const type of ['reset-password', 'change-email', 'onboarding']) {
			const outcome = await submitVerify({ code: totp, type, target: user.id })
			expect(outcome.status).toBe(400)
		}
		expect(
			await checkEmailCode({
				type: twoFAVerificationType as never,
				target: user.id,
				code: totp,
			}),
		).toBeNull()
		expect(
			await isCodeValid({ code: totp, type: '2fa', target: user.id }),
		).toBe(true)
	})
})

describe('code kinds, with a stored code of the other kind', () => {
	// These rows can't arise from the app; they check that each kind of code
	// goes only through its own check even if one did.
	test('an emailed type never reaches the authenticator check', async () => {
		const email = `totp-${Date.now()}@example.com`
		const { otp, ...totpConfig } = await generateTOTP()
		await prisma.verification.create({
			data: { ...totpConfig, type: 'onboarding', target: email },
		})
		expect(
			await isCodeValid({
				code: otp,
				type: 'onboarding' as never,
				target: email,
			}),
		).toBe(false)
	})

	test('a 2FA type never reaches the emailed codes', async () => {
		const user = await createAccount()
		const code = '123456'
		await prisma.emailCode.create({
			data: {
				type: twoFAVerificationType,
				target: user.id,
				codeHash: emailCodeDigest(code),
				linkTokenHash: 'unused',
				sentAt: new Date(),
				expiresAt: new Date(Date.now() + CODE_LIFETIME_MS),
			},
		})
		const outcome = await submitVerify({
			code,
			type: twoFAVerificationType,
			target: user.id,
		})
		expect(outcome.status).toBe(400)
		expect(
			await checkEmailCode({
				type: twoFAVerificationType as never,
				target: user.id,
				code,
			}),
		).toBeNull()
	})
})

describe('sending', () => {
	test('a failed send stores nothing and leaves earlier codes working', async () => {
		const sent = captureEmails()
		const email = `send-fails-${Date.now()}@example.com`
		await signup(email)
		failEmails()
		const failed = visible(await signup(email))
		expect(failed.status).toBe(500)
		expect(await prisma.emailCode.count()).toBe(1)
		expect((await useCode(readCode(sent[0]))).location).toBe('/onboarding')
	})

	test('a code that can’t be marked as sent is reported as a failed send and holds no place', async () => {
		const sent = captureEmails()
		const email = `mark-fails-${Date.now()}@example.com`
		await signup(email)
		consoleError.mockImplementation(() => {})
		// Marking the code as sent, after its email has gone out, fails.
		const spy = vi
			.spyOn(prisma.emailCode, 'updateMany')
			.mockRejectedValueOnce(new Error('database is locked'))
		try {
			const failed = visible(await signup(email))
			expect(failed.status).toBe(500)
		} finally {
			spy.mockRestore()
		}
		expect(sent).toHaveLength(2)
		expect(await prisma.emailCode.count()).toBe(1)
		expect((await useCode(readCode(sent[0]))).location).toBe('/onboarding')
	})

	test('a mixed-case signup address is stored as the account will store it', async () => {
		const sent = captureEmails()
		const email = `Mixed-${Date.now()}@Example.com`
		await signup(email)
		const emailed = readCode(sent[0])
		expect(emailed.target).toBe(email.toLowerCase())
		const outcome = await useCode(emailed, { target: email })
		expect(outcome.location).toBe('/onboarding')
		const verifySession = await verifySessionStorage.getSession(
			outcome.setCookies.map(cookiePair).join('; '),
		)
		expect(verifySession.get(onboardingEmailSessionKey)).toBe(
			email.toLowerCase(),
		)
	})
})

describe('email change', () => {
	async function signedIn() {
		const session = await prisma.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: { create: createUser() },
			},
			select: { id: true, userId: true, expirationDate: true },
		})
		return {
			userId: session.userId,
			cookie: await getSessionCookieHeader(session),
		}
	}

	async function requestChange(cookie: string, email: string) {
		const result = await callAction(
			changeEmailAction,
			'/settings/profile/change-email',
			{ email },
			cookie,
		)
		const outcome = visible(result)
		return { outcome, cookie: applySetCookies(cookie, outcome.setCookies) }
	}

	function submitWithCookie(emailed: Emailed, cookie: string) {
		return submitVerify(
			{ code: emailed.code, type: emailed.type, target: emailed.target },
			{ cookie },
		)
	}

	async function emailOf(userId: string) {
		return (
			await prisma.user.findUniqueOrThrow({
				where: { id: userId },
				select: { email: true },
			})
		).email
	}

	test('a code sent to one address can’t set another', async () => {
		const sent = captureEmails()
		const { userId, cookie: signedInCookie } = await signedIn()
		const a = `a-${Date.now()}@example.com`
		const b = `b-${Date.now()}@example.com`
		let cookie = (await requestChange(signedInCookie, a)).cookie
		cookie = (await requestChange(cookie, b)).cookie
		const toA = readCode(sent.find((e) => e.to === a))

		const outcome = await submitWithCookie(toA, cookie)
		expect(outcome.location).toBe('/settings/profile')
		expect(await emailOf(userId)).toBe(a)
	})

	test('a code submitted without the requesting device’s cookie fails', async () => {
		const sent = captureEmails()
		const { userId, cookie } = await signedIn()
		const before = await emailOf(userId)
		await requestChange(cookie, `c-${Date.now()}@example.com`)
		const outcome = await submitWithCookie(readCode(sent[0]), cookie)
		expect(outcome.status).toBe(400)
		expect(await emailOf(userId)).toBe(before)
		expect(await prisma.emailCode.count()).toBe(1)
	})

	test('a code asked for on one device can’t be used on another', async () => {
		const sent = captureEmails()
		const { userId, cookie: device1 } = await signedIn()
		const device2 = await getSessionCookieHeader(
			await prisma.session.create({
				data: { expirationDate: getSessionExpirationDate(), userId },
				select: { id: true, expirationDate: true },
			}),
		)
		const before = await emailOf(userId)
		const a = `device-a-${Date.now()}@example.com`
		const b = `device-b-${Date.now()}@example.com`
		const onDevice1 = (await requestChange(device1, a)).cookie
		await requestChange(device2, b)

		const toB = readCode(sent.find((e) => e.to === b))
		const outcome = await submitWithCookie(toB, onDevice1)
		expect(outcome.status).toBe(400)
		expect(await emailOf(userId)).toBe(before)
	})

	test('past the cap it says no new email went out, and earlier codes still work', async () => {
		const sent = captureEmails()
		const { userId, cookie: signedInCookie } = await signedIn()
		let cookie = signedInCookie
		const addresses = Array.from(
			{ length: CAP + 1 },
			(_, i) => `cap-${i}-${Date.now()}@example.com`,
		)
		const outcomes = []
		for (const address of addresses) {
			const requested = await requestChange(cookie, address)
			outcomes.push(requested.outcome)
			cookie = requested.cookie
		}
		expect(sent).toHaveLength(CAP)

		const past = outcomes[CAP]!
		expect(past.status).toBe(302)
		expect(past.setCookies.some((c) => c.startsWith('en_verification='))).toBe(
			false,
		)
		const toast = await toastFrom(past.setCookies)
		expect(toast?.title).toMatch(/no new email/i)
		expect(toast?.description).toMatch(/still work/i)
		expect(await toastFrom(outcomes[0]!.setCookies)).toBeNull()

		const outcome = await submitWithCookie(readCode(sent[0]), cookie)
		expect(outcome.location).toBe('/settings/profile')
		expect(await emailOf(userId)).toBe(addresses[0])
	})
})

describe('signup past the cap', () => {
	test('it says no new email went out, and earlier codes still work', async () => {
		const sent = captureEmails()
		const email = `signup-cap-${Date.now()}@example.com`
		const outcomes = []
		for (let i = 0; i < CAP + 1; i++)
			outcomes.push(visible(await signup(email)))
		expect(sent).toHaveLength(CAP)
		expect(outcomes[CAP]!.location).toBe(outcomes[0]!.location)
		expect(await toastFrom(outcomes[0]!.setCookies)).toBeNull()
		const toast = await toastFrom(outcomes[CAP]!.setCookies)
		expect(toast?.title).toMatch(/no new email/i)
		expect(toast?.description).toMatch(/still work/i)
		expect((await useCode(readCode(sent[0]))).location).toBe('/onboarding')
	})
})

test('the link token is redacted from logged URLs, also inside redirectTo', () => {
	const link = '/verify?type=change-email&target=u1&token=secret-token-value'
	expect(redactUrl(link)).not.toContain('secret-token-value')
	const bounce = `/verify?type=2fa&target=u1&redirectTo=${encodeURIComponent(link)}`
	expect(redactUrl(bounce)).not.toContain('secret-token-value')
})

describe('a new password or email ends reset codes', () => {
	async function signedInWithPassword(password?: string) {
		const session = await prisma.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: {
					create: {
						...createUser(),
						...(password
							? { password: { create: createPassword(password) } }
							: {}),
					},
				},
			},
			select: {
				id: true,
				expirationDate: true,
				user: { select: { id: true, email: true, username: true } },
			},
		})
		return { user: session.user, cookie: await getSessionCookieHeader(session) }
	}

	test('a reset code sent to the old address stops working once the email changes', async () => {
		const sent = captureEmails()
		const { user, cookie: signedInCookie } = await signedInWithPassword()
		await forgotPassword(user.email)
		const resetCode = readCode(sent[0])

		const address = `moved-${Date.now()}@example.com`
		const requested = visible(
			await callAction(
				changeEmailAction,
				'/settings/profile/change-email',
				{ email: address },
				signedInCookie,
			),
		)
		const cookie = applySetCookies(signedInCookie, requested.setCookies)
		const changeCode = readCode(sent.find((e) => e.to === address))
		const changed = await submitVerify(
			{
				code: changeCode.code,
				type: changeCode.type,
				target: changeCode.target,
			},
			{ cookie },
		)
		expect(changed.location).toBe('/settings/profile')

		expect((await useCode(resetCode)).status).toBe(400)
	})

	test('changing the password in Settings ends reset codes', async () => {
		const sent = captureEmails()
		const { user, cookie } = await signedInWithPassword('old-password-1')
		await forgotPassword(user.username)
		const newPassword = `new-${Date.now()}-password`
		const result = visible(
			await callAction(
				changePasswordAction,
				'/settings/profile/password',
				{
					currentPassword: 'old-password-1',
					newPassword,
					confirmNewPassword: newPassword,
				},
				cookie,
			),
		)
		expect(result.status).toBe(302)
		expect((await useCode(readCode(sent[0]))).status).toBe(400)
	})

	test('creating a first password ends reset codes', async () => {
		const sent = captureEmails()
		const { user, cookie } = await signedInWithPassword()
		await forgotPassword(user.username)
		const password = `first-${Date.now()}-password`
		const result = visible(
			await callAction(
				createPasswordAction,
				'/settings/profile/password/create',
				{ password, confirmPassword: password },
				cookie,
			),
		)
		expect(result.status).toBe(302)
		expect((await useCode(readCode(sent[0]))).status).toBe(400)
	})

	test('the reset itself ends codes asked for after the verify step', async () => {
		const sent = captureEmails()
		const user = await createAccount()
		await forgotPassword(user.username)
		expect((await useCode(readCode(sent[0]))).location).toBe(RESET_DONE)
		await forgotPassword(user.email)

		await resetUserPassword({
			username: user.username,
			password: `reset-${Date.now()}-password`,
		})
		expect((await useCode(readCode(sent[1]))).status).toBe(400)
	})
})
