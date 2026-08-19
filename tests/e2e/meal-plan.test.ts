import { getCurrentWeekStart, getWeekDays } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('Meal plan: view Meals, add one fast, and mark as cooked', async ({
	page,
	login,
}) => {
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

	// Create recipes via DB
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
	const secondRecipe = await prisma.recipe.create({
		data: {
			title: 'Herb Salad',
			userId: user.id,
			householdId: household.id,
			servings: 2,
		},
	})

	// Seed one planned Meal via DB — the planner reads Meal parents (#105)
	const weekStart = getCurrentWeekStart()
	const weekDays = getWeekDays(weekStart)
	await prisma.mealPlan.create({
		data: {
			householdId: household.id,
			weekStart,
			meals: {
				create: {
					date: weekDays[0]!, // Monday
					order: 0,
					label: 'dinner',
					recipeItems: {
						create: {
							order: 0,
							recipeId: recipe.id,
							recipeTitle: recipe.title,
						},
					},
				},
			},
		},
	})

	// 1. Navigate to meal plan
	await page.goto('/plan')
	await expect(page.getByRole('heading', { name: /meal plan/i })).toBeVisible()

	// 2. Verify the Meal appears in the calendar with its optional label
	await expect(page.getByText('Test Stir Fry').first()).toBeVisible()
	await expect(page.getByText('Dinner', { exact: true }).first()).toBeVisible()

	// 3. Verify "Copy Week" is visible (Meals exist)
	await expect(page.getByRole('button', { name: /copy week/i })).toBeVisible()

	// 4. Add another Meal through the fast path: Add meal → pick a recipe.
	// (Polling the first click instead of networkidle — household-events
	// long-polling never settles.)
	await expect(async () => {
		await page.getByRole('button', { name: /add meal/i }).first().click()
		await expect(
			page.getByPlaceholder('Search recipes...').first(),
		).toBeVisible({ timeout: 2000 })
	}).toPass()
	await page.getByRole('button', { name: /herb salad/i }).click()
	await expect(page.getByText('Herb Salad').first()).toBeVisible()
	await expect
		.poll(async () =>
			prisma.meal.count({
				where: {
					mealPlan: { householdId: household.id },
					recipeItems: { some: { recipeId: secondRecipe.id } },
				},
			}),
		)
		.toBe(1)

	// 5. Mark as cooked (plain toggle — no confirmation dialog)
	await page
		.getByRole('button', { name: 'Mark Test Stir Fry as cooked' })
		.first()
		.click()

	// 6. Verify cooked state (toggle label flips optimistically)
	await expect(
		page.getByRole('button', { name: 'Mark Test Stir Fry as not cooked' }).first(),
	).toBeVisible()

	// 7. Reload to confirm the state persisted — the optimistic flip above
	// would pass even if the server action failed
	await page.reload()
	await expect(
		page.getByRole('button', { name: 'Mark Test Stir Fry as not cooked' }).first(),
	).toBeVisible()
})
