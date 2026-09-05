import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

const original = `Chickpea lunch
Ingredients
2 cans chickpeas, drained and rinsed thoroughly under cold running water (reserve the liquid for another recipe; if using dried chickpeas instead, soak them overnight and simmer until completely tender before measuring the equivalent cooked weight)
1 lemon
Instructions
Toss the chickpeas with lemon juice and serve.`

test('correct import, fail validation and connection, then save once with original source', async ({
	page,
	login,
}) => {
	const user = await login()
	let extracts = 0
	let saves = 0
	page.on('request', (request) => {
		if (
			request.method() !== 'POST' ||
			!/\/(recipes\/import|resources\/save-import)/.test(request.url())
		)
			return
		if (request.headers()['accept'] === 'application/json') saves++
		else extracts++
	})
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/recipes/import')
	await page.getByRole('button', { name: 'From Text', exact: true }).click()
	await page.getByLabel('Recipe text', { exact: true }).fill(original)
	await page.getByRole('button', { name: 'Parse Recipe', exact: true }).click()
	await page
		.getByRole('heading', { name: 'Review Recipe', exact: true })
		.waitFor()
	await page.getByRole('button', { name: /^2 cans chickpeas/ }).click()
	await expect(page.getByPlaceholder('Notes (e.g., diced)')).toHaveValue(
		/equivalent cooked weight/,
	)
	await page.getByPlaceholder('Amount', { exact: true }).fill('3')
	await page
		.getByPlaceholder('Step 1')
		.fill('Serve the chickpeas with extra lemon.')
	await page.getByLabel('Title', { exact: true }).fill('')
	await page.getByRole('button', { name: 'Save Recipe', exact: true }).click()
	await expect(page.getByRole('alert')).toContainText('Title is required')
	await expect(page.getByPlaceholder('Amount', { exact: true })).toHaveValue(
		'3',
	)
	await expect(page.getByPlaceholder('Step 1')).toHaveValue(
		'Serve the chickpeas with extra lemon.',
	)
	await page
		.getByLabel('Title', { exact: true })
		.fill('Reviewed chickpea lunch')
	await page.route('**/resources/save-import', (route) =>
		route.request().method() === 'POST'
			? route.abort('failed')
			: route.continue(),
	)
	await page.getByRole('button', { name: 'Save Recipe', exact: true }).click()
	await expect(page.getByRole('alert')).toContainText(
		'Save could not be confirmed',
	)
	await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
		'Reviewed chickpea lunch',
	)
	await page.unroute('**/resources/save-import')
	await page
		.getByRole('button', { name: 'Save Recipe', exact: true })
		.evaluate((button: HTMLButtonElement) => {
			button.click()
			button.click()
		})
	await expect(page).toHaveURL(/\/recipes\/(?!import$)[a-z0-9]+$/)
	await page.reload()
	await expect(
		page.getByRole('heading', { name: 'Reviewed chickpea lunch', exact: true }),
	).toBeVisible()
	const source = page
		.locator('details')
		.filter({ has: page.locator('summary', { hasText: 'Original input' }) })
	await expect(source).not.toHaveAttribute('open', '')
	await source.locator('summary').click()
	await expect(source.locator('pre')).toHaveText(original)
	const recipes = await prisma.recipe.findMany({
		where: { userId: user.id },
		include: { ingredients: { orderBy: { order: 'asc' } }, instructions: true },
	})
	expect(recipes).toHaveLength(1)
	expect(recipes[0]).toMatchObject({
		rawText: original,
		ingredients: [
			expect.objectContaining({ amount: '3', name: 'chickpeas' }),
			expect.objectContaining({ name: 'lemon' }),
		],
		instructions: [
			expect.objectContaining({
				content: 'Serve the chickpeas with extra lemon.',
			}),
		],
	})
	expect(extracts).toBe(1)
	expect(saves).toBe(3)
})
