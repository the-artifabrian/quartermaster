import { getCurrentWeekStart, getWeekDays } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('Meal plan: view entries and mark as cooked', async ({ page, login }) => {
	const user = await login()

	// The login fixture creates a bare user; the app expects a household
	// (all plan/recipe data is household-scoped) and Copy Week is Pro-gated.
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	await prisma.subscription.create({
		data: { userId: user.id, tier: 'pro' },
	})

	// Create a recipe via DB
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Test Stir Fry',
			userId: user.id,
			householdId: household.id,
			servings: 4,
			ingredients: {
				create: [
					{ name: 'chicken', amount: '1', unit: 'lb', order: 0 },
					{ name: 'rice', amount: '2', unit: 'cups', order: 1 },
				],
			},
			instructions: {
				create: [{ content: 'Stir fry everything', order: 0 }],
			},
		},
	})

	// Create a meal plan with an entry via DB
	const weekStart = getCurrentWeekStart()
	const weekDays = getWeekDays(weekStart)
	await prisma.mealPlan.create({
		data: {
			userId: user.id,
			householdId: household.id,
			weekStart,
			entries: {
				create: {
					date: weekDays[0]!, // Monday
					mealType: 'dinner',
					recipeId: recipe.id,
				},
			},
		},
	})

	// 1. Navigate to meal plan
	await page.goto('/plan')
	await expect(page.getByRole('heading', { name: /meal plan/i })).toBeVisible()

	// 2. Verify recipe appears in the calendar
	await expect(page.getByText('Test Stir Fry').first()).toBeVisible()

	// 3. Verify "Copy Week" is visible (entries exist)
	await expect(page.getByRole('button', { name: /copy week/i })).toBeVisible()

	// 4. Mark as cooked (plain toggle — no confirmation dialog)
	await page.getByRole('button', { name: 'Mark as cooked' }).first().click()

	// 5. Verify cooked state (toggle label flips optimistically)
	await expect(
		page.getByRole('button', { name: 'Mark as not cooked' }).first(),
	).toBeVisible()

	// 6. Reload to confirm the state persisted — the optimistic flip above
	// would pass even if the server action failed
	await page.reload()
	await expect(
		page.getByRole('button', { name: 'Mark as not cooked' }).first(),
	).toBeVisible()
})
