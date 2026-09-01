import {
	formatWeekdayName,
	getCurrentWeekStart,
	getWeekDays,
	isToday,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('Meal plan: view Meals, add one fast, and mark as cooked', async ({
	page,
	login,
}) => {
	const user = await login()

	// The login fixture creates a bare user; the app expects a household
	// because all plan/recipe data is household-scoped.
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})

	// Create recipes via DB
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Test Stir Fry',
			userId: user.id,
			householdId: household.id,
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
		},
	})

	// Seed one planned Meal via DB — the planner reads Meal parents (#105)
	const weekStart = getCurrentWeekStart()
	const weekDays = getWeekDays(weekStart)
	const plannedDay = weekDays.find(isToday) ?? weekDays[0]!
	await prisma.mealPlan.create({
		data: {
			householdId: household.id,
			weekStart,
			meals: {
				create: {
					date: plannedDay,
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
	await expect(page.getByRole('link', { name: 'Previous week' })).toBeVisible()
	await expect(page.getByRole('link', { name: 'Next week' })).toBeVisible()
	await expect(page.getByRole('link', { name: 'Prep' })).toHaveCount(0)
	const desktopPlan = page.getByTestId('desktop-plan')
	const dayRailRightEdges = await Promise.all(
		weekDays.map((date) =>
			desktopPlan
				.getByText(isToday(date) ? 'Today' : formatWeekdayName(date), {
					exact: true,
				})
				.evaluate(
					(element) => element.parentElement?.getBoundingClientRect().right,
				),
		),
	)
	expect(
		new Set(dayRailRightEdges.map((edge) => Math.round((edge ?? 0) * 100)))
			.size,
	).toBe(1)

	// 2. Verify the Meal appears in the calendar with its optional label
	await expect(
		desktopPlan.getByText('Test Stir Fry', { exact: true }),
	).toBeVisible()
	await expect(desktopPlan.getByText('Dinner', { exact: true })).toBeVisible()
	await expect(page.getByRole('button', { name: /copy week/i })).toHaveCount(0)
	await expect(
		page.getByRole('button', { name: /suggest meals/i }),
	).toHaveCount(0)

	// 3. Add another Meal through the fast path: Add Meal → pick a Recipe.
	// (Polling the first click instead of networkidle — household-events
	// long-polling never settles.)
	await expect(async () => {
		await desktopPlan
			.getByRole('button', { name: /add meal/i })
			.first()
			.click()
		await expect(
			page.getByPlaceholder('Search recipes...').first(),
		).toBeVisible({ timeout: 2000 })
		await expect(page.getByRole('dialog')).toHaveCount(0)
	}).toPass()
	await page.getByRole('button', { name: /herb salad/i }).click()
	await expect(
		desktopPlan.getByText('Herb Salad', { exact: true }),
	).toBeVisible()
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

	// 4. Mark as cooked (plain toggle — no confirmation dialog)
	await desktopPlan
		.getByRole('button', { name: 'Mark Test Stir Fry as cooked' })
		.click()

	// 5. Verify cooked state (toggle label flips optimistically)
	await expect(
		desktopPlan.getByRole('button', {
			name: 'Mark Test Stir Fry as not cooked',
		}),
	).toBeVisible()

	// 6. Reload to confirm the state persisted — the optimistic flip above
	// would pass even if the server action failed
	await page.reload()
	await expect(
		desktopPlan.getByRole('button', {
			name: 'Mark Test Stir Fry as not cooked',
		}),
	).toBeVisible()

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		if (viewport.width === 390) {
			const mobileDayButtonLocator = page
				.getByTestId('mobile-plan')
				.getByRole('button', {
					name: /^Show .+, (?:no Meals|\d+ Meals?) planned$/,
				})
			await expect(mobileDayButtonLocator).toHaveCount(7)
			const mobileDayButtons = await mobileDayButtonLocator.all()
			for (const dayButton of mobileDayButtons) {
				const box = await dayButton.boundingBox()
				expect(box).not.toBeNull()
				expect(box!.x).toBeGreaterThanOrEqual(0)
				expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
			}
		}
		for (const control of [
			page
				.getByText('Test Stir Fry', { exact: true })
				.filter({ visible: true }),
			page.getByLabel('Scale multiplier').filter({ visible: true }).first(),
		]) {
			await expect(control).toBeVisible()
			const box = await control.boundingBox()
			expect(box).not.toBeNull()
			expect(box!.x).toBeGreaterThanOrEqual(0)
			expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
		}
	}
})
