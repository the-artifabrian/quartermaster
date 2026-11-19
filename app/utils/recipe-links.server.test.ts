import { describe, expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { unlinkableRows } from './recipe-links.server.ts'
import '#tests/setup/db-setup.ts'

async function householdWithRecipe(title: string) {
	const user = await prisma.user.create({ data: createUser() })
	const household = await prisma.household.create({
		data: {
			name: `${title} home`,
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const recipe = await prisma.recipe.create({
		data: { title, userId: user.id, householdId: household.id },
		select: { id: true },
	})
	return { householdId: household.id, recipeId: recipe.id }
}

describe('unlinkableRows', () => {
	test('links to Recipes in the same household, and rows without a link, pass', async () => {
		const mine = await householdWithRecipe('Stock')
		await expect(
			unlinkableRows(
				[{ linkedRecipeId: mine.recipeId }, { linkedRecipeId: null }, {}],
				mine.householdId,
			),
		).resolves.toEqual([])
	})

	test('a link to another household’s Recipe is its row', async () => {
		const mine = await householdWithRecipe('Soup')
		const theirs = await householdWithRecipe('Their stock')
		await expect(
			unlinkableRows(
				[
					{ linkedRecipeId: mine.recipeId },
					{ linkedRecipeId: theirs.recipeId },
				],
				mine.householdId,
			),
		).resolves.toEqual([1])
	})

	test('a link to a Recipe that is gone (deleted by another member) is its row', async () => {
		const mine = await householdWithRecipe('Bread')
		await expect(
			unlinkableRows([{}, { linkedRecipeId: 'missing' }], mine.householdId),
		).resolves.toEqual([1])
	})

	test('every row linking the gone Recipe is named, not just the first', async () => {
		const mine = await householdWithRecipe('Lasagne')
		await expect(
			unlinkableRows(
				[
					{ linkedRecipeId: 'missing' },
					{ linkedRecipeId: mine.recipeId },
					{ linkedRecipeId: 'missing' },
				],
				mine.householdId,
			),
		).resolves.toEqual([0, 2])
	})
})
