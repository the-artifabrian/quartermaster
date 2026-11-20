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
// 1. The user is signed in on two other devices. Both of those sessions end;
//    the session that made the change stays.
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
