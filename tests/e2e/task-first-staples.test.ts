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
			staplesCutoverAt: new Date(),
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const availableNames = [
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
	]
	const outNames = ['Brown rice', 'Salt', 'Vanilla']
	await prisma.householdIngredient.createMany({
		data: [
			...availableNames.map((displayName) => ({
				householdId: household.id,
				displayName,
				canonicalKey: displayName.toLocaleLowerCase(),
				isStaple: true,
				isOut: false,
			})),
			...outNames.map((displayName) => ({
				householdId: household.id,
				displayName,
				canonicalKey: displayName.toLocaleLowerCase(),
				isStaple: true,
				isOut: true,
			})),
		],
	})

	await page.setViewportSize({ width: 390, height: 844 })
	await page.route('**/inventory*', async (route) => {
		if (
			route.request().method() === 'POST' &&
			route.request().postData()?.includes('intent=toggle-staple-out')
		) {
			await new Promise((resolve) => setTimeout(resolve, 400))
		}
		await route.continue()
	})
	await page.goto('/inventory')
	await waitForStaplesHydration(page)

	const outGroup = page.getByRole('region', { name: 'Out' })
	const availableGroup = page.getByRole('region', { name: 'Usually available' })
	await expect(outGroup.getByLabel('3 Out Staples')).toBeVisible()
	await expect(
		availableGroup.getByLabel('27 usually available Staples'),
	).toBeVisible()
	const [outBox, availableBox] = await Promise.all([
		outGroup.boundingBox(),
		availableGroup.boundingBox(),
	])
	expect(outBox?.y).toBeLessThan(availableBox?.y ?? 0)

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
	await expect(outGroup.getByText('Brown rice')).toBeVisible()
	await expect(outGroup.getByLabel('1 Out Staple')).toBeVisible()
	await expect(
		availableGroup.getByLabel('0 usually available Staples'),
	).toBeVisible()
	await search.fill('missing staple')
	await expect(
		page.getByRole('heading', { name: 'No Staples found' }),
	).toBeVisible()
	await page.getByRole('button', { name: 'Clear search' }).click()

	const response = page.waitForResponse(
		(candidate) =>
			candidate.request().method() === 'POST' &&
			candidate.request().postData()?.includes('intent=toggle-staple-out') ===
				true,
	)
	await page.getByRole('button', { name: 'Mark Apples Out' }).click()
	const movedButton = page.getByRole('button', {
		name: 'Mark Apples available',
	})
	await expect(outGroup.getByText('Apples')).toBeVisible()
	await expect(movedButton).toBeFocused()
	await response
	await expect(
		page.getByRole('status').filter({
			hasText: 'Apples was added to Next shop.',
		}),
	).toBeVisible()
	await expect(movedButton).toBeFocused()

	const finalRow = availableGroup
		.getByRole('listitem')
		.filter({ hasText: 'Zucchini' })
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
