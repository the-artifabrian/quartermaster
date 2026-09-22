import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './index.tsx'
import '#tests/setup/db-setup.ts'

const observedQueries: string[] = []
prisma.$on('query', (event) => observedQueries.push(event.query))

test('the Staples screen loads its Staples and nothing else', async () => {
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
	await prisma.household.create({
		data: {
			name: 'Task-first Staples Household',
			members: { create: { userId: session.userId, role: 'owner' } },
			householdIngredients: {
				create: {
					displayName: 'Salt',
					canonicalKey: 'salt',
					isStaple: true,
				},
			},
			mealPlans: {
				create: {
					weekStart: new Date('2026-09-07T00:00:00Z'),
					meals: {
						create: { date: new Date('2026-09-07T00:00:00Z'), order: 0 },
					},
				},
			},
		},
	})
	const cookie = await getSessionCookieHeader(session)
	const queryStart = observedQueries.length

	const result = await loader({
		request: new Request(`${BASE_URL}/inventory`, { headers: { cookie } }),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/inventory',
		url: new URL(`${BASE_URL}/inventory`),
	})
	const routeQueries = observedQueries.slice(queryStart).join('\n')

	expect(result).toEqual({
		staples: [{ id: expect.any(String), displayName: 'Salt' }],
	})
	// The list is the whole page: no tier, no Plan, no Shopping read.
	expect(routeQueries).not.toMatch(/\b(?:Subscription|Meal|ShoppingList)\b/)
})
