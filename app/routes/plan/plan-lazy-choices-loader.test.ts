import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { menuTitleKey } from '#app/utils/menu-validation.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './index.tsx'

const observedQueries: string[] = []
prisma.$on('query', (event) => observedQueries.push(event.query))

test('ordinary Plan week loading leaves Recipe and Menu choices on demand', async () => {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
		select: { id: true, userId: true },
	})
	const household = await prisma.household.create({
		data: {
			name: 'Lazy Plan choices Household',
			members: { create: { userId: session.userId, role: 'owner' } },
		},
	})
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Unserialized Recipe choice',
			userId: session.userId,
			householdId: household.id,
			isFavorite: true,
		},
	})
	await prisma.menu.create({
		data: {
			title: 'Unserialized Menu choice',
			titleKey: menuTitleKey('Unserialized Menu choice'),
			householdId: household.id,
			sections: {
				create: {
					order: 0,
					items: {
						create: {
							kind: 'recipe',
							order: 0,
							recipeId: recipe.id,
							recipeTitle: recipe.title,
							scaleMultiplier: 1,
						},
					},
				},
			},
		},
	})
	const cookie = await getSessionCookieHeader(session)

	for (const path of ['/plan', '/plan?weekStart=2026-09-14']) {
		const queryStart = observedQueries.length
		const result = await loader({
			request: new Request(`${BASE_URL}${path}`, { headers: { cookie } }),
			params: {},
			context: new RouterContextProvider(),
			pattern: '/plan',
			url: new URL(`${BASE_URL}${path}`),
		})
		const routeQueries = observedQueries.slice(queryStart).join('\n')

		expect(result).not.toHaveProperty('recipes')
		expect(result).not.toHaveProperty('menus')
		expect(JSON.stringify(result)).not.toContain('Unserialized')
		expect(routeQueries).not.toContain('isFavorite')
		expect(routeQueries).not.toContain('MenuItem')
	}
})
