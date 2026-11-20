import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createPassword, createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './password.tsx'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

// Failure list for changing a password from Settings:
// 1. The user has other sessions, including one still waiting on its 2FA
//    code. All of them end; the session that made the change stays.
// 2. Another user's sessions are untouched.
// 3. A change refused for a wrong current password ends no session.

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
		pendingTwoFA: await sessionFor(user.id),
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

async function remainingSessionIds() {
	const sessions = await prisma.session.findMany({ select: { id: true } })
	return sessions.map((s) => s.id).sort()
}

test('changing the password ends the user’s other sessions and keeps this one', async () => {
	const { current, otherUsersSession } = await setUp()

	const response = await changePassword(current, oldPassword)

	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(302)
	expect(await remainingSessionIds()).toEqual(
		[current.id, otherUsersSession.id].sort(),
	)
})

test('a refused password change ends no session', async () => {
	const { current, otherDevice, pendingTwoFA, otherUsersSession } =
		await setUp()

	await changePassword(current, 'not-the-password')

	expect(await remainingSessionIds()).toEqual(
		[current.id, otherDevice.id, pendingTwoFA.id, otherUsersSession.id].sort(),
	)
})
