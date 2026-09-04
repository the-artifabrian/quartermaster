import { getCurrentWeekStart, getWeekDays, isToday } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('Plan loads shared Recipe and Menu choices only when a phone user asks', async ({
	page,
	login,
}) => {
	await page.setViewportSize({ width: 390, height: 844 })
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Lazy Plan choices E2E Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const recipes = await Promise.all(
		['Anchor Pasta', 'Crisp Salad', 'Warm Bread'].map((title) =>
			prisma.recipe.create({
				data: { title, userId: user.id, householdId: household.id },
			}),
		),
	)
	const anchorRecipe = recipes[0]!
	const addMealRecipe = recipes[1]!
	const addAnotherRecipe = recipes[2]!
	const weekStart = getCurrentWeekStart()
	const plannedDay = getWeekDays(weekStart).find(isToday) ?? weekStart
	const anchorMeal = await prisma.meal.create({
		data: {
			mealPlan: { create: { householdId: household.id, weekStart } },
			date: plannedDay,
			order: 0,
			recipeItems: {
				create: {
					order: 0,
					recipeId: anchorRecipe.id,
					recipeTitle: anchorRecipe.title,
				},
			},
		},
	})

	let choiceRequestCount = 0
	let releaseFirstRequest = () => {}
	const firstRequestGate = new Promise<void>((resolve) => {
		releaseFirstRequest = resolve
	})
	await page.route('**/resources/plan-choices', async (route) => {
		choiceRequestCount++
		if (choiceRequestCount === 1) {
			await firstRequestGate
			await route.continue()
			return
		}
		if (choiceRequestCount === 2 || choiceRequestCount === 3) {
			await route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'Injected choice failure' }),
			})
			return
		}
		await route.continue()
	})

	await page.goto('/plan')
	const mobile = page.getByTestId('mobile-plan')
	async function openAddMeal() {
		const composer = mobile.getByRole('region', { name: /^Add Meal for/ })
		await expect(async () => {
			if (!(await composer.isVisible())) {
				await mobile.getByRole('button', { name: /^Add Meal to/ }).click()
			}
			await expect(composer).toBeVisible({ timeout: 1000 })
		}).toPass()
		return composer
	}
	await expect(mobile.getByText('Anchor Pasta', { exact: true })).toBeVisible()
	expect(choiceRequestCount).toBe(0)

	let composer = await openAddMeal()
	await expect(composer.getByRole('status')).toHaveText(
		'Loading Recipes and Menus…',
	)
	await expect(
		composer.getByRole('button', { name: /Add text instead/ }),
	).toBeEnabled()
	await expect.poll(() => choiceRequestCount).toBe(1)
	releaseFirstRequest()
	await expect(
		composer.getByPlaceholder('Search Recipes and Menus...'),
	).toBeVisible()

	await composer.getByRole('button', { name: 'Close picker' }).click()
	composer = await openAddMeal()
	await expect(
		composer.getByPlaceholder('Search Recipes and Menus...'),
	).toBeVisible()
	expect(choiceRequestCount).toBe(1)

	await page.goto('/shopping')
	await page.goto('/plan')
	await expect(mobile.getByText('Anchor Pasta', { exact: true })).toBeVisible()
	composer = await openAddMeal()
	await expect(composer.getByRole('alert')).toContainText(
		'Couldn’t load Recipes and Menus',
	)
	expect(choiceRequestCount).toBe(2)

	await composer.getByRole('button', { name: /Add text instead/ }).click()
	await composer.getByRole('textbox', { name: 'Meal text' }).fill('Leftovers')
	await composer.getByRole('button', { name: 'Add', exact: true }).click()
	await expect(mobile.getByText('Leftovers', { exact: true })).toBeVisible()

	composer = await openAddMeal()
	await expect(composer.getByRole('alert')).toContainText(
		'Couldn’t load Recipes and Menus',
	)
	expect(choiceRequestCount).toBe(3)
	await composer.getByRole('button', { name: 'Try again' }).click()
	await expect(
		composer.getByPlaceholder('Search Recipes and Menus...'),
	).toBeVisible()
	expect(choiceRequestCount).toBe(4)
	await composer.getByRole('button', { name: /Crisp Salad/ }).click()
	await expect(mobile.getByText('Crisp Salad', { exact: true })).toBeVisible()

	await mobile
		.getByRole('button', { name: 'Meal actions for Anchor Pasta' })
		.click()
	await page.getByRole('menuitem', { name: 'Add Recipe' }).click()
	const recipeSearch = mobile.getByPlaceholder('Search recipes...')
	await expect(recipeSearch).toBeVisible()
	await expect(
		mobile.getByRole('button', { name: 'Anchor Pasta', exact: true }),
	).toHaveCount(0)
	await mobile.getByRole('button', { name: /Warm Bread/ }).click()
	await expect
		.poll(() =>
			prisma.mealRecipeItem.count({
				where: { mealId: anchorMeal.id, recipeId: addAnotherRecipe.id },
			}),
		)
		.toBe(1)
	expect(choiceRequestCount).toBe(4)
	await expect
		.poll(() =>
			prisma.meal.count({
				where: {
					mealPlan: { householdId: household.id },
					recipeItems: { some: { recipeId: addMealRecipe.id } },
				},
			}),
		)
		.toBe(1)
})
