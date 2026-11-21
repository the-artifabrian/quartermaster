import bcrypt from 'bcryptjs'
import { RouterContextProvider } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { action as addPasskeyAction } from '#app/routes/_auth/webauthn/registration.ts'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { SIGNED_IN_PASSWORD_LIMIT } from '#app/utils/signed-in-password.server.ts'
import { createPassword, createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './password.tsx'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

// Failure list for changing a password from Settings:
// 1. The user is signed in on two other devices. Both of those sessions end;
//    the session that made the change stays.
// 2. Another user's sessions are untouched.
// 3. A change refused for a wrong current password ends no session.
// 4. Ten wrong current passwords, then the right one. The change is refused
//    with a message saying why, bcrypt doesn't run for it, and the stored
//    password stays as it was.
// 5. Wrong passwords typed here and in the add-passkey step are counted
//    apart, so each form gets its own ten.

const oldPassword = 'old-password-1234'
const newPassword = 'new-password-5678'

async function setUp() {
	const user = await prisma.user.create({
		data: {
			...createUser(),
			password: { create: createPassword(oldPassword) },
		},
		select: { id: true },
	})
	const otherUser = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})
	const sessionFor = (userId: string) =>
		prisma.session.create({
			data: { expirationDate: getSessionExpirationDate(), userId },
			select: { id: true },
		})
	return {
		user,
		current: await sessionFor(user.id),
		otherDevice: await sessionFor(user.id),
		thirdDevice: await sessionFor(user.id),
		otherUsersSession: await sessionFor(otherUser.id),
	}
}

async function changePassword(
	session: { id: string },
	currentPassword: string,
) {
	const body = new FormData()
	body.set('currentPassword', currentPassword)
	body.set('newPassword', newPassword)
	body.set('confirmNewPassword', newPassword)
	const url = `${BASE_URL}/settings/profile/password`
	const request = new Request(url, {
		method: 'POST',
		headers: { cookie: await getSessionCookieHeader(session) },
		body,
	})
	return action({
		request,
		url: new URL(url),
		params: {},
		pattern: '/settings/profile/password',
		context: new RouterContextProvider(),
	})
}

async function remainingSessionIds(where: { userId?: string } = {}) {
	const sessions = await prisma.session.findMany({
		where,
		select: { id: true },
	})
	return sessions.map((s) => s.id).sort()
}

test('changing the password ends the user’s other sessions and keeps this one', async () => {
	const { user, current } = await setUp()

	const response = await changePassword(current, oldPassword)

	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(302)
	expect(await remainingSessionIds({ userId: user.id })).toEqual([current.id])
})

test('changing the password leaves another user’s sessions alone', async () => {
	const { current, otherUsersSession } = await setUp()

	await changePassword(current, oldPassword)

	expect(
		await prisma.session.findUnique({
			where: { id: otherUsersSession.id },
			select: { id: true },
		}),
	).toEqual({ id: otherUsersSession.id })
})

test('a refused password change ends no session', async () => {
	const { current, otherDevice, thirdDevice, otherUsersSession } = await setUp()

	await changePassword(current, 'not-the-password')

	expect(await remainingSessionIds()).toEqual(
		[current.id, otherDevice.id, thirdDevice.id, otherUsersSession.id].sort(),
	)
})

afterEach(() => {
	vi.restoreAllMocks()
})

async function storedHash(userId: string) {
	const row = await prisma.password.findUniqueOrThrow({
		where: { userId },
		select: { hash: true },
	})
	return row.hash
}

function currentPasswordErrors(response: Awaited<ReturnType<typeof action>>) {
	expect(response).not.toBeInstanceOf(Response)
	const { data, init } = response as {
		data: { result: { error?: Record<string, string[] | null> } }
		init: ResponseInit | null
	}
	expect(init?.status).toBe(400)
	return data.result.error?.currentPassword
}

test('after ten wrong current passwords the right one is refused and the password stays', async () => {
	const { user, current } = await setUp()
	const hashBefore = await storedHash(user.id)
	for (let i = 0; i < SIGNED_IN_PASSWORD_LIMIT; i++) {
		expect(
			currentPasswordErrors(await changePassword(current, `wrong-${i}`)),
		).toEqual(['Incorrect password.'])
	}
	const compare = vi.spyOn(bcrypt, 'compare')

	const response = await changePassword(current, oldPassword)

	expect(currentPasswordErrors(response)).toEqual([
		'Too many wrong passwords. Try again in an hour.',
	])
	expect(compare).not.toHaveBeenCalled()
	expect(await storedHash(user.id)).toBe(hashBefore)
})

test('wrong passwords here and in the add-passkey step count toward one limit', async () => {
	const { user, current } = await setUp()
	const hashBefore = await storedHash(user.id)
	const half = SIGNED_IN_PASSWORD_LIMIT / 2
	for (let i = 0; i < half; i++) {
		await changePassword(current, `wrong-${i}`)
	}
	const url = `${BASE_URL}/webauthn/registration`
	for (let i = 0; i < SIGNED_IN_PASSWORD_LIMIT - half; i++) {
		const response = await addPasskeyAction({
			request: new Request(url, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					cookie: await getSessionCookieHeader(current),
				},
				body: JSON.stringify({ intent: 'options', password: `nope-${i}` }),
			}),
			url: new URL(url),
			params: {},
			pattern: '/webauthn/registration',
			context: new RouterContextProvider(),
		})
		expect(response.status).toBe(400)
	}

	expect(
		currentPasswordErrors(await changePassword(current, oldPassword)),
	).toEqual(['Too many wrong passwords. Try again in an hour.'])
	expect(await storedHash(user.id)).toBe(hashBefore)
})
