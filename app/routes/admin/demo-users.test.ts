/**
 * The admin lists of users leave out demo visitors and the template's owner.
 * That includes a template build still running or one that died partway,
 * which the DemoTemplate pointer doesn't name.
 */
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { DEMO_LIFETIME_MS } from '#app/utils/demo.ts'
import {
	DEMO_EMAIL_DOMAIN,
	DEMO_TEMPLATE_EMAIL_DOMAIN,
} from '#app/utils/demo.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader as subscriptionsLoader } from './subscriptions.tsx'
import { loader as usersLoader } from './users.tsx'
import '#tests/setup/db-setup.ts'

async function setUp() {
	await prisma.role.upsert({
		where: { name: 'admin' },
		create: { name: 'admin' },
		update: {},
	})
	const admin = await prisma.user.create({
		data: { ...createUser(), roles: { connect: { name: 'admin' } } },
		select: { id: true, username: true },
	})
	const session = await prisma.session.create({
		data: {
			userId: admin.id,
			expirationDate: new Date(Date.now() + 60_000),
		},
		select: { id: true },
	})
	const real = await prisma.user.create({
		data: createUser(),
		select: { username: true },
	})
	await prisma.user.create({
		data: {
			username: 'demo-visitor',
			email: `visitor@${DEMO_EMAIL_DOMAIN}`,
			demoExpiresAt: new Date(Date.now() + DEMO_LIFETIME_MS),
			subscription: { create: { tier: 'pro' } },
		},
	})
	// One template owner the pointer names and one it doesn't.
	for (const id of ['current', 'abandoned']) {
		await prisma.user.create({
			data: {
				username: `demo-template-${id}`,
				email: `${id}@${DEMO_TEMPLATE_EMAIL_DOMAIN}`,
			},
		})
	}
	const request = new Request(`${BASE_URL}/admin/users`, {
		headers: { Cookie: await getSessionCookieHeader(session) },
	})
	const args = {
		request,
		params: {},
		pattern: '/admin/users',
		url: new URL(request.url),
		context: new RouterContextProvider(),
	}
	return { args, expected: [admin.username, real.username].sort() }
}

test('the users page lists real accounts only', async () => {
	const { args, expected } = await setUp()

	const { users } = await usersLoader(args)

	expect(users.map((u) => u.username).sort()).toEqual(expected)
})

test('the subscriptions page lists real accounts only', async () => {
	const { args, expected } = await setUp()

	const { users } = await subscriptionsLoader(args)

	expect(users.map((u) => u.username).sort()).toEqual(expected)
})
