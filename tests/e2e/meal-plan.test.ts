import { prisma } from '#app/utils/db.server.ts'
import {
	getCurrentWeekStart,
	getWeekDays,
	serializeDate,
} from '#app/utils/date.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('Meal plan: view entries and mark as cooked', async ({ page, login }) => {
	const user = await login()

	// Create a recipe via DB
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Test Stir Fry',
			userId: user.id,
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

	// 3. Verify "Copy to Next Week" is visible (entries exist)
	await expect(
		page.getByRole('button', { name: /copy to next week/i }),
	).toBeVisible()

	// 4. Mark as cooked (click the circle button)
	await page.getByTitle('Mark as cooked').first().click()

	// 5. Verify cooked state (toggle changes title)
	await expect(page.getByTitle('Mark as not cooked').first()).toBeVisible()
})
