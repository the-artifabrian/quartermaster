import { serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { SAMPLE_HOUSEHOLD } from '#app/utils/sample-household-data.ts'
import { fillSampleHousehold } from '#app/utils/sample-household.server.ts'
import { browserToday, expect, test } from '#tests/playwright-utils.ts'

/**
 * The sample Household `prisma db seed` builds, as its owner sees it: the
 * Recipes, this week's Plan and the Shopping it leads to. The builder fills
 * the login fixture's own Household, so the fixture cleans it up and no other
 * test sees it.
 */
test('the sample Household shows its Recipes, this week’s Plan and its Shopping', async ({
	page,
	login,
}) => {
	const user = await login()
	const today = serializeDate(browserToday())
	await fillSampleHousehold(prisma, {
		userId: user.id,
		householdId: user.householdId,
		today,
	})
	// The timezone hint the page would set on its first visit, so the first
	// load already opens on the seeded week.
	await page.context().addCookies([
		{
			name: 'CH-time-zone',
			value: encodeURIComponent(
				Intl.DateTimeFormat().resolvedOptions().timeZone,
			),
			domain: 'localhost',
			path: '/',
		},
	])

	await page.goto('/recipes')
	const main = page.getByRole('main')
	for (const recipe of SAMPLE_HOUSEHOLD.recipes) {
		await expect(main.getByText(recipe.title, { exact: true })).toBeVisible()
	}
	expect(
		await prisma.recipe.count({ where: { householdId: user.householdId } }),
	).toBe(SAMPLE_HOUSEHOLD.recipes.length)

	await page.goto('/plan')
	for (const title of ['Lemon chicken traybake', 'Black bean tacos']) {
		await expect(main.getByRole('heading', { name: title })).toBeVisible()
	}
	await expect(
		main.getByRole('button', { name: 'Meal actions for Leftovers' }),
	).toBeVisible()
	const meals = await prisma.meal.findMany({
		where: { mealPlan: { householdId: user.householdId } },
		select: { date: true },
	})
	expect(meals).toHaveLength(SAMPLE_HOUSEHOLD.plan.length)

	await page.goto('/shopping')
	for (const name of ['spaghetti', 'coffee beans']) {
		await expect(
			main.getByRole('button', { name: `Uncheck ${name}`, exact: true }),
		).toHaveAttribute('aria-pressed', 'true')
	}
	for (const name of ['chickpeas', 'dish soap']) {
		await expect(
			main.getByRole('button', { name: `Check off ${name}`, exact: true }),
		).toBeVisible()
	}
	// A Staple stays off.
	await expect(
		main.getByRole('group', { name: 'olive oil shopping item', exact: true }),
	).toHaveCount(0)
	const rows = await prisma.shoppingListItem.findMany({
		where: { list: { householdId: user.householdId }, checked: true },
		select: { name: true },
		orderBy: { name: 'asc' },
	})
	expect(rows.map((row) => row.name)).toEqual(['coffee beans', 'spaghetti'])
})
