import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createSignedInHousehold } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './recipe-search.tsx'
import '#tests/setup/db-setup.ts'

const setupHousehold = (name: string) => createSignedInHousehold({ name })

test('linked-Recipe search ranks title matches without crossing households', async () => {
	const owner = await setupHousehold('Owner household')
	const outsider = await setupHousehold('Other household')
	await prisma.recipe.createMany({
		data: [
			{
				title: 'Chickne Curry',
				userId: owner.userId,
				householdId: owner.householdId,
			},
			{
				title: 'Weeknight Chicken Curry',
				userId: owner.userId,
				householdId: owner.householdId,
			},
			{
				title: 'Chicken Curry',
				userId: owner.userId,
				householdId: owner.householdId,
			},
			{
				title: 'Chicken Curry from another household',
				userId: outsider.userId,
				householdId: outsider.householdId,
			},
		],
	})
	const cookie = await getSessionCookieHeader(owner)
	const path = '/resources/recipe-search?q=chicken+curry'
	const result = await loader({
		request: new Request(`${BASE_URL}${path}`, { headers: { cookie } }),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/resources/recipe-search',
		url: new URL(`${BASE_URL}${path}`),
	})

	expect(result.recipes.map((recipe) => recipe.title)).toEqual([
		'Chicken Curry',
		'Weeknight Chicken Curry',
		'Chickne Curry',
	])
})
