import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { toastKey, toastSessionStorage } from '#app/utils/toast.server.ts'
import { createPassword, createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action, loader } from './password.tsx'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

// Changing a password from Settings. An account with no password can't set one
// here without proof, so Settings sends it to Forgot password, which emails a
// code first.

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

async function toastFrom(response: Response) {
	const cookie = response.headers
		.getSetCookie()
		.find((c) => c.startsWith('en_toast='))
	if (!cookie) return null
	const session = await toastSessionStorage.getSession(cookie.split(';')[0])
	return session.get(toastKey) as { description: string } | undefined
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

test('an account with no password is sent to Forgot password', async () => {
	const user = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})
	const session = await prisma.session.create({
		data: { expirationDate: getSessionExpirationDate(), userId: user.id },
		select: { id: true },
	})
	const url = `${BASE_URL}/settings/profile/password`
	const args = (request: Request) => ({
		request,
		url: new URL(url),
		params: {},
		pattern: '/settings/profile/password',
		context: new RouterContextProvider(),
	})
	const cookie = await getSessionCookieHeader(session)

	const opened: unknown = await loader(
		args(new Request(url, { headers: { cookie } })),
	).catch((thrown: unknown) => thrown)
	const submitted: unknown = await changePassword(session, 'anything').catch(
		(thrown: unknown) => thrown,
	)

	for (const response of [opened, submitted]) {
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).headers.get('location')).toBe(
			'/forgot-password',
		)
		expect(await toastFrom(response as Response)).toMatchObject({
			description: expect.stringMatching(/doesn’t have a password/),
		})
	}
	expect(await prisma.password.count({ where: { userId: user.id } })).toBe(0)
})
