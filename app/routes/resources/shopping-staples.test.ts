import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './shopping-staples.tsx'
import '#tests/setup/db-setup.ts'

async function setupHousehold(name: string) {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: { create: createUser() },
			},
			select: { id: true, userId: true },
		})
		const household = await tx.household.create({
			data: {
				name,
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		return { ...session, householdId: household.id }
	})
}

test('Shopping Staple choices require an authenticated household', async () => {
	const path = '/resources/shopping-staples'

	await expect(
		loader({
			request: new Request(`${BASE_URL}${path}`),
			params: {},
			context: new RouterContextProvider(),
			pattern: path,
			url: new URL(`${BASE_URL}${path}`),
		}),
	).rejects.toMatchObject({ status: 302 })
})

test('Shopping Staple choices are active, ordered, and household scoped', async () => {
	const owner = await setupHousehold('Shopping choice owner')
	const outsider = await setupHousehold('Other Shopping household')
	await prisma.householdIngredient.createMany({
		data: [
			{
				householdId: owner.householdId,
				displayName: 'Greek Yogurt',
				canonicalKey: 'greek yogurt',
				isStaple: true,
			},
			{
				householdId: owner.householdId,
				displayName: 'Apples',
				canonicalKey: 'apples',
				isStaple: true,
			},
			{
				householdId: owner.householdId,
				displayName: 'Archived flour',
				canonicalKey: 'archived flour',
				isStaple: false,
			},
			{
				householdId: outsider.householdId,
				displayName: 'Bananas',
				canonicalKey: 'bananas',
				isStaple: true,
			},
		],
	})
	const cookie = await getSessionCookieHeader(owner)
	const path = '/resources/shopping-staples'

	const result = await loader({
		request: new Request(`${BASE_URL}${path}`, { headers: { cookie } }),
		params: {},
		context: new RouterContextProvider(),
		pattern: path,
		url: new URL(`${BASE_URL}${path}`),
	})

	expect(result.init?.headers).toEqual({
		'Cache-Control': 'private, no-store',
	})
	expect(result.data.staples).toEqual([
		{
			id: expect.any(String),
			displayName: 'Apples',
			shoppingIdentity: 'apple',
		},
		{
			id: expect.any(String),
			displayName: 'Greek Yogurt',
			shoppingIdentity: 'greek yogurt',
		},
	])
})
