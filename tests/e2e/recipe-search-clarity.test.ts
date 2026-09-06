import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

for (const width of [390, 1280]) {
	test(`Recipe restrictions, reset and navigation at ${width}px`, async ({
		page,
		login,
	}) => {
		test.setTimeout(40_000)
		await page.setViewportSize({ width, height: 900 })
		const user = await login()
		const household = await prisma.household.create({
			data: {
				name: 'Search clarity',
				staplesCutoverAt: new Date(),
				members: { create: { userId: user.id, role: 'owner' } },
			},
		})
		for (const [title, totalTime, isFavorite] of [
			['Walnut pasta', 25, false],
			['Chickpea lunch', null, true],
			['Lemon rice', 30, true],
			['Slow roast', 120, false],
		] as const) {
			await prisma.recipe.create({
				data: {
					title,
					totalTime,
					isFavorite,
					userId: user.id,
					householdId: household.id,
					ingredients: {
						create: {
							name: title === 'Walnut pasta' ? 'walnuts' : 'rice',
							order: 0,
						},
					},
					instructions: { create: { content: 'Prepare and serve.', order: 0 } },
				},
			})
		}
		const search = page.getByRole('searchbox', {
			name: 'Search by name or ingredient',
		})
		const reset = page
			.getByRole('button', { name: 'Clear search and filters', exact: true })
			.first()
		await page.goto('/recipes?favorites=true&search=Walnut&sort=alphabetical')
		await expect(
			page.getByText('Saved Recipes may be excluded by your active filters.'),
		).toBeVisible()
		await expect(
			page.getByText('Favorites', { exact: true }).last(),
		).toBeVisible()
		if (width === 390)
			await expect(
				page.getByRole('button', { name: 'Toggle filters' }),
			).toHaveAttribute('aria-expanded', 'false')
		await reset.focus()
		await reset.press('Enter')
		await expect(page).toHaveURL(/\/recipes\?sort=alphabetical$/)
		await expect(search).toHaveValue('')
		await expect(
			page.getByRole('heading', { name: 'Walnut pasta' }),
		).toBeVisible()
		await expect(page.getByText('Time unknown')).toHaveCount(0)

		await page.goto('/recipes?maxTime=30')
		await expect(page.getByText('Up to 30 min')).toBeVisible()
		await expect(
			page.getByText('Time unknown').filter({ visible: true }),
		).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Lemon rice' }),
		).toBeVisible()
		await expect(page.getByRole('heading', { name: 'Slow roast' })).toHaveCount(
			0,
		)
		// Reset must cancel the pending search, not just the currently rendered query.
		await search.fill('Walnut')
		await reset.click()
		await page.waitForTimeout(400)
		await expect(page).toHaveURL(/\/recipes$/)
		await expect(search).toHaveValue('')

		if (width === 390)
			await page.getByRole('button', { name: 'Toggle filters' }).click()
		await search.fill('Walnut')
		await page.getByRole('button', { name: 'Show favorites only' }).click()
		await expect(page).toHaveURL(/search=Walnut&favorites=true/)
		await page.waitForTimeout(400)
		await expect(page).toHaveURL(/search=Walnut&favorites=true/)
		await search.fill('')
		await expect(page).toHaveURL(/favorites=true$/)
		await expect(
			page.getByRole('heading', { name: 'Walnut pasta' }),
		).toHaveCount(0)
		await reset.click()
		await search.fill('Walnut')
		await expect(page).toHaveURL(/search=Walnut$/)
		await page.getByRole('heading', { name: 'Walnut pasta' }).click()
		await expect(
			page.getByRole('heading', { name: 'Ingredients', exact: true }),
		).toBeVisible()
		await page.goBack()
		await expect(search).toHaveValue('Walnut')
		await expect(
			page.getByRole('heading', { name: 'Walnut pasta' }),
		).toBeVisible()

		await page.goto('/recipes?quality=flagged')
		await expect(
			page.getByText('Flagged Recipes', { exact: true }),
		).toBeVisible()
		await reset.click()
		await expect(
			page.getByRole('heading', { name: 'Walnut pasta' }),
		).toBeVisible()
	})
}
