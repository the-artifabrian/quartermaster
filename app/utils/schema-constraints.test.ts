import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import '#tests/setup/db-setup.ts'

// These CHECK constraints exist only in migration SQL. Prisma's schema cannot
// express them, so a Prisma-generated rebuild of one of these tables would drop
// them silently. Each test saves a valid row first, so a rejected row can only
// mean the constraint refused it.

const CHECK_FAILED = /CHECK constraint failed/

async function setupHousehold() {
	const user = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})
	const household = await prisma.household.create({
		data: {
			name: 'Constraint household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
		select: { id: true },
	})
	return { userId: user.id, householdId: household.id }
}

test('a Recipe yield amount must be positive', async () => {
	const { userId, householdId } = await setupHousehold()
	const recipe = (yieldAmount: number) =>
		prisma.recipe.create({
			data: {
				title: 'Soup',
				userId,
				householdId,
				yieldAmount,
				yieldLabel: 'bowls',
			},
		})

	await expect(recipe(0.5)).resolves.toBeDefined()
	await expect(recipe(0)).rejects.toThrow(CHECK_FAILED)
	await expect(recipe(-2)).rejects.toThrow(CHECK_FAILED)
})

test('a Recipe yield amount and label are set together', async () => {
	const { userId, householdId } = await setupHousehold()
	const recipe = (yieldAmount: number | null, yieldLabel: string | null) =>
		prisma.recipe.create({
			data: { title: 'Soup', userId, householdId, yieldAmount, yieldLabel },
		})

	await expect(recipe(null, null)).resolves.toBeDefined()
	await expect(recipe(4, 'bowls')).resolves.toBeDefined()
	await expect(recipe(4, null)).rejects.toThrow(CHECK_FAILED)
	await expect(recipe(null, 'bowls')).rejects.toThrow(CHECK_FAILED)
	await expect(recipe(4, '   ')).rejects.toThrow(CHECK_FAILED)
})

test('a Shopping row is in Next shop or Later', async () => {
	const { userId, householdId } = await setupHousehold()
	const list = await prisma.shoppingList.create({
		data: { userId, householdId },
		select: { id: true },
	})
	const item = (horizon: string) =>
		prisma.shoppingListItem.create({
			data: { name: 'milk', listId: list.id, horizon },
		})

	await expect(item('next')).resolves.toBeDefined()
	await expect(item('later')).resolves.toBeDefined()
	await expect(item('someday')).rejects.toThrow(CHECK_FAILED)
})

test('a Recipe metadata value names a known dimension', async () => {
	const { householdId } = await setupHousehold()
	const value = (dimension: string, name: string) =>
		prisma.recipeMetadataValue.create({
			data: { householdId, dimension, name, nameKey: name.toLowerCase() },
		})

	await expect(value('cuisine', 'Nordic')).resolves.toBeDefined()
	await expect(value('diet', 'Vegan')).rejects.toThrow(CHECK_FAILED)
})
