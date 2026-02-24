import { getCurrentWeekStart } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('Shopping list flow: generate → verify items → add manual → check → clear', async ({
	page,
	login,
}) => {
	const user = await login()

	// Create household + Pro access (shopping requires Pro)
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	await prisma.subscription.create({
		data: {
			userId: user.id,
			tier: 'pro',
			trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		},
	})

	// Set up recipe + meal plan via DB
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Test Recipe',
			userId: user.id,
			householdId: household.id,
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
			householdId: household.id,
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
	await expect(page.getByText('chicken breast')).toBeVisible()
	await expect(page.getByText('jasmine rice')).toBeVisible()
	await expect(page.getByText('broccoli')).toBeVisible()

	// 4. Add manual item via Quick Add
	await page.getByPlaceholder(/add an item/i).fill('Bananas')
	await page.getByRole('button', { name: /add to list/i }).click()
	await expect(page.getByText('Bananas')).toBeVisible()

	// 5. Check an item
	await page
		.getByRole('button', { name: /check off item/i })
		.first()
		.click()

	// 6. Verify checked count updates in header
	await expect(page.getByText(/\(1\/\d+\)/)).toBeVisible()

	// 7. Clear checked items
	await page.getByRole('button', { name: /clear checked/i }).click()
	// The checked item should be gone, others remain
	await expect(page.getByText('jasmine rice')).toBeVisible()
})
