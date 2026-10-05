import * as setCookieParser from 'set-cookie-parser'
import { afterEach, expect, test, vi } from 'vitest'
import { createUser } from '#tests/db-utils.ts'
import {
	refreshSessionIfNeeded,
	SESSION_EXPIRATION_TIME,
	sessionKey,
} from './auth.server.ts'
import { prisma } from './db.server.ts'
import { authSessionStorage } from './session.server.ts'
import '#tests/setup/db-setup.ts'

// Failure list for refreshSessionIfNeeded:
// 1. No cookie at all: nothing to refresh, and no query.
// 2. A cookie without a sessionId (e.g. only a verified-time): no query.
// 3. Browser-session cookie (no `expires`) close to the end: left alone, so it
//    stays a browser-session cookie.
// 4. Remembered session with plenty of time left: no write, no cookie.
// 5. Remembered session close to the end: row pushed out a full session
//    length, cookie recommitted with that Expires and its other values kept.
// 6. Remembered session already expired: not revived (getUserId logs it out).
// 7. Remembered cookie whose Session row is gone (logged out elsewhere):
//    nothing created, no cookie.
// 8. A second request right after a refresh: does nothing.

const DAY = 1000 * 60 * 60 * 24

function parseSetCookie(setCookie: string | null) {
	const cookie = setCookie ? setCookieParser.parseString(setCookie) : null
	if (!cookie) throw new Error('Expected a Set-Cookie header')
	return cookie
}

afterEach(() => {
	vi.restoreAllMocks()
})

async function createSession(expiresIn: number) {
	const user = await prisma.user.create({ data: createUser() })
	return prisma.session.create({
		data: { userId: user.id, expirationDate: new Date(Date.now() + expiresIn) },
		select: { id: true, expirationDate: true },
	})
}

async function requestWithCookie(
	values: Record<string, unknown>,
	options?: { expires?: Date },
) {
	const authSession = await authSessionStorage.getSession()
	for (const [key, value] of Object.entries(values)) authSession.set(key, value)
	const setCookie = await authSessionStorage.commitSession(authSession, options)
	const cookie = parseSetCookie(setCookie)
	return new Request('http://localhost/', {
		headers: { cookie: `${cookie.name}=${cookie.value}` },
	})
}

async function storedExpiration(id: string) {
	const session = await prisma.session.findUniqueOrThrow({
		where: { id },
		select: { expirationDate: true },
	})
	return session.expirationDate
}

function expectAboutAFullSessionFromNow(date: Date) {
	expect(
		Math.abs(date.getTime() - (Date.now() + SESSION_EXPIRATION_TIME)),
	).toBeLessThan(60_000)
}

test('a request without a cookie returns null and reads nothing', async () => {
	const findUnique = vi.spyOn(prisma.session, 'findUnique')
	const updateMany = vi.spyOn(prisma.session, 'updateMany')

	const result = await refreshSessionIfNeeded(new Request('http://localhost/'))

	expect(result).toBeNull()
	expect(findUnique).not.toHaveBeenCalled()
	expect(updateMany).not.toHaveBeenCalled()
})

test('a cookie without a sessionId returns null and reads nothing', async () => {
	const findUnique = vi.spyOn(prisma.session, 'findUnique')
	const request = await requestWithCookie(
		{ 'verified-time': Date.now() },
		{ expires: new Date(Date.now() + 3 * DAY) },
	)

	expect(await refreshSessionIfNeeded(request)).toBeNull()
	expect(findUnique).not.toHaveBeenCalled()
})

test('a browser-session cookie close to its end is left alone', async () => {
	const session = await createSession(3 * DAY)
	const request = await requestWithCookie({ [sessionKey]: session.id })

	expect(await refreshSessionIfNeeded(request)).toBeNull()
	expect(await storedExpiration(session.id)).toEqual(session.expirationDate)
})

test('a remembered session with 20 days left is not touched', async () => {
	const session = await createSession(20 * DAY)
	const request = await requestWithCookie(
		{ [sessionKey]: session.id },
		{ expires: session.expirationDate },
	)

	expect(await refreshSessionIfNeeded(request)).toBeNull()
	expect(await storedExpiration(session.id)).toEqual(session.expirationDate)
})

test('a remembered session with 3 days left is extended by a full session', async () => {
	const session = await createSession(3 * DAY)
	const verifiedTime = Date.now() - 1000
	const request = await requestWithCookie(
		{ [sessionKey]: session.id, 'verified-time': verifiedTime },
		{ expires: session.expirationDate },
	)

	const setCookie = await refreshSessionIfNeeded(request)

	const stored = await storedExpiration(session.id)
	expectAboutAFullSessionFromNow(stored)
	const cookie = parseSetCookie(setCookie)
	expect(cookie.name).toBe('en_session')
	expect(cookie.expires?.getTime()).toBe(
		// Cookie Expires has whole-second precision.
		Math.floor(stored.getTime() / 1000) * 1000,
	)
	const refreshed = await authSessionStorage.getSession(
		`${cookie.name}=${cookie.value}`,
	)
	expect(refreshed.get(sessionKey)).toBe(session.id)
	expect(refreshed.get('verified-time')).toBe(verifiedTime)
})

test('an expired remembered session is not revived', async () => {
	const session = await createSession(-DAY)
	const request = await requestWithCookie(
		{ [sessionKey]: session.id },
		{ expires: new Date(Date.now() + DAY) },
	)

	expect(await refreshSessionIfNeeded(request)).toBeNull()
	expect(await storedExpiration(session.id)).toEqual(session.expirationDate)
})

test('a remembered cookie whose Session row is gone returns null', async () => {
	const session = await createSession(3 * DAY)
	await prisma.session.delete({ where: { id: session.id } })
	const request = await requestWithCookie(
		{ [sessionKey]: session.id },
		{ expires: session.expirationDate },
	)

	expect(await refreshSessionIfNeeded(request)).toBeNull()
	expect(await prisma.session.count({ where: { id: session.id } })).toBe(0)
})

test('a request right after a refresh does nothing', async () => {
	const session = await createSession(3 * DAY)
	const first = await refreshSessionIfNeeded(
		await requestWithCookie(
			{ [sessionKey]: session.id },
			{ expires: session.expirationDate },
		),
	)
	const cookie = parseSetCookie(first)
	const afterFirst = await storedExpiration(session.id)

	const second = await refreshSessionIfNeeded(
		new Request('http://localhost/', {
			headers: { cookie: `${cookie.name}=${cookie.value}` },
		}),
	)

	expect(second).toBeNull()
	expect(await storedExpiration(session.id)).toEqual(afterFirst)
})
