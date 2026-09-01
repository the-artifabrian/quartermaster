import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './index.tsx'

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

async function loadRecipeTitles(session: { id: string }, query: string) {
	const cookie = await getSessionCookieHeader(session)
	const path = `/recipes?${query}`
	const result = await loader({
		request: new Request(`${BASE_URL}${path}`, { headers: { cookie } }),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/recipes',
		url: new URL(`${BASE_URL}${path}`),
	})
	return result.recipes.map((recipe) => recipe.title)
}

test('fuzzy Recipe search remains isolated to the signed-in household', async () => {
	const owner = await setupHousehold('Owner household')
	const outsider = await setupHousehold('Other household')
	await prisma.recipe.createMany({
		data: [
			{
				title: 'Chicken Curry',
				userId: owner.userId,
				householdId: owner.householdId,
			},
			{
				title: 'Chikcen Curry',
				userId: outsider.userId,
				householdId: outsider.householdId,
			},
		],
	})

	expect(await loadRecipeTitles(owner, 'search=chikcen+curry')).toEqual([
		'Chicken Curry',
	])
})

test('Recipe search relevance takes precedence over the selected tie-break sort', async () => {
	const owner = await setupHousehold('Ranking household')
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
		],
	})
	await prisma.recipe.create({
		data: {
			title: 'A Weeknight Curry',
			description: 'Quick dinner',
			userId: owner.userId,
			householdId: owner.householdId,
			ingredients: { create: { name: 'chicken thighs', order: 0 } },
		},
	})

	expect(
		await loadRecipeTitles(owner, 'search=chicken+curry&sort=alphabetical'),
	).toEqual([
		'Chicken Curry',
		'Weeknight Chicken Curry',
		'Chickne Curry',
		'A Weeknight Curry',
	])
})

test('diacritic-folded search composes with favorite, time, and metadata filters', async () => {
	const owner = await setupHousehold('Filtered household')
	const romanian = await prisma.recipeMetadataValue.create({
		data: {
			householdId: owner.householdId,
			dimension: 'cuisine',
			name: 'Romanian',
			nameKey: 'romanian',
		},
	})
	for (const recipe of [
		{ title: 'Ciorbă', isFavorite: true, totalTime: 40, romanian: true },
		{
			title: 'Ciorbă for later',
			isFavorite: false,
			totalTime: 30,
			romanian: true,
		},
		{
			title: 'Slow Ciorbă',
			isFavorite: true,
			totalTime: 90,
			romanian: true,
		},
		{
			title: 'Weeknight Ciorbă',
			isFavorite: true,
			totalTime: 30,
			romanian: false,
		},
	]) {
		await prisma.recipe.create({
			data: {
				title: recipe.title,
				isFavorite: recipe.isFavorite,
				totalTime: recipe.totalTime,
				userId: owner.userId,
				householdId: owner.householdId,
				...(recipe.romanian && {
					metadataAssignments: { create: { valueId: romanian.id } },
				}),
			},
		})
	}

	expect(
		await loadRecipeTitles(
			owner,
			'search=ciorba&favorites=true&maxTime=45&cuisine=romanian',
		),
	).toEqual(['Ciorbă'])
})
