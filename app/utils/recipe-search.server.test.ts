import { describe, expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	recipeSearchWhere,
	recipeTitleSearchWhere,
} from './recipe-search.server.ts'

async function setupHousehold() {
	return prisma.$transaction(async (tx) => {
		const user = await tx.user.create({ data: createUser() })
		const household = await tx.household.create({
			data: {
				name: 'Test Household',
				members: { create: { userId: user.id, role: 'owner' } },
			},
		})
		return { userId: user.id, householdId: household.id }
	})
}

async function createRecipe(
	ctx: { userId: string; householdId: string },
	title: string,
	opts: { description?: string; ingredients?: string[] } = {},
) {
	return prisma.recipe.create({
		data: {
			title,
			description: opts.description,
			userId: ctx.userId,
			householdId: ctx.householdId,
			...(opts.ingredients && {
				ingredients: {
					create: opts.ingredients.map((name, order) => ({ name, order })),
				},
			}),
		},
	})
}

async function searchTitles(householdId: string, search: string) {
	const recipes = await prisma.recipe.findMany({
		where: { householdId, ...recipeSearchWhere(search) },
		select: { title: true },
		orderBy: { title: 'asc' },
	})
	return recipes.map((r) => r.title)
}

describe('recipeSearchWhere', () => {
	test('matches when query words appear non-adjacently in the title', async () => {
		const ctx = await setupHousehold()
		await createRecipe(ctx, 'Pea and Carrot Stew')

		expect(await searchTitles(ctx.householdId, 'pea stew')).toEqual([
			'Pea and Carrot Stew',
		])
	})

	test('still matches a single-word query as a substring', async () => {
		const ctx = await setupHousehold()
		await createRecipe(ctx, 'Pea and Carrot Stew')

		expect(await searchTitles(ctx.householdId, 'stew')).toEqual([
			'Pea and Carrot Stew',
		])
	})

	test('is case-insensitive', async () => {
		const ctx = await setupHousehold()
		await createRecipe(ctx, 'Pea and Carrot Stew')

		expect(await searchTitles(ctx.householdId, 'PEA STEW')).toEqual([
			'Pea and Carrot Stew',
		])
	})

	test('requires every word to match somewhere', async () => {
		const ctx = await setupHousehold()
		await createRecipe(ctx, 'Pea and Carrot Stew')

		expect(await searchTitles(ctx.householdId, 'beef stew')).toEqual([])
	})

	test('different words may match different fields', async () => {
		const ctx = await setupHousehold()
		await createRecipe(ctx, 'Weeknight Curry', {
			description: 'Quick dinner',
			ingredients: ['chicken thighs', 'coconut milk'],
		})

		expect(await searchTitles(ctx.householdId, 'quick chicken')).toEqual([
			'Weeknight Curry',
		])
	})

	test('caps the number of terms so long pasted queries stay cheap', async () => {
		const ctx = await setupHousehold()
		await createRecipe(ctx, 'Pea and Carrot Stew')

		// 8 matching words followed by garbage — the garbage terms past the cap
		// are ignored instead of ANDing the query down to zero results
		const query = 'pea and carrot stew pea and carrot stew xzqy wvut'
		expect(await searchTitles(ctx.householdId, query)).toEqual([
			'Pea and Carrot Stew',
		])
	})

	test('ignores extra whitespace between words', async () => {
		const ctx = await setupHousehold()
		await createRecipe(ctx, 'Pea and Carrot Stew')

		expect(await searchTitles(ctx.householdId, '  pea   stew  ')).toEqual([
			'Pea and Carrot Stew',
		])
	})
})

describe('recipeTitleSearchWhere', () => {
	test('matches non-adjacent words in the title only', async () => {
		const ctx = await setupHousehold()
		await createRecipe(ctx, 'Pea and Carrot Stew')
		await createRecipe(ctx, 'Lentil Soup', {
			ingredients: ['split peas', 'stew mix'],
		})

		const recipes = await prisma.recipe.findMany({
			where: { householdId: ctx.householdId, ...recipeTitleSearchWhere('pea stew') },
			select: { title: true },
		})
		expect(recipes.map((r) => r.title)).toEqual(['Pea and Carrot Stew'])
	})
})
