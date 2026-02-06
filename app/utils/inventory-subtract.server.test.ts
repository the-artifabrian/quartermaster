import { describe, expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { subtractRecipeIngredientsFromInventory } from './inventory-subtract.server.ts'

async function setupUser() {
	return prisma.user.create({ data: createUser() })
}

async function setupRecipe(
	userId: string,
	ingredients: Array<{ name: string; amount?: string; unit?: string }>,
) {
	return prisma.recipe.create({
		data: {
			title: 'Test Recipe',
			userId,
			servings: 4,
			ingredients: {
				create: ingredients.map((ing, i) => ({
					name: ing.name,
					amount: ing.amount ?? null,
					unit: ing.unit ?? null,
					order: i,
				})),
			},
		},
		include: { ingredients: true },
	})
}

async function setupInventory(
	userId: string,
	items: Array<{
		name: string
		quantity?: number
		unit?: string
		lowStock?: boolean
	}>,
) {
	return Promise.all(
		items.map((item) =>
			prisma.inventoryItem.create({
				data: {
					name: item.name,
					location: 'pantry',
					quantity: item.quantity ?? null,
					unit: item.unit ?? null,
					lowStock: item.lowStock ?? false,
					userId,
				},
			}),
		),
	)
}

describe('subtractRecipeIngredientsFromInventory', () => {
	test('subtracts matching quantities', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, [
			{ name: 'flour', amount: '2', unit: 'cups' },
		])
		await setupInventory(user.id, [
			{ name: 'flour', quantity: 5, unit: 'cups' },
		])

		await subtractRecipeIngredientsFromInventory(recipe.id, user.id)

		const item = await prisma.inventoryItem.findFirst({
			where: { userId: user.id, name: 'flour' },
		})
		expect(item!.quantity).toBe(3)
		expect(item!.lowStock).toBe(false)
	})

	test('marks low stock when quantity reaches 0', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, [
			{ name: 'flour', amount: '5', unit: 'cups' },
		])
		await setupInventory(user.id, [
			{ name: 'flour', quantity: 5, unit: 'cups' },
		])

		await subtractRecipeIngredientsFromInventory(recipe.id, user.id)

		const item = await prisma.inventoryItem.findFirst({
			where: { userId: user.id, name: 'flour' },
		})
		expect(item!.quantity).toBe(0)
		expect(item!.lowStock).toBe(true)
	})

	test('quantity never goes below 0', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, [
			{ name: 'flour', amount: '10', unit: 'cups' },
		])
		await setupInventory(user.id, [
			{ name: 'flour', quantity: 3, unit: 'cups' },
		])

		await subtractRecipeIngredientsFromInventory(recipe.id, user.id)

		const item = await prisma.inventoryItem.findFirst({
			where: { userId: user.id, name: 'flour' },
		})
		expect(item!.quantity).toBe(0)
		expect(item!.lowStock).toBe(true)
	})

	test('skips staple ingredients', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, [
			{ name: 'salt', amount: '1', unit: 'tsp' },
		])
		await setupInventory(user.id, [
			{ name: 'salt', quantity: 10, unit: 'tsp' },
		])

		await subtractRecipeIngredientsFromInventory(recipe.id, user.id)

		const item = await prisma.inventoryItem.findFirst({
			where: { userId: user.id, name: 'salt' },
		})
		expect(item!.quantity).toBe(10) // unchanged
	})

	test('skips ingredients with no inventory match', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, [
			{ name: 'saffron', amount: '1', unit: 'tsp' },
		])
		// No saffron in inventory
		await setupInventory(user.id, [
			{ name: 'flour', quantity: 5, unit: 'cups' },
		])

		// Should not throw
		await subtractRecipeIngredientsFromInventory(recipe.id, user.id)

		const item = await prisma.inventoryItem.findFirst({
			where: { userId: user.id, name: 'flour' },
		})
		expect(item!.quantity).toBe(5) // unchanged
	})

	test('skips incompatible units', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, [
			{ name: 'butter', amount: '2', unit: 'tbsp' },
		])
		await setupInventory(user.id, [
			{ name: 'butter', quantity: 200, unit: 'g' },
		])

		await subtractRecipeIngredientsFromInventory(recipe.id, user.id)

		const item = await prisma.inventoryItem.findFirst({
			where: { userId: user.id, name: 'butter' },
		})
		expect(item!.quantity).toBe(200) // unchanged — US volume vs metric weight
	})

	test('handles unit conversion within same family (tbsp → cup)', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, [
			{ name: 'butter', amount: '8', unit: 'tbsp' },
		])
		await setupInventory(user.id, [
			{ name: 'butter', quantity: 2, unit: 'cup' },
		])

		await subtractRecipeIngredientsFromInventory(recipe.id, user.id)

		const item = await prisma.inventoryItem.findFirst({
			where: { userId: user.id, name: 'butter' },
		})
		// 8 tbsp = 0.5 cup, so 2 - 0.5 = 1.5
		expect(item!.quantity).toBeCloseTo(1.5, 1)
		expect(item!.lowStock).toBe(false)
	})

	test('respects serving ratio', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, [
			{ name: 'flour', amount: '2', unit: 'cups' },
		])
		await setupInventory(user.id, [
			{ name: 'flour', quantity: 10, unit: 'cups' },
		])

		// Double servings → ratio = 2
		await subtractRecipeIngredientsFromInventory(recipe.id, user.id, 2)

		const item = await prisma.inventoryItem.findFirst({
			where: { userId: user.id, name: 'flour' },
		})
		expect(item!.quantity).toBe(6) // 10 - (2 * 2) = 6
	})

	test('nonexistent recipe is a no-op', async () => {
		const user = await setupUser()
		await setupInventory(user.id, [
			{ name: 'flour', quantity: 5, unit: 'cups' },
		])

		// Should not throw
		await subtractRecipeIngredientsFromInventory(
			'nonexistent-id',
			user.id,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { userId: user.id, name: 'flour' },
		})
		expect(item!.quantity).toBe(5) // unchanged
	})
})
