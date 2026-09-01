import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './recipe-search.tsx'

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
