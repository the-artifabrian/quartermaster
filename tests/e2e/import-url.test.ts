import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { E2E_MISSING_URL, E2E_RECIPE_URL } from '#tests/mocks/recipe-pages.ts'
import { expect, test } from '#tests/playwright-utils.ts'

const sharedUrl = `${E2E_RECIPE_URL}?utm_source=share`

function importPage(url: string) {
	return `/recipes/import?url=${encodeURIComponent(url)}`
}

function countFetches(page: Page) {
	const count = { fetches: 0 }
	page.on('request', (request) => {
		if (
			request.method() === 'POST' &&
			/\/recipes\/import/.test(request.url()) &&
			new URLSearchParams(request.postData() ?? '').get('intent') === 'fetch'
		)
			count.fetches++
	})
	return count
}

test('a shared URL fetches once, back skips it, and a second share saves', async ({
	page,
	login,
}) => {
	const user = await login()
	const count = countFetches(page)
	const review = page.getByRole('heading', {
		name: 'Shared chickpea lunch',
		exact: true,
	})

	await page.goto('/recipes')
	await page.goto(importPage(sharedUrl))
	await expect(review).toBeVisible()
	await expect(page.getByLabel('Recipe overview')).toContainText(
		'2 cans chickpeas',
	)
	await expect(page).toHaveURL(/\/recipes\/import$/)
	expect(count.fetches).toBe(1)

	// The fetch replaced the shared entry, so back skips it.
	await page.goBack()
	await expect(page).toHaveURL(/\/recipes$/)
	expect(count.fetches).toBe(1)

	// Forward lands on the replaced entry: the bare import page, no review.
	await page.goForward()
	await expect(page).toHaveURL(/\/recipes\/import$/)
	await expect(page.getByLabel('Recipe URL', { exact: true })).toHaveValue('')
	await expect(
		page.getByRole('button', { name: 'Fetch Recipe', exact: true }),
	).toBeEnabled()
	await expect(review).toHaveCount(0)
	expect(count.fetches).toBe(1)

	await page.goto(importPage(sharedUrl))
	await expect(review).toBeVisible()
	expect(count.fetches).toBe(2)
	await page.getByRole('button', { name: 'Save Recipe', exact: true }).click()
	await expect(page).toHaveURL(/\/recipes\/(?!import$)[a-z0-9]+$/)
	await expect(review).toBeVisible()
	const recipes = await prisma.recipe.findMany({
		where: { userId: user.id },
		include: { ingredients: { orderBy: { order: 'asc' } }, instructions: true },
	})
	expect(recipes).toHaveLength(1)
	expect(recipes[0]).toMatchObject({
		title: 'Shared chickpea lunch',
		sourceUrl: sharedUrl,
		ingredients: [
			expect.objectContaining({ amount: '2', name: 'chickpeas' }),
			expect.objectContaining({ amount: '1', name: 'lemon' }),
		],
		instructions: [
			expect.objectContaining({
				content: 'Toss the chickpeas with lemon juice and serve.',
			}),
		],
	})
})

test('a shared URL that fails to fetch stays on the filled URL tab', async ({
	page,
	login,
}) => {
	await login()
	const count = countFetches(page)
	await page.goto(importPage(E2E_MISSING_URL))
	await expect(page.getByText('Failed to fetch URL (404)')).toBeVisible()
	await expect(page.getByLabel('Recipe URL', { exact: true })).toHaveValue(
		E2E_MISSING_URL,
	)
	await expect(page.getByLabel('Recipe overview')).toHaveCount(0)
	await expect(page).toHaveURL(/\/recipes\/import$/)
	expect(count.fetches).toBe(1)
})
