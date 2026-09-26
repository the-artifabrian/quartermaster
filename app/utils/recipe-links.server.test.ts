import { describe, expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { assertLinkedRecipesInHousehold } from './recipe-links.server.ts'
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

describe('assertLinkedRecipesInHousehold', () => {
	test('accepts links to Recipes in the same household', async () => {
		const mine = await householdWithRecipe('Stock')
		await expect(
			assertLinkedRecipesInHousehold(
				[{ linkedRecipeId: mine.recipeId }, { linkedRecipeId: null }, {}],
				mine.householdId,
			),
		).resolves.toBeUndefined()
	})

	test('rejects a link to another household’s Recipe with a 400', async () => {
		const mine = await householdWithRecipe('Soup')
		const theirs = await householdWithRecipe('Their stock')
		await expect(
			assertLinkedRecipesInHousehold(
				[
					{ linkedRecipeId: mine.recipeId },
					{ linkedRecipeId: theirs.recipeId },
				],
				mine.householdId,
			),
		).rejects.toMatchObject({ status: 400 })
	})

	test('rejects a link to a Recipe that does not exist', async () => {
		const mine = await householdWithRecipe('Bread')
		await expect(
			assertLinkedRecipesInHousehold(
				[{ linkedRecipeId: 'missing' }],
				mine.householdId,
			),
		).rejects.toMatchObject({ status: 400 })
	})
})
