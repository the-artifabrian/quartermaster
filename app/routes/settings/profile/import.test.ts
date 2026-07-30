import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader as shoppingLoader } from '../../shopping.tsx'
import { action } from './import.tsx'

const ACTION_ARGS_BASE = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/settings/profile/import',
	url: new URL(`${BASE_URL}/settings/profile/import`),
}

async function setupUser() {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: {
					create: {
						...createUser(),
						subscription: { create: { tier: 'pro' } },
					},
				},
			},
			select: { id: true, userId: true },
		})
		const household = await tx.household.create({
			data: {
				name: 'Import Household',
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		await tx.shoppingList.create({
			data: {
				userId: session.userId,
				householdId: household.id,
				items: {
					create: {
						name: 'Apples',
						quantity: '2',
						category: 'produce',
						source: 'manual',
					},
				},
			},
		})
		return { ...session, householdId: household.id }
	})
}

async function makeImportRequest(session: { id: string }) {
	const cookie = await getSessionCookieHeader(session)
	return new Request(`${BASE_URL}/settings/profile/import`, {
		method: 'POST',
		headers: {
			cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			importData: JSON.stringify({
				format: 'quartermaster-full-export-v1',
				recipes: [],
				shoppingLists: [
					{
						name: 'Shopping List',
						items: [
							{
								name: 'Apples',
								quantity: '2',
								category: 'produce',
								checked: false,
								source: 'manual',
							},
							{
								name: 'Bananas',
								quantity: '6',
								category: 'produce',
								checked: false,
								source: 'manual',
							},
						],
					},
				],
			}),
		}).toString(),
	})
}

test('re-importing a shopping list skips items already in the household list', async () => {
	const session = await setupUser()

	const firstResult = await action({
		request: await makeImportRequest(session),
		...ACTION_ARGS_BASE,
	})
	expect(firstResult).toEqual(
		expect.objectContaining({
			results: expect.objectContaining({
				shoppingLists: { created: 1, skipped: 1 },
			}),
		}),
	)

	const secondResult = await action({
		request: await makeImportRequest(session),
		...ACTION_ARGS_BASE,
	})
	expect(secondResult).toEqual(
		expect.objectContaining({
			results: expect.objectContaining({
				shoppingLists: { created: 0, skipped: 2 },
			}),
		}),
	)

	const shoppingList = await shoppingLoader({
		request: new Request(`${BASE_URL}/shopping`, {
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
		...ACTION_ARGS_BASE,
	})
	expect(
		shoppingList.shoppingList.items.map((item) => item.name).sort(),
	).toEqual(['Apples', 'Bananas'])
})
