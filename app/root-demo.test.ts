// The demo banner draws its first paint from these root loader fields. The
// time left comes from the server's clock, so a browser with a wrong clock
// still shows the right time.
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './root.tsx'
import '#tests/setup/db-setup.ts'

async function load(session?: { id: string }) {
	const url = new URL(`${BASE_URL}/recipes`)
	const headers = new Headers()
	if (session) headers.set('cookie', await getSessionCookieHeader(session))
	const result = await loader({
		request: new Request(url, { headers }),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/',
		url,
	} as Parameters<typeof loader>[0])
	return result.data
}

function signIn(demoExpiresAt: Date | null) {
	return prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: { ...createUser(), demoExpiresAt } },
		},
		select: { id: true },
	})
}

test('a real user gets no demo fields', async () => {
	const data = await load(await signIn(null))
	expect(data.user).not.toBeNull()
	expect(data.demoExpiresAt).toBeNull()
	expect(data.demoMsLeft).toBeNull()
})

test('nobody signed in gets no demo fields', async () => {
	const data = await load()
	expect(data.user).toBeNull()
	expect(data.demoExpiresAt).toBeNull()
	expect(data.demoMsLeft).toBeNull()
})

test('a demo user gets when the demo ends and the time left by the server’s clock', async () => {
	const endsAt = new Date(Date.now() + 100 * 60 * 1000)
	const before = Date.now()
	const data = await load(await signIn(endsAt))
	const after = Date.now()
	expect(data.demoExpiresAt).toBe(endsAt.toISOString())
	expect(data.demoMsLeft).toBeGreaterThanOrEqual(endsAt.getTime() - after)
	expect(data.demoMsLeft).toBeLessThanOrEqual(endsAt.getTime() - before)
})

test('a demo user past their time has none left, and is still a demo user', async () => {
	const endedAt = new Date(Date.now() - 5 * 60 * 1000)
	const data = await load(await signIn(endedAt))
	expect(data.demoExpiresAt).toBe(endedAt.toISOString())
	expect(data.demoMsLeft).toBe(0)
})
