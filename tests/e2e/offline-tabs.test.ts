import { type Page, type Request } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { SHELL_UA } from '#tests/native-shell.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.use({ userAgent: SHELL_UA, viewport: { width: 390, height: 844 } })

const NOT_LOADED_YET = /hasn.t been loaded on this device yet/

async function takeControl(page: Page) {
	await page.goto('/plan')
	await page.evaluate(() => navigator.serviceWorker.ready)
	// The worker does not claim the page that installed it; a first
	// registration takes control at the next document load.
	if (
		!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
	) {
		await page.reload()
	}
	await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
}

/** Waits until every JavaScript file of this build is in the static cache. */
async function waitForWarmWorker(page: Page) {
	const source = await (await page.request.get('/sw.js')).text()
	const list = source.match(/const CURRENT_ASSET_PATHS = new Set\((\[.*?\])\)/s)
	expect(list, 'sw.js lists the current build assets').not.toBeNull()
	const scripts = (JSON.parse(list![1]!) as string[]).filter((path) =>
		path.endsWith('.js'),
	)
	expect(scripts.some((path) => path.startsWith('/assets/shopping-'))).toBe(
		true,
	)
	await expect
		.poll(
			() =>
				page.evaluate(async (paths) => {
					const name = (await caches.keys()).find((key) =>
						key.startsWith('qm-static-'),
					)
					if (!name) return paths.length
					const cache = await caches.open(name)
					let missing = 0
					for (const path of paths) if (!(await cache.match(path))) missing++
					return missing
				}, scripts),
			{ message: 'every current .js asset is cached', timeout: 30_000 },
		)
		.toBe(0)
}

/** Waits until the worker has stored a tab's Route data for this session. */
async function waitForCachedData(page: Page, pathname: string) {
	await expect
		.poll(
			() =>
				page.evaluate(async (path) => {
					for (const name of await caches.keys()) {
						if (!name.startsWith('qm-data-')) continue
						const keys = await (await caches.open(name)).keys()
						if (keys.some((key) => new URL(key.url).pathname === path)) {
							return true
						}
					}
					return false
				}, pathname),
			{ message: `the worker cached ${pathname}` },
		)
		.toBe(true)
}

function bottomNav(page: Page) {
	return page
		.getByRole('navigation', { name: 'Main' })
		.filter({ has: page.getByRole('link', { name: 'Shop', exact: true }) })
}

function tab(page: Page, label: 'Recipes' | 'Staples' | 'Plan' | 'Shop') {
	return bottomNav(page).getByRole('link', { name: label, exact: true })
}

async function seedHousehold(user: { id: string; householdId: string }) {
	await prisma.householdIngredient.create({
		data: {
			householdId: user.householdId,
			displayName: 'Oat milk',
			canonicalKey: 'oat milk',
			isStaple: true,
		},
	})
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: { create: { name: 'Lemons' } },
		},
	})
}

test('offline, a tab keeps the app and its tab bar, and Retry loads it once back online', async ({
	page,
	context,
	login,
}) => {
	test.setTimeout(60_000)
	const user = await login()
	await seedHousehold(user)
	await takeControl(page)
	await expect(page.getByRole('heading', { name: 'Meal Plan' })).toBeVisible()
	await waitForWarmWorker(page)

	await tab(page, 'Recipes').click()
	await expect(page.getByRole('heading', { name: /^My Recipes/ })).toBeVisible()
	await tab(page, 'Staples').click()
	await expect(page.getByText('Oat milk')).toBeVisible()
	await waitForCachedData(page, '/inventory.data')

	const navigations: string[] = []
	const failedStyles: string[] = []
	page.on('request', (request: Request) => {
		if (request.isNavigationRequest()) navigations.push(request.url())
	})
	page.on('response', (response) => {
		const url = new URL(response.url())
		if (url.pathname.startsWith('/assets/') && !response.ok()) {
			failedStyles.push(url.pathname)
		}
	})

	await context.setOffline(true)

	// A tab visited this session shows its content.
	await tab(page, 'Recipes').click()
	await expect(page.getByRole('heading', { name: /^My Recipes/ })).toBeVisible()
	await tab(page, 'Staples').click()
	await expect(page).toHaveURL('/inventory')
	await expect(page.getByText('Oat milk')).toBeVisible()
	await expect(bottomNav(page)).toBeVisible()

	// A tab never loaded shows the notice, inside the app, without a reload.
	await tab(page, 'Shop').click()
	await expect(page).toHaveURL('/shopping')
	await expect(page.getByText(NOT_LOADED_YET)).toBeVisible()
	await expect(bottomNav(page)).toBeVisible()
	expect(navigations).toEqual([])
	expect(failedStyles).toEqual([])

	await tab(page, 'Plan').click()
	await expect(page.getByRole('heading', { name: 'Meal Plan' })).toBeVisible()
	await expect(page.getByText(NOT_LOADED_YET)).toHaveCount(0)

	await tab(page, 'Shop').click()
	await expect(page.getByText(NOT_LOADED_YET)).toBeVisible()

	await context.setOffline(false)
	await page.getByRole('button', { name: 'Retry' }).click()
	await expect(
		page.getByRole('heading', { name: /Shopping List/ }),
	).toBeVisible()
	await expect(page.getByText('Lemons')).toBeVisible()
	await expect(page.getByText(NOT_LOADED_YET)).toHaveCount(0)
	expect(navigations).toEqual([])
})
