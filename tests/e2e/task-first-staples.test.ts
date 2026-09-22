import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

async function waitForStaplesHydration(page: Page) {
	const addButton = page.getByRole('button', { name: 'Add Staple' })
	const addInput = page.getByRole('textbox', { name: 'Add a Staple' })
	await expect(async () => {
		if (!(await addInput.isVisible())) await addButton.click()
		await expect(addInput).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15_000 })
	await page.getByRole('button', { name: 'Cancel' }).click()
	await expect(addInput).toBeHidden()
}

test('a large Staples list stays task-first and reachable on a phone', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Large task-first Staples Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const stapleNames = [
		'Apples',
		'Beans',
		'Coffee',
		'Eggs',
		'Flour',
		'Garlic',
		'Honey',
		'Lentils',
		'Milk',
		'Oats',
		'Olive oil',
		'Onions',
		'Pasta',
		'Pepper',
		'Potatoes',
		'Soy sauce',
		'Sugar',
		'Tea',
		'Tomatoes',
		'Tortillas',
		'Vinegar',
		'Yogurt',
		'Zucchini',
		'Baking powder',
		'Cinnamon',
		'Cornmeal',
		'Yeast',
		'Brown rice',
		'Salt',
		'Vanilla',
	]
	await prisma.householdIngredient.createMany({
		data: stapleNames.map((displayName) => ({
			householdId: household.id,
			displayName,
			canonicalKey: displayName.toLocaleLowerCase(),
			isStaple: true,
		})),
	})

	await page.setViewportSize({ width: 390, height: 844 })
	await page.route('**/inventory*', async (route) => {
		if (
			route.request().method() === 'POST' &&
			route.request().postData()?.includes('intent=add-staple-to-shop')
		) {
			await new Promise((resolve) => setTimeout(resolve, 400))
		}
		await route.continue()
	})
	await page.goto('/inventory')
	await waitForStaplesHydration(page)

	const list = page.getByRole('list', { name: 'Staples' })
	await expect(list.getByRole('listitem')).toHaveCount(30)

	const search = page.getByRole('searchbox', { name: 'Search Staples' })
	const addButton = page.getByRole('button', { name: 'Add Staple' })
	const [searchBox, addBox] = await Promise.all([
		search.boundingBox(),
		addButton.boundingBox(),
	])
	expect(searchBox).not.toBeNull()
	expect(addBox).not.toBeNull()
	expect(Math.abs(searchBox!.y - addBox!.y)).toBeLessThanOrEqual(1)
	expect(addBox!.x).toBeGreaterThanOrEqual(searchBox!.x + searchBox!.width)
	await addButton.click()
	await expect(search).toBeHidden()
	await expect(
		page.getByRole('textbox', { name: 'Add a Staple' }),
	).toHaveAttribute('placeholder', 'Staple name')
	await page.getByRole('button', { name: 'Cancel' }).click()
	await expect(search).toBeVisible()

	await search.fill('rice')
	await expect(list.getByRole('listitem')).toHaveCount(1)
	await expect(list.getByText('Brown rice')).toBeVisible()
	await search.fill('missing staple')
	await expect(
		page.getByRole('heading', { name: 'No Staples found' }),
	).toBeVisible()
	await page.getByRole('button', { name: 'Clear search' }).click()

	const response = page.waitForResponse(
		(candidate) =>
			candidate.request().method() === 'POST' &&
			candidate.request().postData()?.includes('intent=add-staple-to-shop') ===
				true,
	)
	const applesButton = page.getByRole('button', {
		name: 'Add Apples to Next shop',
	})
	await applesButton.click()
	await expect(applesButton).toBeFocused()
	await response
	await expect(
		page.getByRole('status').filter({
			hasText: 'Apples was added to Next shop.',
		}),
	).toBeVisible()
	// The row is still where it was: adding to the shop is not a state change.
	await expect(applesButton).toBeFocused()
	await expect(list.getByRole('listitem')).toHaveCount(30)

	const finalRow = list.getByRole('listitem').filter({ hasText: 'Zucchini' })
	await finalRow.scrollIntoViewIfNeeded()
	const bottomNav = page
		.getByRole('navigation', { name: 'Main' })
		.filter({ has: page.getByRole('link', { name: 'Shop', exact: true }) })
	const [rowBox, navBox] = await Promise.all([
		finalRow.boundingBox(),
		bottomNav.boundingBox(),
	])
	expect(rowBox).not.toBeNull()
	expect(navBox).not.toBeNull()
	expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(navBox!.y)
})
