import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import {
	getSessionExpirationDate,
	verifyUserPassword,
} from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { createPassword, createUser } from '#tests/db-utils.ts'
import { BASE_URL } from '#tests/utils.ts'
import { action, resetPasswordUsernameSessionKey } from './reset-password.tsx'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

// Failure list for resetting a forgotten password:
// 1. The user is signed in elsewhere, on several devices. Every one of their
//    sessions ends.
// 2. Another user's sessions are untouched.
// 3. The account has no password yet (it signed up through Google). The reset
//    gives it one instead of failing.

const newPassword = 'new-password-5678'

async function resetPassword(username: string) {
	const verifySession = await verifySessionStorage.getSession()
	verifySession.set(resetPasswordUsernameSessionKey, username)
	const cookie = (
		await verifySessionStorage.commitSession(verifySession)
	).split(';')[0]!
	const body = new FormData()
	body.set('password', newPassword)
	body.set('confirmPassword', newPassword)
	const url = `${BASE_URL}/reset-password`
	return action({
		request: new Request(url, { method: 'POST', headers: { cookie }, body }),
		url: new URL(url),
		params: {},
		pattern: '/reset-password',
		context: new RouterContextProvider(),
	})
}

function createSession(userId: string) {
	return prisma.session.create({
		data: { expirationDate: getSessionExpirationDate(), userId },
		select: { id: true },
	})
}

async function setUpUsers() {
	const user = await prisma.user.create({
		data: { ...createUser(), password: { create: createPassword() } },
		select: { id: true, username: true },
	})
	const otherUser = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})
	await createSession(user.id)
	await createSession(user.id)
	return { user, otherUsersSession: await createSession(otherUser.id) }
}

test('resetting the password ends every session of that user', async () => {
	const { user } = await setUpUsers()

	const response = await resetPassword(user.username)

	expect((response as Response).headers.get('location')).toBe('/login')
	expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
})

test('resetting the password leaves another user’s sessions alone', async () => {
	const { user, otherUsersSession } = await setUpUsers()

	await resetPassword(user.username)

	expect(
		await prisma.session.findUnique({
			where: { id: otherUsersSession.id },
			select: { id: true },
		}),
	).toEqual({ id: otherUsersSession.id })
})

test('an account without a password gets one from a reset', async () => {
	const user = await prisma.user.create({
		data: createUser(),
		select: { id: true, username: true },
	})

	const response = await resetPassword(user.username)

	expect((response as Response).headers.get('location')).toBe('/login')
	expect(
		await verifyUserPassword({ username: user.username }, newPassword),
	).toEqual({ id: user.id })
})
