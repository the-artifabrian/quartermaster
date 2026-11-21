import { RouterContextProvider } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import {
	getPasswordHash,
	getSessionExpirationDate,
	verifyUserPassword,
} from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createPassword, createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { handleVerification } from './reset-password.server.ts'
import { action, loader } from './reset-password.tsx'
import { type VerifyFunctionArgs } from './verify.server.ts'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

// Failure list for resetting a forgotten password, from the verify step's
// hand-off cookie to the new password:
// 1. The user is signed in elsewhere, on several devices. Every one of their
//    sessions ends.
// 2. Another user's sessions are untouched.
// 3. The account has no password yet (it signed up through Google). The reset
//    gives it one instead of failing.
// 4. A copy of the hand-off cookie kept after the reset has gone through can't
//    set the password again, on the page or on submit.
// 5. The hand-off is older than 10 minutes. Refused, even if the browser kept
//    the cookie.
// 6. The password changed after the code was used (in Settings, or any other
//    way). The hand-off stops working.
// 7. An account with no password gets one some other way after the code was
//    used. The hand-off stops working.
// 8. The email changed after the code was used. The hand-off stops working,
//    like the reset codes do.
// 9. The username changed after the code was used. The reset still goes to
//    the same account.
// 10. A cookie from before this change, holding only a username, is refused.
//
// The link opened on a device that is logged in (the iOS app always is):
// 11. Logged in as the account being reset. The page opens, the reset goes
//     through, every session of the account ends, and this device is logged
//     out and lands on /login.
// 12. Logged in as a different account. The reset goes to the account the
//     code was for. This device's session of the other account ends and its
//     cookie is cleared; that account's sessions elsewhere stay.
// 13. The device's session cookie names a session that has gone. The reset
//     route's own loader and action don't refuse or redirect because of it.
//     (In a real request the root loader ends the dead session first; this
//     checks only that the route adds no bounce of its own.)

const newPassword = 'new-password-5678'
const url = `${BASE_URL}/reset-password`

afterEach(() => {
	vi.useRealTimers()
})

/** The verify cookie the verify step hands over for `userId`. */
async function handOff(userId: string) {
	const response = await handleVerification({
		submission: { status: 'success', value: { target: userId } },
	} as unknown as VerifyFunctionArgs)
	const setCookie = (response as Response).headers.get('set-cookie')!
	return setCookie.split(';')[0]!
}

function routeArgs(request: Request) {
	return {
		request,
		url: new URL(request.url),
		params: {},
		pattern: '/reset-password',
		context: new RouterContextProvider(),
	}
}

async function submitReset(cookie: string, password = newPassword) {
	const body = new FormData()
	body.set('password', password)
	body.set('confirmPassword', password)
	const request = new Request(url, {
		method: 'POST',
		headers: { cookie },
		body,
	})
	return action(routeArgs(request)).catch((thrown: unknown) => thrown)
}

async function openPage(cookie: string) {
	const request = new Request(url, { headers: { cookie } })
	return loader(routeArgs(request)).catch((thrown: unknown) => thrown)
}

async function resetPassword(userId: string) {
	return submitReset(await handOff(userId))
}

function location(response: unknown) {
	return response instanceof Response ? response.headers.get('location') : null
}

function createSession(userId: string) {
	return prisma.session.create({
		data: { expirationDate: getSessionExpirationDate(), userId },
		select: { id: true },
	})
}

async function createAccount() {
	return prisma.user.create({
		data: { ...createUser(), password: { create: createPassword() } },
		select: { id: true, username: true },
	})
}

async function setUpUsers() {
	const user = await createAccount()
	const otherUser = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})
	await createSession(user.id)
	await createSession(user.id)
	return { user, otherUsersSession: await createSession(otherUser.id) }
}

async function passwordWorks(userId: string, password: string) {
	return (await verifyUserPassword({ id: userId }, password)) !== null
}

test('resetting the password ends every session of that user', async () => {
	const { user } = await setUpUsers()

	const response = await resetPassword(user.id)

	expect(location(response)).toBe('/login')
	expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
})

test('resetting the password leaves another user’s sessions alone', async () => {
	const { user, otherUsersSession } = await setUpUsers()

	await resetPassword(user.id)

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

	const response = await resetPassword(user.id)

	expect(location(response)).toBe('/login')
	expect(await passwordWorks(user.id, newPassword)).toBe(true)
})

test('a kept copy of the hand-off can’t reset the password a second time', async () => {
	const user = await createAccount()
	const cookie = await handOff(user.id)
	expect(location(await submitReset(cookie))).toBe('/login')

	expect(location(await openPage(cookie))).toBe('/forgot-password')
	const again = await submitReset(cookie, 'another-password-9012')

	expect(location(again)).toBe('/forgot-password')
	expect(await passwordWorks(user.id, newPassword)).toBe(true)
})

test('the hand-off runs out after 10 minutes', async () => {
	vi.useFakeTimers({ toFake: ['Date'] })
	const user = await createAccount()
	const cookie = await handOff(user.id)

	vi.setSystemTime(Date.now() + 9 * 60 * 1000)
	expect(await openPage(cookie)).toMatchObject({ username: user.username })

	vi.setSystemTime(Date.now() + 2 * 60 * 1000)
	expect(location(await openPage(cookie))).toBe('/forgot-password')
	expect(location(await submitReset(cookie))).toBe('/forgot-password')
	expect(await passwordWorks(user.id, newPassword)).toBe(false)
})

test('a password change after the code was used ends the hand-off', async () => {
	const user = await createAccount()
	const cookie = await handOff(user.id)
	await prisma.password.update({
		where: { userId: user.id },
		data: { hash: await getPasswordHash('changed-in-settings-1') },
	})

	expect(location(await submitReset(cookie))).toBe('/forgot-password')
	expect(await passwordWorks(user.id, 'changed-in-settings-1')).toBe(true)
})

test('a password created after the code was used ends the hand-off', async () => {
	const user = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})
	const cookie = await handOff(user.id)
	await prisma.password.create({
		data: { userId: user.id, hash: await getPasswordHash('created-1') },
	})

	expect(location(await submitReset(cookie))).toBe('/forgot-password')
	expect(await passwordWorks(user.id, 'created-1')).toBe(true)
})

test('an email change after the code was used ends the hand-off', async () => {
	const user = await createAccount()
	const cookie = await handOff(user.id)
	await prisma.user.update({
		where: { id: user.id },
		data: { email: `moved-${user.id}@example.com` },
	})

	expect(location(await submitReset(cookie))).toBe('/forgot-password')
	expect(await passwordWorks(user.id, newPassword)).toBe(false)
})

test('a username change in between still resets the same account', async () => {
	const user = await createAccount()
	const cookie = await handOff(user.id)
	const renamed = `renamed_${user.id.slice(-8)}`
	await prisma.user.update({
		where: { id: user.id },
		data: { username: renamed },
	})

	expect(await openPage(cookie)).toMatchObject({ username: renamed })
	expect(location(await submitReset(cookie))).toBe('/login')
	expect(await passwordWorks(user.id, newPassword)).toBe(true)
})

test('a hand-off holding only a username is refused', async () => {
	const user = await createAccount()
	const { verifySessionStorage } =
		await import('#app/utils/verification.server.ts')
	const session = await verifySessionStorage.getSession()
	session.set('resetPasswordUsername', user.username)
	const cookie = (await verifySessionStorage.commitSession(session)).split(
		';',
	)[0]!

	expect(location(await submitReset(cookie))).toBe('/login')
	expect(await passwordWorks(user.id, newPassword)).toBe(false)
})

/** The cookie header of a device logged in with `session`, plus `cookie`. */
async function loggedIn(session: { id: string }, cookie: string) {
	return `${await getSessionCookieHeader(session)}; ${cookie}`
}

function clearedCookies(response: unknown) {
	const setCookies =
		response instanceof Response ? response.headers.getSetCookie() : []
	return setCookies
		.filter((setCookie) => /expires=Thu, 01 Jan 1970/i.test(setCookie))
		.map((setCookie) => setCookie.split('=')[0])
}

test('a reset opened while logged in as the same account logs this device out', async () => {
	const user = await createAccount()
	const here = await createSession(user.id)
	await createSession(user.id)
	const cookie = await loggedIn(here, await handOff(user.id))

	expect(await openPage(cookie)).toMatchObject({
		username: user.username,
		loggedIn: true,
	})
	const response = await submitReset(cookie)

	expect(location(response)).toBe('/login')
	expect(clearedCookies(response)).toEqual(
		expect.arrayContaining(['en_session', 'en_verification']),
	)
	expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
	expect(await passwordWorks(user.id, newPassword)).toBe(true)
})

test('a reset opened while logged in as another account resets the right one and logs this device out', async () => {
	const user = await createAccount()
	const other = await createAccount()
	const otherHere = await createSession(other.id)
	const otherElsewhere = await createSession(other.id)
	const cookie = await loggedIn(otherHere, await handOff(user.id))

	expect(await openPage(cookie)).toMatchObject({
		username: user.username,
		loggedIn: true,
	})
	const response = await submitReset(cookie)

	expect(location(response)).toBe('/login')
	expect(clearedCookies(response)).toEqual(
		expect.arrayContaining(['en_session', 'en_verification']),
	)
	expect(await passwordWorks(user.id, newPassword)).toBe(true)
	expect(await passwordWorks(other.id, newPassword)).toBe(false)
	expect(
		await prisma.session.findMany({
			where: { userId: other.id },
			select: { id: true },
		}),
	).toEqual([{ id: otherElsewhere.id }])
})

test('the reset route works with a session cookie whose session has gone', async () => {
	const user = await createAccount()
	const gone = await createSession(user.id)
	await prisma.session.delete({ where: { id: gone.id } })
	const cookie = await loggedIn(gone, await handOff(user.id))

	expect(await openPage(cookie)).toMatchObject({ username: user.username })
	expect(location(await submitReset(cookie))).toBe('/login')
	expect(await passwordWorks(user.id, newPassword)).toBe(true)
})
