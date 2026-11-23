import { readFileSync } from 'node:fs'
import path from 'node:path'
import { faker } from '@faker-js/faker'
import { type Page } from '@playwright/test'
import sharp from 'sharp'
import { prisma } from '#app/utils/db.server.ts'
import { E2E_UNREADABLE_MARKER } from '#tests/mocks/anthropic.ts'
import { SHELL_UA } from '#tests/native-shell.ts'
import { E2E_MISSING_URL, E2E_RECIPE_URL } from '#tests/mocks/recipe-pages.ts'
import { expect, hydrated, test } from '#tests/playwright-utils.ts'

// A link shared through the iOS app's own Share Extension imports at once.
// The shell hands it to the import page natively (ios/README.md, "Share
// import"); every other way onto `/recipes/import?url=…` waits for the tap.

const sharedUrl = `${E2E_RECIPE_URL}?utm_source=share`

function importPage(url: string) {
	return `/recipes/import?url=${encodeURIComponent(url)}`
}

/**
 * A script the shell runs on the import page while a share is pending, read
 * from `ShareIntent.swift` itself, so these tests run exactly what the app
 * runs: `linkScript` or `imagesScript`.
 */
function shellScript(name: 'linkScript' | 'imagesScript') {
	const source = readFileSync(
		path.join(
			process.cwd(),
			'ios/Quartermaster/Quartermaster/ShareIntent.swift',
		),
		'utf8',
	)
	const match = new RegExp(
		`static let ${name} = """\\n([\\s\\S]*?)\\n( *)"""`,
	).exec(source)
	if (!match) throw new Error(`No ${name} in ShareIntent.swift`)
	const indent = match[2]!
	return match[1]!
		.split('\n')
		.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
		.join('\n')
}

/**
 * Runs a shell script the way `callAsyncJavaScript` does: as the body of an
 * async function whose parameters are the arguments. Through the DevTools
 * protocol, which the page's CSP does not govern, like the shell's own call.
 */
function runShellScript(
	page: Page,
	name: 'linkScript' | 'imagesScript',
	args: Record<string, unknown>,
): Promise<boolean> {
	const names = Object.keys(args)
	const values = names.map((key) => JSON.stringify(args[key])).join(', ')
	return page.evaluate(
		`(async (${names.join(', ')}) => {\n${shellScript(name)}\n})(${values})`,
	)
}

/** The shell handing a shared link to the page. True when it did. */
function deliverShare(page: Page, link: string) {
	return runShellScript(page, 'linkScript', {
		link,
		origin: new URL(page.url()).origin,
		path: '/recipes/import',
	})
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
	await page.waitForFunction(() => '__reactRouterDataRouter' in window)
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
		window.__qmShareImport = {
			url: link,
			for: location.pathname + location.search,
			expiresAt: Date.now() + 60_000,
		}
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
		window.__qmShareImport = {
			url: link,
			for: location.pathname + location.search,
			expiresAt: Date.now() + 60_000,
		}
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

const OFFLINE_MESSAGE =
	'Couldn’t reach Quartermaster to confirm the import. Check your Recipes before you try again.'

test('a link shared with no connection says so and stays filled in for one tap', async ({
	page,
	login,
}) => {
	const user = await login()
	const count = countFetches(page)
	await page.goto(importPage(sharedUrl))
	await offerReady(page)
	await page.context().setOffline(true)

	expect(await deliverShare(page, sharedUrl)).toBe(true)

	await expect(page.getByText(OFFLINE_MESSAGE)).toBeVisible()
	await expect(page.getByLabel('Recipe URL', { exact: true })).toHaveValue(
		sharedUrl,
	)
	expect(count.fetches).toBe(1)
	expect(await recipesIn(user.householdId)).toHaveLength(0)

	await page.context().setOffline(false)
	await importButton(page).tap()
	await expect(page).toHaveURL(/\/recipes\/(?!import)[a-z0-9]+$/)
	expect(count.fetches).toBe(2)
	expect(await recipesIn(user.householdId)).toEqual([
		expect.objectContaining({ sourceUrl: sharedUrl }),
	])
})

test('a typed link with no connection says so and stays typed for one tap', async ({
	page,
	login,
}) => {
	const user = await login()
	await page.goto('/recipes/import')
	await hydrated(importButton(page))
	await page.getByLabel('Recipe URL', { exact: true }).fill(E2E_RECIPE_URL)
	await page.context().setOffline(true)
	await importButton(page).tap()

	await expect(page.getByText(OFFLINE_MESSAGE)).toBeVisible()
	await expect(page.getByLabel('Recipe URL', { exact: true })).toHaveValue(
		E2E_RECIPE_URL,
	)
	expect(await recipesIn(user.householdId)).toHaveLength(0)

	await page.context().setOffline(false)
	await importButton(page).tap()
	await expect(page).toHaveURL(/\/recipes\/(?!import)[a-z0-9]+$/)
	expect(await recipesIn(user.householdId)).toEqual([
		expect.objectContaining({ sourceUrl: E2E_RECIPE_URL }),
	])
})

test('the shell’s scripts refuse another origin and another page, so nothing is left for the import page', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
	const count = countImports(page)
	const images = await screenshots(1)
	const elsewhere = 'https://elsewhere.example'

	// The right page, but not the origin the shell was told.
	await page.goto(importPage(sharedUrl))
	await offerReady(page)
	expect(
		await runShellScript(page, 'linkScript', {
			link: sharedUrl,
			origin: elsewhere,
			path: '/recipes/import',
		}),
	).toBe(false)
	await page.goto('/recipes/import')
	await hydrated(importButton(page))
	expect(
		await runShellScript(page, 'imagesScript', {
			images,
			origin: elsewhere,
			path: '/recipes/import',
		}),
	).toBe(false)

	// Another page whose query happens to match: nothing may wait there for
	// the import page to pick up later.
	await page.goto(`/recipes?url=${encodeURIComponent(sharedUrl)}`)
	const origin = new URL(page.url()).origin
	expect(
		await runShellScript(page, 'linkScript', {
			link: sharedUrl,
			origin,
			path: '/recipes/import',
		}),
	).toBe(false)
	await navigateInApp(page, importPage(sharedUrl))
	await offerReady(page)
	await navigateInApp(page, '/recipes')
	await expect(page).toHaveURL(/\/recipes$/)
	expect(
		await runShellScript(page, 'imagesScript', {
			images,
			origin,
			path: '/recipes/import',
		}),
	).toBe(false)
	await navigateInApp(page, '/recipes/import')
	await hydrated(importButton(page))
	await settle(page)
	await expect(offer(page)).toHaveCount(0)
	expect(count).toEqual({ images: 0, links: 0 })
	expect(await recipesIn(user.householdId)).toHaveLength(0)
})

/** Holds the GETs matching `pattern` until `release` is called. */
async function holdLoads(page: Page, pattern: RegExp) {
	let release = () => {}
	const held = new Promise<void>((resolve) => (release = resolve))
	await page.route(pattern, async (route) => {
		if (route.request().method() === 'GET') await held
		await route.continue()
	})
	return release
}

/** Starts an in-app navigation and waits until it is loading. */
async function startNavigation(page: Page, to: string) {
	await page.waitForFunction(() => '__reactRouterDataRouter' in window)
	await page.evaluate((to) => {
		const router = (
			window as unknown as {
				__reactRouterDataRouter: { navigate: (to: string) => Promise<void> }
			}
		).__reactRouterDataRouter
		void router.navigate(to)
	}, to)
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(
						window as unknown as {
							__reactRouterDataRouter: {
								state: { navigation: { state: string } }
							}
						}
					).__reactRouterDataRouter.state.navigation.state,
			),
		)
		.toBe('loading')
}

test('a link handed over while the page is being left imports nothing, then or on Back', async ({
	page,
	login,
}) => {
	const user = await login()
	const count = countFetches(page)
	await page.goto('/recipes')
	await navigateInApp(page, importPage(sharedUrl))
	await offerReady(page)
	// A tab tapped just as the shared page loaded.
	const release = await holdLoads(page, /\/recipes\.data/)
	await startNavigation(page, '/recipes')

	// The page is still the import page, so the shell's script hands it over.
	expect(await deliverShare(page, sharedUrl)).toBe(true)
	release()
	await expect(page).toHaveURL(/\/recipes$/)
	await settle(page)
	expect(count.fetches).toBe(0)

	await page.goBack()
	await expect(page).toHaveURL(importPage(sharedUrl))
	await offerReady(page)
	await settle(page)
	await expect(offer(page)).toBeVisible()
	expect(count.fetches).toBe(0)
	expect(await recipesIn(user.householdId)).toHaveLength(0)
})

test('screenshots handed over while the page is being left import nothing, then or on a later visit', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
	const count = countImports(page)
	await page.goto('/recipes/import')
	await hydrated(importButton(page))
	const release = await holdLoads(page, /\/recipes\.data/)
	await startNavigation(page, '/recipes')

	expect(await deliverScreenshots(page, await screenshots(1))).toBe(true)
	release()
	await expect(page).toHaveURL(/\/recipes$/)
	await settle(page)
	expect(count.images).toBe(0)

	await navigateInApp(page, '/recipes/import')
	await hydrated(importButton(page))
	await settle(page)
	expect(count.images).toBe(0)
	expect(await recipesIn(user.householdId)).toHaveLength(0)
})

test('a handed-over share that has expired, or was handed to another page, imports nothing', async ({
	page,
	login,
}) => {
	const user = await login()
	const count = countFetches(page)
	// Set at document start, as a delivery before the page mounted would be.
	await page.addInitScript(
		({ link, otherPage }) => {
			const where = location.pathname + location.search
			window.__qmShareImport = where.includes('expired')
				? { url: link, for: where, expiresAt: Date.now() - 1 }
				: { url: link, for: otherPage, expiresAt: Date.now() + 60_000 }
		},
		{ link: sharedUrl, otherPage: '/recipes/import' },
	)

	// The page's own `?url=` is still the shared link; `case` only picks
	// which stale share the init script sets.
	for (const which of ['expired', 'elsewhere']) {
		await page.goto(`${importPage(sharedUrl)}&case=${which}`)
		await offerReady(page)
		await settle(page)
		await expect(offer(page)).toBeVisible()
		expect(
			await page.evaluate(() => '__qmShareImport' in window),
			`${which}: the stale share is dropped`,
		).toBe(false)
	}
	expect(count.fetches).toBe(0)
	expect(await recipesIn(user.householdId)).toHaveLength(0)
})

test('a share that arrives while the page is still loading imports once it has loaded', async ({
	page,
	login,
}) => {
	const user = await login()
	const count = countFetches(page)
	await page.goto(importPage(sharedUrl))
	await offerReady(page)
	// Hold the page's next data load, so the page is busy when the share
	// arrives.
	let release = () => {}
	const held = new Promise<void>((resolve) => (release = resolve))
	await page.route(/\/recipes\/import\.data\?/, async (route) => {
		if (route.request().method() === 'GET') await held
		await route.continue()
	})
	await page.evaluate((to) => {
		const router = (
			window as unknown as {
				__reactRouterDataRouter: { navigate: (to: string) => Promise<void> }
			}
		).__reactRouterDataRouter
		void router.navigate(to)
	}, importPage(sharedUrl))
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(
						window as unknown as {
							__reactRouterDataRouter: {
								state: { navigation: { state: string } }
							}
						}
					).__reactRouterDataRouter.state.navigation.state,
			),
		)
		.toBe('loading')

	expect(await deliverShare(page, sharedUrl)).toBe(true)
	release()

	await expect(page).toHaveURL(/\/recipes\/(?!import)[a-z0-9]+$/)
	expect(count.fetches).toBe(1)
	expect(await recipesIn(user.householdId)).toEqual([
		expect.objectContaining({ sourceUrl: sharedUrl }),
	])
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

// Screenshots shared through the Share Extension land on the plain import page
// and go through its image form: the same action, Pro check and limits.

type SharedImage = { name: string; type: string; data: string }

/** Small JPEGs, as the Share Extension writes them (base64). */
async function screenshots(count: number): Promise<SharedImage[]> {
	return Promise.all(
		Array.from({ length: count }, async (_, index) => {
			const jpeg = await sharp({
				create: {
					width: 64,
					height: 48,
					channels: 3,
					background: ['#c86b3c', '#6b8f71', '#f6f1eb'][index % 3]!,
				},
			})
				.jpeg()
				.toBuffer()
			return {
				name: `Screenshot ${index + 1}.jpg`,
				type: 'image/jpeg',
				data: jpeg.toString('base64'),
			}
		}),
	)
}

/** The shell handing shared screenshots to the page. True when it did. */
function deliverScreenshots(page: Page, images: SharedImage[]) {
	return runShellScript(page, 'imagesScript', {
		images,
		origin: new URL(page.url()).origin,
		path: '/recipes/import',
	})
}

/**
 * POSTs of the image import (the only multipart one on this page; Chromium
 * does not expose a body holding files), and of the link import.
 */
function countImports(page: Page) {
	const count = { images: 0, links: 0 }
	page.on('request', (request) => {
		if (request.method() !== 'POST' || !/\/recipes\/import/.test(request.url()))
			return
		const type = request.headers()['content-type'] ?? ''
		if (type.startsWith('multipart/form-data')) count.images++
		else if (
			new URLSearchParams(request.postData() ?? '').get('intent') === 'fetch'
		)
			count.links++
	})
	return count
}

/** The plain import page, hydrated. */
async function importReady(page: Page) {
	await page.goto('/recipes/import')
	await hydrated(importButton(page))
}

const savedRecipe = /\/recipes\/(?!import)[a-z0-9]+$/

test.describe('shared screenshots', () => {
	test('one screenshot imports at once and opens the Recipe', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
		const count = countImports(page)
		await importReady(page)

		expect(await deliverScreenshots(page, await screenshots(1))).toBe(true)

		await expect(page.getByText('Reading your screenshots…')).toBeVisible()
		await expect(page).toHaveURL(savedRecipe)
		await expect(
			page.getByRole('heading', {
				name: 'Shared screenshot salad from 1 image',
				level: 1,
			}),
		).toBeVisible()
		expect(count.images).toBe(1)
		expect(await recipesIn(user.householdId)).toEqual([
			expect.objectContaining({
				title: 'Shared screenshot salad from 1 image',
			}),
		])
	})

	test('three screenshots import as one Recipe', async ({ page, login }) => {
		const user = await login()
		await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
		const count = countImports(page)
		await importReady(page)

		expect(await deliverScreenshots(page, await screenshots(3))).toBe(true)

		await expect(page).toHaveURL(savedRecipe)
		await expect(
			page.getByRole('heading', {
				name: 'Shared screenshot salad from 3 images',
				level: 1,
			}),
		).toBeVisible()
		expect(count.images).toBe(1)
		expect(await recipesIn(user.householdId)).toEqual([
			expect.objectContaining({
				title: 'Shared screenshot salad from 3 images',
			}),
		])
	})

	test('a free account is told screenshot import is not available, and nothing is sent or saved', async ({
		page,
		login,
	}) => {
		const user = await login()
		const count = countImports(page)
		await importReady(page)

		expect(await deliverScreenshots(page, await screenshots(1))).toBe(true)

		await expect(
			page.getByText('Screenshot import isn’t available on your account'),
		).toBeVisible()
		await expect(
			page.getByText('Paste the Recipe’s link or text instead.'),
		).toBeVisible()
		await settle(page)
		expect(count.images).toBe(0)
		expect(await recipesIn(user.householdId)).toHaveLength(0)
		// The iOS app never points at Pro (ADR 0001).
		await expect(page.getByText(/\bPro\b|upgrade/i)).toHaveCount(0)
		await expect(page.getByRole('link', { name: /upgrade/i })).toHaveCount(0)
	})

	test('screenshots handed to a page offering a link import nothing', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
		const count = countImports(page)
		await page.goto(importPage(sharedUrl))
		await offerReady(page)
		const images = await screenshots(1)

		// The shell's own script refuses a page offering a link.
		expect(await deliverScreenshots(page, images)).toBe(false)
		// And the page refuses them if they are handed over anyway.
		await page.evaluate((images) => {
			window.__qmShareImport = {
				files: images.map(
					(image) => new File([image.data], image.name, { type: image.type }),
				),
				for: location.pathname + location.search,
				expiresAt: Date.now() + 60_000,
			}
			window.dispatchEvent(new CustomEvent('qm:share-import'))
		}, images)
		await expect
			.poll(() => page.evaluate(() => '__qmShareImport' in window))
			.toBe(false)
		await settle(page)
		await expect(offer(page)).toBeVisible()
		expect(count).toEqual({ images: 0, links: 0 })
		expect(await recipesIn(user.householdId)).toHaveLength(0)
	})

	test('screenshots with no Recipe show the error with the screenshots still attached, one tap retries, and the share is used up', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
		// The canned extraction finds nothing while the Household has this name.
		const marker = await prisma.recipeMetadataValue.create({
			data: {
				householdId: user.householdId,
				dimension: 'cuisine',
				name: E2E_UNREADABLE_MARKER,
				nameKey: E2E_UNREADABLE_MARKER.toLowerCase(),
			},
		})
		const count = countImports(page)
		await importReady(page)

		expect(await deliverScreenshots(page, await screenshots(2))).toBe(true)

		await expect(
			page.getByText("Couldn't find a recipe in the provided image(s)."),
		).toBeVisible()
		await expect(page).toHaveURL(/\/recipes\/import$/)
		await expect(
			page.getByRole('tab', { name: 'From Image', selected: true }),
		).toBeVisible()
		const input = page.getByLabel('Upload screenshots (up to 5)')
		expect(
			await input.evaluate((element: HTMLInputElement) =>
				Array.from(element.files ?? [], (file) => file.name),
			),
		).toEqual(['Screenshot 1.jpg', 'Screenshot 2.jpg'])
		expect(count.images).toBe(1)
		expect(await recipesIn(user.householdId)).toHaveLength(0)

		// One tap tries again with the same screenshots.
		await prisma.recipeMetadataValue.delete({ where: { id: marker.id } })
		await page.getByRole('button', { name: 'Extract with AI' }).tap()
		await expect(page).toHaveURL(savedRecipe)
		await expect(
			page.getByRole('heading', {
				name: 'Shared screenshot salad from 2 images',
				level: 1,
			}),
		).toBeVisible()
		expect(count.images).toBe(2)

		// The share was used up: the import page again sends nothing.
		await navigateInApp(page, '/recipes/import')
		await hydrated(importButton(page))
		await settle(page)
		expect(count.images).toBe(2)
		expect(await recipesIn(user.householdId)).toHaveLength(1)
	})

	test('screenshots shared with no connection say so on the import page, still attached for one tap', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
		const count = countImports(page)
		await importReady(page)
		await page.context().setOffline(true)

		expect(await deliverScreenshots(page, await screenshots(2))).toBe(true)

		await expect(page.getByText(OFFLINE_MESSAGE)).toBeVisible()
		await expect(
			page.getByRole('tab', { name: 'From Image', selected: true }),
		).toBeVisible()
		const input = page.getByLabel('Upload screenshots (up to 5)')
		expect(
			await input.evaluate((element: HTMLInputElement) =>
				Array.from(element.files ?? [], (file) => file.name),
			),
		).toEqual(['Screenshot 1.jpg', 'Screenshot 2.jpg'])
		expect(count.images).toBe(1)
		expect(await recipesIn(user.householdId)).toHaveLength(0)

		await page.context().setOffline(false)
		await page.getByRole('button', { name: 'Extract with AI' }).tap()
		await expect(page).toHaveURL(savedRecipe)
		expect(count.images).toBe(2)
		expect(await recipesIn(user.householdId)).toEqual([
			expect.objectContaining({
				title: 'Shared screenshot salad from 2 images',
			}),
		])
	})
})
