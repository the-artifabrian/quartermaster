import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('Menu cooking carries each card scale without changing saved quantities', async ({
	page,
	login,
}) => {
	test.setTimeout(60_000)
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Menu cooking household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Hummus',
			userId: user.id,
			householdId: household.id,
			yieldAmount: 4,
			yieldLabel: 'bowls',
			ingredients: {
				create: { name: 'chickpeas', amount: '400', unit: 'g', order: 0 },
			},
		},
	})
	const menu = await prisma.menu.create({
		data: {
			title: 'Hummus dinner',
			titleKey: 'hummus dinner',
			householdId: household.id,
			sections: {
				create: {
					items: {
						create: [2, 0.5, 1].map((scaleMultiplier, order) => ({
							kind: 'recipe',
							recipeId: recipe.id,
							recipeTitle: recipe.title,
							scaleMultiplier,
							order,
						})),
					},
				},
			},
		},
	})
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		for (const [index, scale] of [2, 0.5, 1].entries()) {
			await page.goto(`/recipes/menus/${menu.id}`)
			const card = page.getByRole('link', { name: /Hummus.*makes/ }).nth(index)
			await expect(card).toContainText(`${scale}× · makes ${4 * scale} bowls`)
			await card.click()
			await expect(
				page.getByRole('button', { name: `Scale ${scale}×` }),
			).toBeVisible()
			await expect(
				page.getByText(`Makes ${4 * scale} bowls`, { exact: true }),
			).toBeVisible()
			await expect(
				page.getByRole('checkbox', { name: /chickpeas/ }),
			).toContainText(`${400 * scale} g chickpeas`)
			if (scale !== 1) {
				await page.getByRole('button', { name: `Scale ${scale}×` }).click()
				await page.getByRole('button', { name: 'Original 1×' }).click()
				await expect(
					page.getByRole('button', { name: 'Scale 1×' }),
				).toBeVisible()
			}
		}
		await page.goto('/recipes')
		await page.getByRole('link', { name: /Hummus/ }).click()
		await expect(page.getByRole('button', { name: 'Scale 1×' })).toBeVisible()
	}

	expect(
		await prisma.menuItem.findMany({
			where: { section: { menuId: menu.id } },
			orderBy: { order: 'asc' },
			select: { scaleMultiplier: true },
		}),
	).toEqual([2, 0.5, 1].map((scaleMultiplier) => ({ scaleMultiplier })))
	expect(
		await prisma.meal.count({
			where: { mealPlan: { householdId: household.id } },
		}),
	).toBe(0)
	expect(
		await prisma.shoppingListItem.count({
			where: { list: { householdId: household.id } },
		}),
	).toBe(0)

	// Compare the existing planned-Meal link with the direct Menu journey.
	await page.goto(`/recipes/menus/${menu.id}`)
	await page.getByRole('button', { name: 'Add to Plan' }).click()
	await page.getByRole('button', { name: 'Add to Plan' }).click()
	await expect(page).toHaveURL(/\/plan\?weekStart=/)
	await page
		.getByRole('link', { name: 'Hummus', exact: true })
		.filter({ visible: true })
		.first()
		.click()
	await expect(page.getByRole('button', { name: 'Scale 2×' })).toBeVisible()
	await page.getByRole('button', { name: 'Scale 2×' }).click()
	await page.getByRole('button', { name: 'Original 1×' }).click()
	expect(
		await prisma.mealRecipeItem.findMany({
			where: { meal: { sourceMenuId: menu.id } },
			orderBy: { order: 'asc' },
			select: { scaleMultiplier: true },
		}),
	).toEqual([2, 0.5, 1].map((scaleMultiplier) => ({ scaleMultiplier })))
})
