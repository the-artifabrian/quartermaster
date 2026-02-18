import { describe, expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	subtractRecipeIngredientsFromInventory,
	previewInventorySubtraction,
} from './inventory-subtract.server.ts'

async function setupUser() {
	const user = await prisma.user.create({ data: createUser() })
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	return { id: user.id, householdId: household.id }
}

async function setupRecipe(
	userId: string,
	householdId: string,
	ingredients: Array<{ name: string; amount?: string; unit?: string }>,
) {
	return prisma.recipe.create({
		data: {
			title: 'Test Recipe',
			userId,
			householdId,
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
	householdId: string,
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
					householdId,
				},
			}),
		),
	)
}

describe('subtractRecipeIngredientsFromInventory', () => {
	test('subtracts matching quantities', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'flour', amount: '2', unit: 'cups' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'flour', quantity: 5, unit: 'cups' },
		])

		const summary = await subtractRecipeIngredientsFromInventory(
			recipe.id,
			user.householdId,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'flour' },
		})
		expect(item!.quantity).toBe(3)
		expect(item!.lowStock).toBe(false)
		expect(summary).toEqual({ updated: ['flour'], removed: [], skipped: [] })
	})

	test('deletes item when quantity reaches 0', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'flour', amount: '5', unit: 'cups' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'flour', quantity: 5, unit: 'cups' },
		])

		const summary = await subtractRecipeIngredientsFromInventory(
			recipe.id,
			user.householdId,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'flour' },
		})
		expect(item).toBeNull()
		expect(summary).toEqual({ removed: ['flour'], updated: [], skipped: [] })
	})

	test('deletes item when quantity would go below 0', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'flour', amount: '10', unit: 'cups' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'flour', quantity: 3, unit: 'cups' },
		])

		const summary = await subtractRecipeIngredientsFromInventory(
			recipe.id,
			user.householdId,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'flour' },
		})
		expect(item).toBeNull()
		expect(summary).toEqual({ removed: ['flour'], updated: [], skipped: [] })
	})

	test('skips staple ingredients', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'salt', amount: '1', unit: 'tsp' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'salt', quantity: 10, unit: 'tsp' },
		])

		const summary = await subtractRecipeIngredientsFromInventory(
			recipe.id,
			user.householdId,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'salt' },
		})
		expect(item!.quantity).toBe(10) // unchanged
		expect(summary).toEqual({ removed: [], updated: [], skipped: [] })
	})

	test('skips ingredients with no inventory match', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'saffron', amount: '1', unit: 'tsp' },
		])
		// No saffron in inventory
		await setupInventory(user.id, user.householdId, [
			{ name: 'flour', quantity: 5, unit: 'cups' },
		])

		// Should not throw
		const summary = await subtractRecipeIngredientsFromInventory(
			recipe.id,
			user.householdId,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'flour' },
		})
		expect(item!.quantity).toBe(5) // unchanged
		expect(summary).toEqual({ removed: [], updated: [], skipped: [] })
	})

	test('reports skipped for incompatible units (volume vs weight)', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'butter', amount: '2', unit: 'tbsp' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'butter', quantity: 200, unit: 'g' },
		])

		const summary = await subtractRecipeIngredientsFromInventory(
			recipe.id,
			user.householdId,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'butter' },
		})
		expect(item!.quantity).toBe(200) // unchanged — volume vs weight
		expect(item!.lowStock).toBe(false) // not flagged
		expect(summary).toEqual({
			removed: [],
			updated: [],
			skipped: [{ name: 'butter', inventoryItemId: expect.any(String), reason: 'incompatible_units' }],
		})
	})

	test('converts cross-system units (tsp recipe vs ml inventory)', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'sesame oil', amount: '1', unit: 'tsp' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'sesame oil', quantity: 100, unit: 'ml' },
		])

		const summary = await subtractRecipeIngredientsFromInventory(
			recipe.id,
			user.householdId,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'sesame oil' },
		})
		// 1 tsp ≈ 4.929 ml, so 100 - 4.929 ≈ 95.071
		expect(item!.quantity).toBeCloseTo(95.071, 0)
		expect(summary).toEqual({
			updated: ['sesame oil'],
			removed: [],
			skipped: [],
		})
	})

	test('converts cross-system weight units (oz recipe vs g inventory)', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'chicken', amount: '8', unit: 'oz' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'chicken', quantity: 500, unit: 'g' },
		])

		const summary = await subtractRecipeIngredientsFromInventory(
			recipe.id,
			user.householdId,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'chicken' },
		})
		// 8 oz ≈ 226.796 g, so 500 - 226.796 ≈ 273.204
		expect(item!.quantity).toBeCloseTo(273.204, 0)
		expect(summary).toEqual({
			updated: ['chicken'],
			removed: [],
			skipped: [],
		})
	})

	test('handles unit conversion within same family (tbsp → cup)', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'butter', amount: '8', unit: 'tbsp' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'butter', quantity: 2, unit: 'cup' },
		])

		const summary = await subtractRecipeIngredientsFromInventory(
			recipe.id,
			user.householdId,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'butter' },
		})
		// 8 tbsp = 0.5 cup, so 2 - 0.5 = 1.5
		expect(item!.quantity).toBeCloseTo(1.5, 1)
		expect(item!.lowStock).toBe(false)
		expect(summary).toEqual({
			updated: ['butter'],
			removed: [],
			skipped: [],
		})
	})

	test('respects serving ratio', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'flour', amount: '2', unit: 'cups' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'flour', quantity: 10, unit: 'cups' },
		])

		// Double servings → ratio = 2
		const summary = await subtractRecipeIngredientsFromInventory(
			recipe.id,
			user.householdId,
			2,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'flour' },
		})
		expect(item!.quantity).toBe(6) // 10 - (2 * 2) = 6
		expect(summary).toEqual({ updated: ['flour'], removed: [], skipped: [] })
	})

	test('reports skipped when inventory item has no quantity', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'cucumber', amount: '2', unit: '' },
			{ name: 'rice vinegar', amount: '3', unit: 'tbsp' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'cucumber' },
			{ name: 'rice vinegar' },
		])

		const summary = await subtractRecipeIngredientsFromInventory(
			recipe.id,
			user.householdId,
		)

		const cucumber = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'cucumber' },
		})
		expect(cucumber!.quantity).toBeNull()
		expect(cucumber!.lowStock).toBe(false) // not flagged

		const vinegar = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'rice vinegar' },
		})
		expect(vinegar!.quantity).toBeNull()
		expect(vinegar!.lowStock).toBe(false) // not flagged
		expect(summary).toEqual({
			removed: [],
			updated: [],
			skipped: [
				{ name: 'cucumber', inventoryItemId: expect.any(String), reason: 'no_quantity' },
				{ name: 'rice vinegar', inventoryItemId: expect.any(String), reason: 'no_quantity' },
			],
		})
	})

	test('subtracts unitless recipe ingredient from count-unit inventory', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'eggs', amount: '3' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'eggs', quantity: 12, unit: 'count' },
		])

		const summary = await subtractRecipeIngredientsFromInventory(
			recipe.id,
			user.householdId,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'eggs' },
		})
		expect(item!.quantity).toBe(9) // 12 - 3
		expect(summary).toEqual({ updated: ['eggs'], removed: [], skipped: [] })
	})

	test('subtracts count-unit recipe ingredient from unitless inventory', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'lemons', amount: '2', unit: 'each' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'lemons', quantity: 5 },
		])

		const summary = await subtractRecipeIngredientsFromInventory(
			recipe.id,
			user.householdId,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'lemons' },
		})
		expect(item!.quantity).toBe(3) // 5 - 2
		expect(summary).toEqual({ updated: ['lemons'], removed: [], skipped: [] })
	})

	test('nonexistent recipe is a no-op', async () => {
		const user = await setupUser()
		await setupInventory(user.id, user.householdId, [
			{ name: 'flour', quantity: 5, unit: 'cups' },
		])

		// Should not throw
		const summary = await subtractRecipeIngredientsFromInventory(
			'nonexistent-id',
			user.householdId,
		)

		const item = await prisma.inventoryItem.findFirst({
			where: { householdId: user.householdId, name: 'flour' },
		})
		expect(item!.quantity).toBe(5) // unchanged
		expect(summary).toEqual({ removed: [], updated: [], skipped: [] })
	})
})

describe('previewInventorySubtraction', () => {
	test('previews cross-system conversion (tsp recipe vs ml inventory)', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'sesame oil', amount: '1', unit: 'tsp' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'sesame oil', quantity: 100, unit: 'ml' },
		])

		const preview = await previewInventorySubtraction(
			recipe.id,
			user.householdId,
		)

		expect(preview.noMatch).toEqual([])
		expect(preview.willSkip).toEqual([])
		expect(preview.willSubtract).toHaveLength(1)
		expect(preview.willSubtract[0]!.name).toBe('sesame oil')
		expect(preview.willSubtract[0]!.subtractAmount).toBeCloseTo(4.929, 0)
		expect(preview.willSubtract[0]!.willBeRemoved).toBe(false)
	})

	test('reports willSkip for incompatible units in preview (volume vs weight)', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'butter', amount: '2', unit: 'tbsp' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'butter', quantity: 200, unit: 'g' },
		])

		const preview = await previewInventorySubtraction(
			recipe.id,
			user.householdId,
		)

		expect(preview.noMatch).toEqual([])
		expect(preview.willSubtract).toHaveLength(0)
		expect(preview.willSkip).toEqual([{ name: 'butter', reason: 'incompatible_units' }])
	})

	test('reports willSkip for inventory items without quantity', async () => {
		const user = await setupUser()
		const recipe = await setupRecipe(user.id, user.householdId, [
			{ name: 'cucumber', amount: '2', unit: '' },
			{ name: 'rice vinegar', amount: '3', unit: 'tbsp' },
		])
		await setupInventory(user.id, user.householdId, [
			{ name: 'cucumber' },
			{ name: 'rice vinegar' },
		])

		const preview = await previewInventorySubtraction(
			recipe.id,
			user.householdId,
		)

		expect(preview.noMatch).toEqual([])
		expect(preview.willSubtract).toHaveLength(0)
		expect(preview.willSkip).toEqual([
			{ name: 'cucumber', reason: 'no_quantity' },
			{ name: 'rice vinegar', reason: 'no_quantity' },
		])
	})
})
