import { RouterContextProvider } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './index.tsx'

afterEach(() => vi.restoreAllMocks())

async function setupActiveStaples() {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
		select: { id: true, userId: true },
	})
	const household = await prisma.household.create({
		data: {
			name: 'Staple mutation failures',
			staplesCutoverAt: new Date(),
			members: { create: { userId: session.userId, role: 'owner' } },
			householdIngredients: {
				create: {
					displayName: 'Salt',
					canonicalKey: 'salt',
					isStaple: true,
				},
			},
		},
		select: { householdIngredients: { select: { id: true } } },
	})
	return {
		...session,
		stapleId: household.householdIngredients[0]!.id,
	}
}

async function post(session: { id: string }, fields: Record<string, string>) {
	const cookie = await getSessionCookieHeader(session)
	return action({
		request: new Request(`${BASE_URL}/inventory`, {
			method: 'POST',
			headers: {
				cookie,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams(fields),
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/inventory',
		url: new URL(`${BASE_URL}/inventory`),
	})
}

test('add returns a useful failure for the inline form', async () => {
	const session = await setupActiveStaples()
	vi.spyOn(prisma.householdIngredient, 'upsert').mockRejectedValueOnce(
		new Error('database unavailable'),
	)

	await expect(
		post(session, { intent: 'add-staple', displayName: 'Garlic' }),
	).resolves.toMatchObject({
		data: {
			status: 'error',
			action: 'add-staple',
			message: 'Could not add Garlic. Try again.',
		},
		init: { status: 500 },
	})
})

test('remove returns a useful failure without hiding the row', async () => {
	const session = await setupActiveStaples()
	vi.spyOn(prisma.householdIngredient, 'update').mockRejectedValueOnce(
		new Error('database unavailable'),
	)

	await expect(
		post(session, {
			intent: 'remove-staple',
			itemId: session.stapleId,
		}),
	).resolves.toMatchObject({
		data: {
			status: 'error',
			action: 'remove-staple',
			message: 'Could not remove Salt. Try again.',
		},
		init: { status: 500 },
	})
})
