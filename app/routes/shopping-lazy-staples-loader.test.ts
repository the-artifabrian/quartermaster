import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './shopping.tsx'
import '#tests/setup/db-setup.ts'

const observedQueries: string[] = []
prisma.$on('query', (event) => observedQueries.push(event.query))

test('ordinary Shopping loading leaves Staple choices on demand', async () => {
	const session = await prisma.session.create({
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
	const household = await prisma.household.create({
		data: {
			name: 'Lazy Shopping Staples Household',
			members: { create: { userId: session.userId, role: 'owner' } },
			householdIngredients: {
				create: {
					displayName: 'Salt',
					canonicalKey: 'salt',
					isStaple: true,
				},
			},
		},
	})
	await prisma.shoppingList.create({
		data: {
			userId: session.userId,
			householdId: household.id,
			items: { create: { name: 'Salt', checked: true, horizon: 'later' } },
		},
	})
	const cookie = await getSessionCookieHeader(session)
	const queryStart = observedQueries.length

	const result = await loader({
		request: new Request(`${BASE_URL}/shopping`, { headers: { cookie } }),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/shopping',
		url: new URL(`${BASE_URL}/shopping`),
	})
	const routeQueries = observedQueries.slice(queryStart).join('\n')

	expect(result).not.toHaveProperty('staples')
	expect(result).toMatchObject({ shoppingIdentities: ['salt'] })
	expect(routeQueries).not.toMatch(/\bHouseholdIngredient\b/)
})
