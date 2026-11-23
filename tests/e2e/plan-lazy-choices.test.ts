import {
	getWeekDays,
	getWeekStart,
	isToday,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { browserToday, expect, test } from '#tests/playwright-utils.ts'

test('Plan loads shared Recipe and Menu choices only when a phone user asks', async ({
	page,
	login,
}) => {
	await page.setViewportSize({ width: 390, height: 844 })
	const user = await login()
	const recipes = await Promise.all(
		['Anchor Pasta', 'Crisp Salad', 'Warm Bread'].map((title) =>
			prisma.recipe.create({
				data: { title, userId: user.id, householdId: user.householdId },
			}),
		),
	)
	const anchorRecipe = recipes[0]!
	const addMealRecipe = recipes[1]!
	const addAnotherRecipe = recipes[2]!
	const weekStart = getWeekStart(browserToday())
	const plannedDay =
		getWeekDays(weekStart).find((date) =>
			isToday(date, serializeDate(browserToday())),
		) ?? weekStart
	const anchorMeal = await prisma.meal.create({
		data: {
			mealPlan: { create: { householdId: user.householdId, weekStart } },
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
		// On a phone the composer is a sheet over the day.
		const composer = page.getByRole('dialog', { name: 'Add a Meal' })
		await expect(async () => {
			if (!(await composer.isVisible())) {
				await page.getByRole('button', { name: /^Add Meal to/ }).click()
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

	await composer.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(composer).toBeHidden()
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
	await expect(composer).toBeHidden()
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
	await expect(composer).toBeHidden()
	await expect(mobile.getByText('Crisp Salad', { exact: true })).toBeVisible()

	const anchorCard = mobile.locator(`[data-meal-id="${anchorMeal.id}"]`)
	const addRecipe = anchorCard.getByRole('button', {
		name: 'Add Recipe to Anchor Pasta',
	})
	await addRecipe.click()
	// A sheet over the Meal on a phone.
	const recipeSheet = page.getByRole('dialog', { name: 'Add a Recipe' })
	const recipeSearch = recipeSheet.getByPlaceholder('Search recipes...')
	await expect(recipeSearch).toBeVisible()
	await expect(
		recipeSheet.getByRole('button', { name: 'Anchor Pasta', exact: true }),
	).toHaveCount(0)
	await recipeSheet.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(recipeSheet).toBeHidden()
	await expect(addRecipe).toBeFocused()

	await addRecipe.click()
	await recipeSheet.getByRole('button', { name: /Warm Bread/ }).click()
	await expect(recipeSheet).toBeHidden()
	await expect(
		anchorCard.getByText('Anchor Pasta', { exact: true }),
	).toBeVisible()
	await expect(
		anchorCard.getByText('Warm Bread', { exact: true }),
	).toBeVisible()
	await expect(
		anchorCard.getByRole('button', { name: /^Add Recipe to/ }),
	).toBeVisible()
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
					mealPlan: { householdId: user.householdId },
					recipeItems: { some: { recipeId: addMealRecipe.id } },
				},
			}),
		)
		.toBe(1)
})
