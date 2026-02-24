import { getCurrentWeekStart } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

/**
 * Helper: set up a test user with Pro access and a household.
 * Returns the household ID.
 */
async function setupProUser(userId: string) {
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId, role: 'owner' } },
		},
	})

	await prisma.subscription.create({
		data: {
			userId,
			tier: 'pro',
			trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		},
	})

	return household.id
}

/** Check off all unchecked items on the shopping list page */
async function checkOffAllItems(page: import('@playwright/test').Page) {
	const checkButtons = page.getByRole('button', { name: /check off item/i })
	let count = await checkButtons.count()
	while (count > 0) {
		await checkButtons.first().click()
		await page.waitForTimeout(300)
		count = await page
			.getByRole('button', { name: /check off item/i })
			.count()
	}
}

test('Shopping → inventory pipeline: generate, check off, add to inventory', async ({
	page,
	login,
}) => {
	const user = await login()
	const householdId = await setupProUser(user.id)

	// Set up recipe with ingredients
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Pipeline Test Recipe',
			userId: user.id,
			householdId,
			servings: 2,
			ingredients: {
				create: [
					{ name: 'salmon fillet', amount: '2', unit: 'pieces', order: 0 },
					{ name: 'lemon', amount: '1', order: 1 },
				],
			},
			instructions: {
				create: [{ content: 'Cook the salmon.', order: 0 }],
			},
		},
	})

	// Create meal plan for current week
	const weekStart = getCurrentWeekStart()
	await prisma.mealPlan.create({
		data: {
			userId: user.id,
			householdId,
			weekStart,
			entries: {
				create: {
					date: weekStart,
					mealType: 'dinner',
					recipeId: recipe.id,
				},
			},
		},
	})

	// 1. Navigate to shopping list
	await page.goto('/shopping')
	await expect(
		page.getByRole('heading', { name: /shopping list/i }),
	).toBeVisible()

	// 2. Generate from meal plan
	await page.getByRole('button', { name: /from plan/i }).click()

	// 3. Verify generated items appear
	await expect(page.getByText('salmon fillet')).toBeVisible()
	await expect(page.getByText('lemon')).toBeVisible()

	// 4. Check off all items
	await checkOffAllItems(page)

	// 5. Open the review panel
	const addToInventoryLink = page.getByText(/add to inventory/i)
	await expect(addToInventoryLink).toBeVisible()
	await addToInventoryLink.click()

	// 6. Verify the review panel appears
	const reviewHeading = page.getByRole('heading', {
		name: /add to inventory/i,
	})
	await expect(reviewHeading).toBeVisible()

	// 7. Submit to inventory and wait for panel to disappear
	await page
		.getByRole('button', { name: /add \d+ to inventory/i })
		.click()
	await expect(reviewHeading).not.toBeVisible({ timeout: 10000 })

	// 8. Verify items are now in the database
	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { householdId },
		select: { name: true, location: true },
	})
	const names = inventoryItems.map((i) => i.name.toLowerCase())
	expect(names).toContain('salmon fillet')
	expect(names).toContain('lemon')

	// 9. Verify items show on the inventory page
	await page.goto('/inventory')
	await expect(page.getByText('salmon fillet').first()).toBeVisible()
	await expect(page.getByText('lemon').first()).toBeVisible()
})

test('Shopping → inventory pipeline: merges with existing inventory', async ({
	page,
	login,
}) => {
	const user = await login()
	const householdId = await setupProUser(user.id)

	// Pre-populate inventory with an existing item
	await prisma.inventoryItem.create({
		data: {
			name: 'garlic',
			location: 'pantry',
			quantity: 2,
			unit: 'heads',
			userId: user.id,
			householdId,
		},
	})

	// Create recipe that uses a new ingredient (garlic is already in stock)
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Merge Test Recipe',
			userId: user.id,
			householdId,
			servings: 4,
			ingredients: {
				create: [
					{ name: 'fresh ginger', amount: '1', unit: 'tbsp', order: 0 },
					{ name: 'soy sauce', amount: '2', unit: 'tbsp', order: 1 },
				],
			},
			instructions: {
				create: [{ content: 'Cook with ginger and soy sauce.', order: 0 }],
			},
		},
	})

	const weekStart = getCurrentWeekStart()
	await prisma.mealPlan.create({
		data: {
			userId: user.id,
			householdId,
			weekStart,
			entries: {
				create: {
					date: weekStart,
					mealType: 'dinner',
					recipeId: recipe.id,
				},
			},
		},
	})

	// Generate shopping list
	await page.goto('/shopping')
	await page.getByRole('button', { name: /from plan/i }).click()

	// At least ginger should appear (soy sauce may or may not be a staple)
	await expect(page.getByText('fresh ginger')).toBeVisible()

	// Check off all visible items
	await checkOffAllItems(page)

	// Open review and submit
	await page.getByText(/add to inventory/i).click()
	const reviewHeading = page.getByRole('heading', {
		name: /add to inventory/i,
	})
	await expect(reviewHeading).toBeVisible()
	await page
		.getByRole('button', { name: /add \d+ to inventory/i })
		.click()
	await expect(reviewHeading).not.toBeVisible({ timeout: 10000 })

	// Verify in database
	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { householdId },
		select: { name: true },
	})
	const names = inventoryItems.map((i) => i.name.toLowerCase())
	expect(names).toContain('fresh ginger')
	expect(names).toContain('garlic') // pre-existing, still there

	// Verify on page
	await page.goto('/inventory')
	await expect(page.getByText('fresh ginger')).toBeVisible()
	await expect(page.getByText('garlic')).toBeVisible()
})
