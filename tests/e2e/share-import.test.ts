import { faker } from '@faker-js/faker'
import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { SHELL_UA } from '#tests/native-shell.ts'
import { E2E_MISSING_URL, E2E_RECIPE_URL } from '#tests/mocks/recipe-pages.ts'
import { expect, test } from '#tests/playwright-utils.ts'

// A link shared through the iOS app's own Share Extension imports at once.
// The shell hands it to the import page natively (ios/README.md, "Share
// import"); every other way onto `/recipes/import?url=…` waits for the tap.

const sharedUrl = `${E2E_RECIPE_URL}?utm_source=share`

function importPage(url: string) {
	return `/recipes/import?url=${encodeURIComponent(url)}`
}

/**
 * What the shell runs once a page has loaded while a share is pending: the
 * body of `ShareIntent.deliveryScript` in `ShareHandoff.swift`, called with
 * `callAsyncJavaScript` and the same three arguments. True when it handed the
 * link over.
 */
function deliverShare(page: Page, link: string) {
	return page.evaluate(
		({ link, origin, path }) => {
			if (location.origin !== origin || location.pathname !== path) return false
			if (new URLSearchParams(location.search).get('url') !== link) return false
			window.__qmShareImport = { url: link }
			window.dispatchEvent(
				new CustomEvent('qm:share-import', { detail: { url: link } }),
			)
			return true
		},
		{
			link,
			origin: new URL(page.url()).origin,
			path: '/recipes/import',
		},
	)
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

/** React has hydrated an element once it has attached its props to it. */
async function hydrated(target: Locator) {
	await expect
		.poll(() =>
			target.evaluate((element) =>
				Object.keys(element).some((key) => key.startsWith('__reactProps')),
			),
		)
		.toBe(true)
}

const offer = (page: Page) =>
	page.getByRole('heading', { name: 'Import this Recipe?' })
const importButton = (page: Page) =>
	page.getByRole('button', { name: 'Import', exact: true })

/** The offer is up and hydrated, so a share would act on it now. */
async function offerReady(page: Page) {
	await expect(offer(page)).toBeVisible()
	await hydrated(importButton(page))
}

/** A client-side navigation, as an in-app link makes one. */
async function navigateInApp(page: Page, to: string) {
	await page.evaluate(async (to) => {
		const router = (
			window as unknown as {
				__reactRouterDataRouter: { navigate: (to: string) => Promise<void> }
			}
		).__reactRouterDataRouter
		await router.navigate(to)
	}, to)
}

/**
 * Long enough for an import the page started to have sent its request: it
 * submits in the same task as the share arrives or the page mounts. Not
 * `networkidle`, which the household event stream keeps from settling.
 */
async function settle(page: Page) {
	await page.waitForTimeout(500)
}

const recipesIn = (householdId: string) =>
	prisma.recipe.findMany({
		where: { householdId },
		select: { id: true, title: true, sourceUrl: true },
	})

test.use({
	userAgent: SHELL_UA,
	viewport: { width: 390, height: 844 },
	hasTouch: true,
})

test('a share handed over after the page hydrated imports at once and opens the Recipe; shared again, it says it is saved', async ({
	page,
	login,
}) => {
	const user = await login()
	const count = countFetches(page)
	await page.goto(importPage(sharedUrl))
	await offerReady(page)
	expect(count.fetches).toBe(0)

	expect(await deliverShare(page, sharedUrl)).toBe(true)

	await expect(page).toHaveURL(/\/recipes\/(?!import)[a-z0-9]+$/)
	await expect(
		page.getByRole('heading', { name: 'Shared chickpea lunch', level: 1 }),
	).toBeVisible()
	expect(count.fetches).toBe(1)
	const saved = await recipesIn(user.householdId)
	expect(saved).toEqual([
		expect.objectContaining({
			title: 'Shared chickpea lunch',
			sourceUrl: sharedUrl,
		}),
	])

	// The same link shared again: the page says so, and nothing is fetched.
	await page.goto(importPage(sharedUrl))
	await expect(page.getByText('Already in your Recipes')).toBeVisible()
	await hydrated(page.getByRole('link', { name: 'Open it', exact: true }))
	expect(await deliverShare(page, sharedUrl)).toBe(true)
	await settle(page)
	await expect(page.getByText('Already in your Recipes')).toBeVisible()
	await expect(offer(page)).toHaveCount(0)
	expect(count.fetches).toBe(1)
	expect(await recipesIn(user.householdId)).toHaveLength(1)
})

test('a share handed over before the page hydrated imports once it has', async ({
	page,
	login,
}) => {
	const user = await login()
	const count = countFetches(page)
	// The shell can finish its delivery before React has mounted the page.
	await page.addInitScript((link) => {
		window.__qmShareImport = { url: link }
	}, sharedUrl)
	await page.goto(importPage(sharedUrl))

	await expect(page).toHaveURL(/\/recipes\/(?!import)[a-z0-9]+$/)
	await expect(
		page.getByRole('heading', { name: 'Shared chickpea lunch', level: 1 }),
	).toBeVisible()
	expect(count.fetches).toBe(1)
	expect(await recipesIn(user.householdId)).toEqual([
		expect.objectContaining({ sourceUrl: sharedUrl }),
	])
})

test('a share for another link imports nothing and leaves the tap', async ({
	page,
	login,
}) => {
	const user = await login()
	const count = countFetches(page)
	await page.goto(importPage(sharedUrl))
	await offerReady(page)

	// The shell's own script refuses a page offering another link.
	expect(await deliverShare(page, E2E_RECIPE_URL)).toBe(false)
	// And the page refuses one if it is handed over anyway.
	await page.evaluate((link) => {
		window.__qmShareImport = { url: link }
		window.dispatchEvent(new CustomEvent('qm:share-import'))
	}, E2E_RECIPE_URL)
	await expect
		.poll(() => page.evaluate(() => '__qmShareImport' in window))
		.toBe(false)
	await settle(page)
	await expect(offer(page)).toBeVisible()
	expect(count.fetches).toBe(0)
	expect(await recipesIn(user.householdId)).toHaveLength(0)

	await importButton(page).tap()
	await expect(page).toHaveURL(/\/recipes\/(?!import)[a-z0-9]+$/)
	expect(count.fetches).toBe(1)
	expect(await recipesIn(user.householdId)).toEqual([
		expect.objectContaining({ sourceUrl: sharedUrl }),
	])
})

test('a link opened any other way waits for the tap and saves nothing', async ({
	page,
	login,
}) => {
	const user = await login()
	const count = countFetches(page)
	// A universal link, or quartermaster://import?url=… from another app or a
	// site, loads the page with no share handed over.
	await page.goto(importPage(sharedUrl))
	await offerReady(page)
	await settle(page)
	await expect(offer(page)).toBeVisible()
	await expect(page.getByText(sharedUrl, { exact: true })).toBeVisible()
	expect(count.fetches).toBe(0)
	expect(await recipesIn(user.householdId)).toHaveLength(0)
})

test('a shared link that fails shows the error on the filled URL tab, and coming back to it waits for a tap', async ({
	page,
	login,
}) => {
	const user = await login()
	const count = countFetches(page)
	await page.goto(importPage(E2E_MISSING_URL))
	await offerReady(page)

	expect(await deliverShare(page, E2E_MISSING_URL)).toBe(true)

	await expect(page.getByText('Failed to fetch URL (404)')).toBeVisible()
	await expect(page.getByLabel('Recipe URL', { exact: true })).toHaveValue(
		E2E_MISSING_URL,
	)
	await expect(page).toHaveURL(/\/recipes\/import$/)
	expect(count.fetches).toBe(1)
	expect(await recipesIn(user.householdId)).toHaveLength(0)

	// The share was used up: the same link again, on the same page and after
	// leaving it, waits for the tap.
	await navigateInApp(page, importPage(E2E_MISSING_URL))
	await offerReady(page)
	await settle(page)
	await expect(offer(page)).toBeVisible()
	expect(count.fetches).toBe(1)

	await navigateInApp(page, '/recipes')
	await expect(page).toHaveURL(/\/recipes$/)
	await navigateInApp(page, importPage(E2E_MISSING_URL))
	await offerReady(page)
	await settle(page)
	await expect(offer(page)).toBeVisible()
	expect(count.fetches).toBe(1)
	expect(await recipesIn(user.householdId)).toHaveLength(0)
})

test('signed out, a share handed over again after login imports on the import page', async ({
	page,
	login,
}) => {
	const password = faker.internet.password()
	const user = await login({ password })
	await page.context().clearCookies()
	await prisma.session.deleteMany({ where: { userId: user.id } })
	const count = countFetches(page)

	await page.goto(importPage(sharedUrl))
	await expect(page).toHaveURL(/\/login\?redirectTo=/)
	await hydrated(page.getByRole('button', { name: 'Log in', exact: true }))
	// The shell tries on the login page; its script refuses there, so the
	// share stays pending.
	expect(await deliverShare(page, sharedUrl)).toBe(false)

	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByLabel(/^password$/i).fill(password)
	await page.getByRole('button', { name: 'Log in', exact: true }).tap()
	await expect(page).toHaveURL(importPage(sharedUrl))
	await offerReady(page)
	expect(count.fetches).toBe(0)
	expect(await recipesIn(user.householdId)).toHaveLength(0)

	// The URL change brings the shell back with the pending share.
	expect(await deliverShare(page, sharedUrl)).toBe(true)
	await expect(page).toHaveURL(/\/recipes\/(?!import)[a-z0-9]+$/)
	expect(count.fetches).toBe(1)
	expect(await recipesIn(user.householdId)).toEqual([
		expect.objectContaining({ sourceUrl: sharedUrl }),
	])
})
