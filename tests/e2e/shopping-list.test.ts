import { prisma } from '#app/utils/db.server.ts'
import { getCurrentWeekStart } from '#app/utils/date.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('Shopping list flow: generate → verify items → add manual → check → clear', async ({
	page,
	login,
}) => {
	const user = await login()

	// Set up recipe + meal plan via DB
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Test Recipe',
			userId: user.id,
			servings: 4,
			ingredients: {
				create: [
					{ name: 'chicken breast', amount: '2', unit: 'lbs', order: 0 },
					{ name: 'jasmine rice', amount: '1', unit: 'cup', order: 1 },
					{ name: 'broccoli', amount: '1', unit: 'head', order: 2 },
				],
			},
			instructions: {
				create: [{ content: 'Cook everything', order: 0 }],
			},
		},
	})

	const weekStart = getCurrentWeekStart()
	await prisma.mealPlan.create({
		data: {
			userId: user.id,
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
	await page.goto('/plan/shopping-list')
	await expect(
		page.getByRole('heading', { name: /shopping list/i }),
	).toBeVisible()

	// 2. Generate from meal plan
	await page.getByRole('button', { name: /generate from meal plan/i }).click()

	// 3. Verify generated items appear
	await expect(page.getByText('chicken breast')).toBeVisible()
	await expect(page.getByText('jasmine rice')).toBeVisible()
	await expect(page.getByText('broccoli')).toBeVisible()

	// 4. Add manual item
	await page.getByLabel(/item name/i).fill('Bananas')
	await page.getByLabel(/quantity/i).first().fill('6')
	await page.getByRole('button', { name: /add to list/i }).click()
	await expect(page.getByText('Bananas')).toBeVisible()

	// 5. Check an item (click the toggle form's submit button)
	const chickenItem = page.getByText('chicken breast').locator('..')
	await chickenItem.locator('button[type="submit"]').first().click()

	// 6. Verify checked count updates
	await expect(page.getByText(/1 of \d+ checked/i)).toBeVisible()

	// 7. Clear checked items
	await page.getByRole('button', { name: /clear checked/i }).click()
	await expect(page.getByText('chicken breast')).not.toBeVisible()
	// Other items should still be visible
	await expect(page.getByText('jasmine rice')).toBeVisible()
})
