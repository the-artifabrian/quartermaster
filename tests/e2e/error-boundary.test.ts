/**
 * A link to a Recipe or Menu that isn't there says so in the app, with the
 * tabs still around it, instead of the raw "404 Recipe not found".
 *
 * Failure list:
 * - A missing Recipe or Menu still shows the raw status line, or the
 *   generic title "Quartermaster".
 * - The page answers 200, so a crawler or a link preview reads it as real.
 * - A Recipe in another Household (which answers 403) shows something other
 *   than a missing one does.
 * - The message only shows on a full load: a Recipe deleted after the list
 *   loaded, opened from that list, still gets the raw line.
 * - The edit screens of a missing Recipe or Menu are left out.
 * - The way back goes somewhere other than the list it belongs to.
 * - A 404 from an action on a Recipe that is still there (an ingredient
 *   another member removed, then added to Shopping) shows the not-found page
 *   over that Recipe.
 * - The Recipe boundary hides the offline notice for pages the device hasn't
 *   loaded (covered in offline-tabs.test.ts).
 */
import { prisma } from '#app/utils/db.server.ts'
import { expect, test, waitForHydration } from '#tests/playwright-utils.ts'

test('Test root error boundary caught', async ({ page, navigate }) => {
	const pageUrl = '/does-not-exist'
	const res = await navigate(pageUrl as any)

	expect(res?.status()).toBe(404)
	await expect(
		page.getByRole('heading', { name: /page not found/i }),
	).toBeVisible()
})

test('a missing Recipe, or one from another Household, says it isn’t in this Household', async ({
	page,
	login,
	insertNewUser,
}) => {
	// Four full page loads, each building the page server-side, which a busy
	// runner can stretch past the default 15 seconds.
	test.slow()
	await login()
	const stranger = await insertNewUser()
	const household = await prisma.household.create({
		data: {
			name: 'Someone else’s',
			members: { create: { userId: stranger.id, role: 'owner' } },
		},
	})
	const theirs = await prisma.recipe.create({
		data: {
			title: 'Their soup',
			userId: stranger.id,
			householdId: household.id,
		},
	})

	for (const [path, status] of [
		['/recipes/no-such-recipe', 404],
		[`/recipes/${theirs.id}`, 403],
		['/recipes/no-such-recipe/edit', 404],
		[`/recipes/${theirs.id}/edit`, 403],
	] as const) {
		const response = await page.goto(path)
		expect(response?.status()).toBe(status)
		await expect(
			page.getByRole('heading', { name: 'Recipe not found' }),
		).toBeVisible()
		await expect(
			page.getByText('This Recipe isn’t in your Household.', { exact: false }),
		).toBeVisible()
		await expect(page).toHaveTitle('Recipe not found | Quartermaster')
		await expect(page.getByText('Their soup')).toHaveCount(0)
		await expect(page.getByText('404')).toHaveCount(0)
	}

	await waitForHydration(page)
	await page.getByRole('link', { name: 'Back to Recipes' }).click()
	await expect(page).toHaveURL(/\/recipes$/)
})

test('a Recipe deleted after the list loaded says so when opened from the list', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Soon gone',
			userId: user.id,
			householdId: user.householdId,
		},
	})
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/recipes')
	await waitForHydration(page)
	const card = page.getByRole('link', { name: /Soon gone/ })
	await expect(card).toBeVisible()
	await prisma.recipe.delete({ where: { id: recipe.id } })

	await card.click()
	await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}$`))
	await expect(
		page.getByRole('heading', { name: 'Recipe not found' }),
	).toBeVisible()
	await expect(page).toHaveTitle('Recipe not found | Quartermaster')
	// The tabs stay, so there is a way on from here.
	await expect(
		page.locator('[data-bottom-nav]').getByRole('link', { name: 'Recipes' }),
	).toBeVisible()
})

test('a missing Menu says it isn’t in this Household and goes back to Menus', async ({
	page,
	login,
}) => {
	await login()
	for (const path of [
		'/recipes/menus/no-such-menu',
		'/recipes/menus/no-such-menu/edit',
	]) {
		const response = await page.goto(path)
		expect(response?.status()).toBe(404)
		await expect(
			page.getByRole('heading', { name: 'Menu not found' }),
		).toBeVisible()
		await expect(
			page.getByText('This Menu isn’t in your Household.', { exact: false }),
		).toBeVisible()
		await expect(page).toHaveTitle('Menu not found | Quartermaster')
	}

	await waitForHydration(page)
	await page.getByRole('link', { name: 'Back to Menus' }).click()
	await expect(page).toHaveURL(/\/recipes\/menus$/)
})

test('adding an ingredient another member removed keeps the Recipe on screen', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Still here',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: [
					{ name: 'leeks', amount: '2', order: 0 },
					{ name: 'butter', amount: '1', unit: 'tbsp', order: 1 },
				],
			},
		},
		include: { ingredients: true },
	})
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`/recipes/${recipe.id}`)
	await waitForHydration(page)
	const leeks = page.getByRole('checkbox', { name: 'leeks', exact: true })
	await expect(leeks).toBeVisible()
	await prisma.ingredient.delete({
		where: { id: recipe.ingredients.find((i) => i.name === 'leeks')!.id },
	})

	await leeks.getByRole('button', { name: 'Add to Shopping' }).click()
	await expect(
		page.getByText('That ingredient isn’t in this Recipe any more.'),
	).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Still here' })).toBeVisible()
	await expect(
		page.getByRole('heading', { name: 'Recipe not found' }),
	).toHaveCount(0)
	expect(
		await prisma.shoppingListItem.count({
			where: { list: { householdId: user.householdId } },
		}),
	).toBe(0)
})
