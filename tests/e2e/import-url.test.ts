import { prisma } from '#app/utils/db.server.ts'
import { E2E_RECIPE_PATH } from '#tests/mocks/recipe-pages.ts'
import { expect, test } from '#tests/playwright-utils.ts'

// A real public host: the import resolves it with real DNS before the mock
// answers the request.
const sharedUrl = `https://example.com${E2E_RECIPE_PATH}?utm_source=share`

test('a shared URL fetches once, saves, and back shows an empty import form', async ({
	page,
	login,
}) => {
	const user = await login()
	let fetches = 0
	page.on('request', (request) => {
		if (
			request.method() === 'POST' &&
			/\/recipes\/import/.test(request.url()) &&
			new URLSearchParams(request.postData() ?? '').get('intent') === 'fetch'
		)
			fetches++
	})

	await page.goto(`/recipes/import?url=${encodeURIComponent(sharedUrl)}`)
	await expect(
		page.getByRole('heading', { name: 'Shared chickpea lunch', exact: true }),
	).toBeVisible()
	await expect(page.getByLabel('Recipe overview')).toContainText(
		'2 cans chickpeas',
	)
	// The fetch replaced the shared entry, so the address drops the URL.
	await expect(page).toHaveURL(/\/recipes\/import$/)
	expect(fetches).toBe(1)

	await page.getByRole('button', { name: 'Save Recipe', exact: true }).click()
	await expect(page).toHaveURL(/\/recipes\/(?!import$)[a-z0-9]+$/)
	await expect(
		page.getByRole('heading', { name: 'Shared chickpea lunch', exact: true }),
	).toBeVisible()
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

	// Back lands on the bare import page: an empty URL form, no review, and
	// no second fetch.
	const backLoad = page.waitForResponse(
		(response) =>
			response.request().method() === 'GET' &&
			/\/recipes\/import\.data/.test(response.url()),
	)
	await page.goBack()
	await backLoad
	await expect(page).toHaveURL(/\/recipes\/import$/)
	await expect(page.getByLabel('Recipe URL', { exact: true })).toHaveValue('')
	// Give a mount effect the chance to post before counting.
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => setTimeout(resolve, 100)),
			),
	)
	await expect(
		page.getByRole('button', { name: 'Fetch Recipe', exact: true }),
	).toBeEnabled()
	await expect(
		page.getByRole('heading', { name: 'Shared chickpea lunch', exact: true }),
	).toHaveCount(0)
	await expect(page.getByLabel('Recipe overview')).toHaveCount(0)
	expect(fetches).toBe(1)
})

test('a non-web url param leaves the import page as it is', async ({
	page,
	login,
}) => {
	await login()
	let fetches = 0
	page.on('request', (request) => {
		if (request.method() === 'POST' && /\/recipes\/import/.test(request.url()))
			fetches++
	})
	await page.goto(
		`/recipes/import?url=${encodeURIComponent('javascript:alert(1)')}`,
	)
	await expect(page.getByLabel('Recipe URL', { exact: true })).toHaveValue('')
	await page.waitForLoadState('networkidle')
	await expect(page.getByLabel('Recipe overview')).toHaveCount(0)
	expect(fetches).toBe(0)
})
