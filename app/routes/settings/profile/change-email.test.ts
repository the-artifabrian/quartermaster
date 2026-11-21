import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { generateTOTP } from '#app/utils/totp.server.ts'
import { createPassword, createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './change-email.tsx'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

// Failure list for asking to change the email from Settings, which now needs
// the current password:
// 1. A wrong password sends nothing and stores no code, and the answer
//    points at the password field without sending the password back.
// 2. No password in the form: refused, nothing sent.
// 3. An account with no password (it signed up with Google) is refused on
//    the server, whatever the form holds.
// 4. A wrong password with an address another account already uses: the
//    answer is about the password only, so it doesn't say the address is
//    taken.
// 5. The right password sends the code to the new address.
// 6. With 2FA on and the last check over two hours old, the request goes to
//    reverify before the password is looked at.

const password = 'current-password-1234'

async function signedIn({ withPassword = true, twoFA = false } = {}) {
	const user = await prisma.user.create({
		data: {
			...createUser(),
			...(withPassword
				? { password: { create: createPassword(password) } }
				: {}),
		},
		select: { id: true },
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

async function requestChange(cookie: string, fields: Record<string, string>) {
	const url = `${BASE_URL}/settings/profile/change-email`
	const request = new Request(url, {
		method: 'POST',
		headers: { cookie },
		body: new URLSearchParams(fields),
	})
	const result: unknown = await action({
		request,
		url: new URL(url),
		params: {},
		pattern: '/settings/profile/change-email',
		context: new RouterContextProvider(),
	}).catch((thrown: unknown) => thrown)
	if (result instanceof Response) {
		return {
			location: result.headers.get('location'),
			errors: null,
			payload: null,
		}
	}
	const { data } = result as {
		data: {
			result: { error?: Record<string, string[]>; initialValue?: unknown }
		}
	}
	return {
		location: null,
		errors: data.result.error ?? null,
		payload: data.result.initialValue ?? null,
	}
}

const newAddress = () =>
	`new-${Math.random().toString(36).slice(2)}@example.com`

function codesFor(userId: string) {
	return prisma.emailCode.count({
		where: { target: userId, type: 'change-email' },
	})
}

test('a wrong password sends nothing and isn’t sent back', async () => {
	const { user, cookie } = await signedIn()

	const outcome = await requestChange(cookie, {
		email: newAddress(),
		password: 'not-the-password',
	})

	expect(outcome.location).toBeNull()
	expect(outcome.errors).toEqual({ password: ['Incorrect password.'] })
	expect(JSON.stringify(outcome.payload ?? {})).not.toContain(
		'not-the-password',
	)
	expect(await codesFor(user.id)).toBe(0)
})

test('a request without the password sends nothing', async () => {
	const { user, cookie } = await signedIn()

	const outcome = await requestChange(cookie, { email: newAddress() })

	expect(outcome.location).toBeNull()
	expect(outcome.errors).toHaveProperty('password')
	expect(await codesFor(user.id)).toBe(0)
})

test('an account with no password is refused', async () => {
	const { user, cookie } = await signedIn({ withPassword: false })

	const outcome = await requestChange(cookie, {
		email: newAddress(),
		password: 'anything-at-all',
	})

	expect(outcome.location).toBeNull()
	expect(outcome.errors).not.toBeNull()
	expect(await codesFor(user.id)).toBe(0)
})

test('a wrong password with a taken address only mentions the password', async () => {
	const { cookie } = await signedIn()
	const taken = await prisma.user.create({
		data: createUser(),
		select: { email: true },
	})

	const outcome = await requestChange(cookie, {
		email: taken.email,
		password: 'not-the-password',
	})

	expect(outcome.errors).toEqual({ password: ['Incorrect password.'] })
})

test('the right password sends the code', async () => {
	const { user, cookie } = await signedIn()

	const outcome = await requestChange(cookie, {
		email: newAddress(),
		password,
	})

	expect(outcome.location).toMatch(/^\/verify\?/)
	expect(await codesFor(user.id)).toBe(1)
})

test('a stale 2FA check goes to reverify first', async () => {
	const { user, cookie } = await signedIn({ twoFA: true })

	const outcome = await requestChange(cookie, {
		email: newAddress(),
		password: 'not-the-password',
	})

	expect(outcome.location).toMatch(/^\/verify\?.*type=2fa/)
	expect(await codesFor(user.id)).toBe(0)
})
