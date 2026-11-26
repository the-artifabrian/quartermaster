import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { SHELL_UA, setShellSafeArea } from '#tests/native-shell.ts'
import {
	animationsFinished,
	expect,
	expectThumbSized,
	expectThumbTall,
	hydrated,
	test,
} from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const PHOTO = 'users/fixture-user/recipes/fixture-recipe/images/0.png'

type RecipeSeed = {
	title: string
	description?: string
	totalTime?: number
	isFavorite?: boolean
	photo?: boolean
	cuisine?: string
}

/** Saves the Recipes oldest first, so the default sort lists them in order. */
async function seedRecipes(
	user: { id: string; householdId: string },
	recipes: RecipeSeed[],
) {
	const cuisines = new Map<string, string>()
	for (const name of new Set(recipes.flatMap((r) => r.cuisine ?? []))) {
		const value = await prisma.recipeMetadataValue.create({
			data: {
				householdId: user.householdId,
				dimension: 'cuisine',
				name,
				nameKey: name.toLowerCase(),
			},
		})
		cuisines.set(name, value.id)
	}
	const start = Date.now() - recipes.length * 1000
	const ids: string[] = []
	for (const [index, recipe] of [...recipes].reverse().entries()) {
		const at = new Date(start + index * 1000)
		const saved = await prisma.recipe.create({
			data: {
				title: recipe.title,
				description: recipe.description ?? null,
				totalTime: recipe.totalTime ?? null,
				isFavorite: recipe.isFavorite ?? false,
				userId: user.id,
				householdId: user.householdId,
				createdAt: at,
				updatedAt: at,
				ingredients: { create: { name: 'salt', order: 0 } },
				instructions: { create: { content: 'Cook.', order: 0 } },
				...(recipe.photo
					? { image: { create: { objectKey: PHOTO } } }
					: undefined),
				...(recipe.cuisine
					? {
							metadataAssignments: {
								create: { valueId: cuisines.get(recipe.cuisine)! },
							},
						}
					: undefined),
			},
			select: { id: true },
		})
		ids.unshift(saved.id)
	}
	return ids
}

const many = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		title: `Weeknight Recipe ${index + 1}`,
	}))

async function box(locator: Locator) {
	const found = await locator.boundingBox()
	expect(found, 'has a box').not.toBeNull()
	return found!
}

const searchField = (page: Page) =>
	page.getByRole('searchbox', { name: 'Search by name or ingredient' })
const library = (page: Page) =>
	page.getByRole('navigation', { name: 'Library' })
const pinnedRow = (page: Page) => page.locator('[data-recipes-tools]')
const recipeLink = (page: Page, title: string) =>
	page.getByRole('link', { name: title })

/** Waits for the offline notice to settle, and returns its box. */
async function offlineNotice(page: Page) {
	const notice = page
		.locator('[data-sonner-toast]')
		.filter({ hasText: "You're offline" })
	await expect(notice).toBeVisible()
	await animationsFinished(page)
	return box(notice)
}

/** The contrast of an element's text on the page behind it. */
function contrastOnPage(locator: Locator) {
	return locator.evaluate((element) => {
		const rgb = (color: string) => {
			const canvas = document.createElement('canvas')
			canvas.width = canvas.height = 1
			const context = canvas.getContext('2d')!
			context.fillStyle = color
			context.fillRect(0, 0, 1, 1)
			return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
		}
		const luminance = (color: string) => {
			const [r, g, b] = rgb(color).map((channel) => {
				const c = channel / 255
				return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
			})
			return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
		}
		const text = luminance(getComputedStyle(element).color)
		const page = luminance(getComputedStyle(document.body).backgroundColor)
		const [hi, lo] = text > page ? [text, page] : [page, text]
		return (hi + 0.05) / (lo + 0.05)
	})
}

test.describe('the title', () => {
	test('is both libraries: the one showing is the heading, the other a faint link to it', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, [{ title: 'Toast' }])
		await page.goto('/recipes')
		const recipes = library(page).getByRole('link', {
			name: 'Recipes',
			exact: true,
		})
		const menus = library(page).getByRole('link', {
			name: 'Menus',
			exact: true,
		})
		await expect(
			page.getByRole('heading', { level: 1, name: 'Recipes', exact: true }),
		).toBeVisible()
		await expect(recipes).toHaveAttribute('aria-current', 'page')
		await expect(menus).not.toHaveAttribute('aria-current', 'page')
		await expectThumbTall(recipes)
		await expectThumbTall(menus)
		// The faint one is 40px text, so it needs 3:1.
		expect(await contrastOnPage(menus)).toBeGreaterThanOrEqual(3)
		expect(await contrastOnPage(recipes)).toBeGreaterThan(
			await contrastOnPage(menus),
		)
		// No count in the title, and no segmented switch, on a phone.
		await expect(page.getByText('(1)')).toBeHidden()
		await expect(page.locator('[data-slot="segmented-pill"]')).toBeHidden()

		await hydrated(menus)
		await menus.tap()
		await expect(page).toHaveURL(/\/recipes\/menus$/)
		await expect(
			page.getByRole('heading', { level: 1, name: 'Menus', exact: true }),
		).toBeVisible()
		await expect(menus).toHaveAttribute('aria-current', 'page')
		await expect(recipes).not.toHaveAttribute('aria-current', 'page')
		await recipes.tap()
		await expect(page).toHaveURL(/\/recipes$/)
	})

	for (const path of ['/recipes', '/recipes/menus']) {
		test(`at 320px the two titles and the + share one row, unclipped (${path})`, async ({
			page,
			login,
		}) => {
			await page.setViewportSize({ width: 320, height: 640 })
			await login()
			await page.goto(path)
			const recipes = await box(
				library(page).getByRole('link', { name: 'Recipes', exact: true }),
			)
			const menus = await box(
				library(page).getByRole('link', { name: 'Menus', exact: true }),
			)
			const plus = await box(
				// The empty list has its own New Menu button further down.
				page
					.getByRole(path === '/recipes' ? 'button' : 'link', {
						name: path === '/recipes' ? 'New Recipe' : 'New Menu',
					})
					.first(),
			)
			expect(recipes.x).toBeGreaterThanOrEqual(16)
			expect(menus.x).toBeGreaterThan(recipes.x + recipes.width)
			expect(plus.x).toBeGreaterThan(menus.x + menus.width)
			expect(plus.x + plus.width).toBeLessThanOrEqual(320 - 16 + 0.5)
			// One row: the three overlap vertically.
			for (const other of [menus, plus]) {
				expect(other.y).toBeLessThan(recipes.y + recipes.height)
				expect(other.y + other.height).toBeGreaterThan(recipes.y)
			}
			const clipped = await library(page)
				.getByRole('link')
				.evaluateAll(
					(links) =>
						links.filter((link) => link.scrollWidth > link.clientWidth).length,
				)
			expect(clipped).toBe(0)
			expect(
				await page.evaluate(
					() =>
						document.documentElement.scrollWidth <=
						document.documentElement.clientWidth,
				),
			).toBe(true)
		})
	}
})

test.describe('the search row', () => {
	test('stays pinned while the list scrolls, and a scrolled-to row lands below it, filters open or not', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, many(30))
		await page.goto('/recipes')
		await hydrated(searchField(page))
		const before = await box(searchField(page))
		await page.evaluate(() => window.scrollTo(0, 1500))
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1500)
		const pinned = await box(searchField(page))
		expect(pinned.y).toBe(14)
		expect(before.y).toBeGreaterThan(pinned.y)
		// Opaque, so the rows under it don't show through.
		expect(
			await pinnedRow(page).evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			),
		).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)

		for (const open of [false, true]) {
			if (open) {
				await page.getByRole('button', { name: 'Toggle filters' }).tap()
				await expect(
					page.getByRole('combobox', { name: 'Sort Recipes' }),
				).toBeVisible()
			}
			const row = recipeLink(
				page,
				open ? 'Weeknight Recipe 20' : 'Weeknight Recipe 15',
			)
			await row.evaluate((element) =>
				element.scrollIntoView({ block: 'start' }),
			)
			const rowBox = await box(row)
			const pinnedBox = await box(pinnedRow(page))
			expect(pinnedBox.y).toBe(0)
			expect(rowBox.y).toBeGreaterThanOrEqual(pinnedBox.y + pinnedBox.height)
		}
	})

	test('focusing its field or a chip from the keyboard scrolls nothing', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, many(30))
		await page.goto('/recipes')
		const toggle = page.getByRole('button', { name: 'Toggle filters' })
		await hydrated(toggle)
		const scrollY = () => page.evaluate(() => window.scrollY)
		await page.evaluate(() => window.scrollTo(0, 1500))
		await expect.poll(scrollY).toBe(1500)
		await toggle.focus()
		await page.keyboard.press('Shift+Tab')
		await expect(searchField(page)).toBeFocused()
		expect(await scrollY()).toBe(1500)

		await toggle.tap()
		const sort = page.getByRole('combobox', { name: 'Sort Recipes' })
		await expect(sort).toBeVisible()
		await page.evaluate(() => window.scrollTo(0, 1500))
		await expect.poll(scrollY).toBe(1500)
		await toggle.focus()
		for (const control of [
			sort,
			page.getByRole('combobox', { name: 'Filter by cook time' }),
			page.getByRole('button', { name: 'Show favorites only' }),
		]) {
			await page.keyboard.press('Tab')
			await expect(control).toBeFocused()
			expect(await scrollY()).toBe(1500)
		}
	})

	test('the offline notice opens below it, at the top of the list and scrolled, filters open or not', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, many(30))
		await page.goto('/recipes')
		const toggle = page.getByRole('button', { name: 'Toggle filters' })
		await hydrated(toggle)
		await page.context().setOffline(true)
		await offlineNotice(page)
		const scrollY = () => page.evaluate(() => window.scrollY)

		for (const open of [false, true]) {
			if (open) {
				await toggle.tap()
				await expect(
					page.getByRole('combobox', { name: 'Sort Recipes' }),
				).toBeVisible()
			}
			// At the top the row sits under the title; scrolled, it is pinned.
			for (const y of [0, 1500]) {
				await page.evaluate((y) => window.scrollTo(0, y), y)
				await expect.poll(scrollY).toBe(y)
				const row = await box(pinnedRow(page))
				expect(row.y).toBe(y === 0 ? 56 : 0)
				expect((await offlineNotice(page)).y).toBeGreaterThanOrEqual(
					row.y + row.height,
				)
			}
		}
	})

	test('with the demo banner, the offline notice opens below it at the top of the list, filters open or not', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.user.update({
			where: { id: user.id },
			data: { demoExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
		})
		await seedRecipes(user, many(30))
		await page.goto('/recipes')
		const toggle = page.getByRole('button', { name: 'Toggle filters' })
		await hydrated(toggle)
		await expect(page.getByRole('region', { name: 'Demo' })).toBeVisible()
		await page.context().setOffline(true)
		await offlineNotice(page)

		for (const open of [false, true]) {
			if (open) {
				await toggle.tap()
				await expect(
					page.getByRole('combobox', { name: 'Sort Recipes' }),
				).toBeVisible()
			}
			const row = await box(pinnedRow(page))
			expect(row.y).toBeGreaterThan(56 + 40)
			expect((await offlineNotice(page)).y).toBeGreaterThanOrEqual(
				row.y + row.height,
			)
		}
	})

	test.describe('in the iOS app', () => {
		test.use({ userAgent: SHELL_UA })

		test('pins under the status bar', async ({ page, login }) => {
			const user = await login()
			await seedRecipes(user, many(30))
			await setShellSafeArea(page, { top: 47, bottom: 34 })
			await page.goto('/recipes')
			await hydrated(searchField(page))
			await page.evaluate(() => window.scrollTo(0, 1500))
			await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1500)
			expect((await box(pinnedRow(page))).y).toBe(47)
			expect((await box(searchField(page))).y).toBe(47 + 14)
		})

		test('the offline notice opens below it under the status bar inset', async ({
			page,
			login,
		}) => {
			const user = await login()
			await seedRecipes(user, many(30))
			await setShellSafeArea(page, { top: 47, bottom: 34 })
			await page.goto('/recipes')
			await hydrated(searchField(page))
			await page.evaluate(() => window.scrollTo(0, 1500))
			await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1500)
			await page.context().setOffline(true)
			const notice = await offlineNotice(page)
			const row = await box(pinnedRow(page))
			expect(row.y).toBe(47)
			expect(notice.y).toBeGreaterThanOrEqual(row.y + row.height)
		})
	})

	test('a search typed far down the list shows its first result under the search row', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, many(40))
		await page.addInitScript((id) => {
			localStorage.setItem(`getting-started-dismissed:${id}`, 'true')
		}, user.id)
		await page.goto('/recipes')
		await hydrated(searchField(page))
		await page.evaluate(() => window.scrollTo(0, 2200))
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(2200)
		await searchField(page).fill('Weeknight Recipe 1')
		await expect(page).toHaveURL(/search=Weeknight/)
		await expect(recipeLink(page, 'Weeknight Recipe 1').first()).toBeVisible()
		// The list's first row, with only the filtered line between it and the
		// pinned row.
		const first = page
			.locator('a[href^="/recipes/"]')
			.filter({ hasText: 'Weeknight Recipe' })
			.first()
		const pinnedBox = await box(pinnedRow(page))
		const firstBox = await box(first)
		expect(firstBox.y).toBeGreaterThanOrEqual(pinnedBox.y + pinnedBox.height)
		expect(firstBox.y).toBeLessThan(pinnedBox.y + pinnedBox.height + 80)
	})

	test('its clear button empties the field and the search, and keeps focus there', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, [{ title: 'Lemon rice' }, { title: 'Fish tacos' }])
		await page.goto('/recipes')
		const field = searchField(page)
		await hydrated(field)
		const clear = page.getByRole('button', { name: 'Clear the search field' })
		await expect(clear).toHaveCount(0)
		await field.fill('lemon')
		await expect(page).toHaveURL(/search=lemon/)
		await expect(recipeLink(page, 'Fish tacos')).toHaveCount(0)
		await expectThumbSized(clear)
		// One clear button: a rule hides the browser's own.
		expect(
			await field.evaluate((element) => {
				const rules = (list: CSSRuleList): CSSRule[] =>
					[...list].flatMap((rule) =>
						rule instanceof CSSGroupingRule
							? rules(rule.cssRules)
							: rule instanceof CSSStyleRule && rule.cssRules.length
								? [rule, ...rules(rule.cssRules)]
								: [rule],
					)
				return [...document.styleSheets]
					.flatMap((sheet) => rules(sheet.cssRules))
					.some((rule) => {
						if (!(rule instanceof CSSStyleRule)) return false
						const pseudo = '::-webkit-search-cancel-button'
						const selector = rule.selectorText
						if (!selector.endsWith(pseudo)) return false
						const base = selector.slice(0, -pseudo.length)
						return element.matches(base) && rule.style.display === 'none'
					})
			}),
		).toBe(true)
		// Focus never leaves the field, not even between finger down and up,
		// so the keyboard stays up.
		await field.evaluate((element) => {
			const blurs = { count: 0 }
			;(window as unknown as { fieldBlurs: typeof blurs }).fieldBlurs = blurs
			element.addEventListener('blur', () => blurs.count++)
		})
		await clear.tap()
		await expect(field).toHaveValue('')
		await expect(field).toBeFocused()
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { fieldBlurs: { count: number } }).fieldBlurs
						.count,
			),
		).toBe(0)
		await expect(page).toHaveURL(/\/recipes$/)
		await expect(recipeLink(page, 'Fish tacos')).toBeVisible()

		// A clear inside the typing pause cancels the search that was waiting.
		await field.pressSequentially('fish')
		await clear.tap()
		await page.waitForTimeout(500)
		await expect(page).toHaveURL(/\/recipes$/)
		await expect(recipeLink(page, 'Lemon rice')).toBeVisible()
	})
})

test.describe('the filters', () => {
	async function openWithChoices(page: Page, url: string) {
		await page.goto(url)
		const toggle = page.getByRole('button', { name: 'Toggle filters' })
		await hydrated(toggle)
		await toggle.tap()
		const row = page.locator('[data-recipes-chips]')
		await expect(row).toBeVisible()
		return row
	}

	test('open as one row that scrolls sideways, with a chosen chip tinted and ringed', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, [
			{ title: 'Hummus', isFavorite: true, cuisine: 'Levantine' },
		])
		const row = await openWithChoices(page, '/recipes?favorites=true')
		await expect(
			page.getByRole('button', { name: 'Toggle filters' }),
		).toContainText('1')
		const chips = row.locator(':scope > *')
		const tops = await chips.evaluateAll((elements) =>
			elements.map((element) =>
				Math.round(element.getBoundingClientRect().top),
			),
		)
		expect(tops.length).toBe(6)
		expect(new Set(tops).size).toBe(1)
		// The row scrolls rather than squeezing a chip.
		for (const chip of await chips.all()) await expectThumbSized(chip)
		expect(
			await row.evaluate(
				(element) => element.scrollWidth > element.clientWidth,
			),
		).toBe(true)
		const favorites = page.getByRole('button', { name: 'Show all Recipes' })
		await expect(favorites).toHaveAttribute('aria-pressed', 'true')
		const look = await favorites.evaluate((element) => {
			const probe = document.createElement('div')
			probe.style.background = 'var(--primary-tint)'
			probe.style.color = 'var(--primary)'
			document.body.append(probe)
			const want = getComputedStyle(probe)
			const got = getComputedStyle(element)
			const result = {
				tint: got.backgroundColor === want.backgroundColor,
				text: got.color === want.color,
				edge: got.borderTopColor === want.color,
				// The ring is drawn inside the edge, so the two make it thicker.
				ring: got.boxShadow.includes(`${want.color} 0px 0px 0px 0.5px inset`),
			}
			probe.remove()
			return result
		})
		expect(look).toEqual({ tint: true, text: true, edge: true, ring: true })
	})

	test('a chip reached from the keyboard comes fully into the row, both ways, without moving the page', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, [
			...many(30),
			{ title: 'Hummus', cuisine: 'Levantine' },
		])
		const row = await openWithChoices(page, '/recipes')
		const scrollY = () => page.evaluate(() => window.scrollY)
		await page.evaluate(() => window.scrollTo(0, 900))
		await expect.poll(scrollY).toBe(900)
		const chips = await row.locator(':scope > *').all()
		expect(chips).toHaveLength(6)
		const fullyInRow = (chip: Locator) =>
			chip.evaluate((element) => {
				const chip = element.getBoundingClientRect()
				const row = element.parentElement!.getBoundingClientRect()
				return chip.left >= row.left && chip.right <= row.right
			})
		await page.getByRole('button', { name: 'Toggle filters' }).focus()
		for (const chip of chips) {
			await page.keyboard.press('Tab')
			await expect(chip).toBeFocused()
			expect(await fullyInRow(chip)).toBe(true)
			expect(await scrollY()).toBe(900)
		}
		for (const chip of [...chips].reverse().slice(1)) {
			await page.keyboard.press('Shift+Tab')
			await expect(chip).toBeFocused()
			expect(await fullyInRow(chip)).toBe(true)
			expect(await scrollY()).toBe(900)
		}
	})

	test('a menu opened from a chip half off the screen opens on the screen', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, [{ title: 'Hummus', cuisine: 'Levantine' }])
		const row = await openWithChoices(page, '/recipes')
		const course = page.getByRole('button', { name: /^Course/ })
		// Scroll the row so the chip straddles the right edge of the screen.
		await row.evaluate((element) => {
			const chip = [...element.querySelectorAll('button')].find((button) =>
				button.textContent?.startsWith('Course'),
			)!
			element.scrollLeft =
				chip.offsetLeft - element.clientWidth + chip.offsetWidth / 2
		})
		const chipBox = await box(course)
		expect(chipBox.x).toBeLessThan(390)
		expect(chipBox.x + chipBox.width).toBeGreaterThan(390)
		await page.touchscreen.tap(chipBox.x + 12, chipBox.y + chipBox.height / 2)
		const menu = page.getByRole('menu')
		await expect(menu).toBeVisible()
		const menuBox = await box(menu)
		expect(menuBox.x).toBeGreaterThanOrEqual(0)
		expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390)
	})

	test('a vertical swipe that starts on the chip row scrolls the page', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, many(30))
		const row = await openWithChoices(page, '/recipes')
		const rowBox = await box(row)
		const x = 200
		const y = rowBox.y + rowBox.height / 2
		const cdp = await page.context().newCDPSession(page)
		const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', dy: number) =>
			cdp.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: type === 'touchEnd' ? [] : [{ x, y: y + dy, id: 1 }],
			})
		// The row has just appeared: let it paint before the finger lands, and
		// move the finger a frame at a time, as a real one does.
		await animationsFinished(page)
		const before = await page.evaluate(() => window.scrollY)
		await touch('touchStart', 0)
		for (const dy of [-10, -30, -60, -90, -120, -150]) {
			await touch('touchMove', dy)
			await page.waitForTimeout(30)
		}
		await touch('touchEnd', 0)
		await cdp.detach()
		await expect
			.poll(() => page.evaluate(() => window.scrollY))
			.toBeGreaterThan(before + 50)
	})

	test('while filtered, the line above the list starts with the count', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, [
			{ title: 'Lemon rice', totalTime: 25 },
			{ title: 'Fish tacos', totalTime: 30 },
			{ title: 'Roast chicken', totalTime: 95 },
			{ title: 'Toast' },
		])
		const line = page.locator('[data-recipes-filtered]')
		await page.goto('/recipes?maxTime=30')
		await expect(line).toBeVisible()
		const parts = await line.evaluate((element) =>
			[...element.querySelectorAll('span, button')].map((part) =>
				part.textContent?.trim(),
			),
		)
		expect(parts.filter(Boolean)).toEqual([
			'3 of 4 Recipes',
			'Up to 30 min',
			'Clear search and filters',
		])

		await page.goto('/recipes?search=lemon')
		await expect(line).toHaveText(/^1 of 4 Recipes\s*Clear search and filters$/)

		// Wider, the title has the count, so the line names the filters, or
		// counts for a search alone.
		await page.setViewportSize({ width: 1280, height: 800 })
		await page.goto('/recipes?maxTime=30')
		await expect(
			page.getByRole('heading', { level: 1, name: 'Recipes (3 of 4)' }),
		).toBeVisible()
		await expect(line).toHaveText(/^Up to 30 min\s*Clear search and filters$/, {
			useInnerText: true,
		})
		await expect(line.getByText('3 of 4 Recipes')).toBeHidden()
		await page.goto('/recipes?search=lemon')
		await expect(line).toHaveText(/^1 of 4 Recipes\s*Clear search and filters$/)
		await page.setViewportSize({ width: 390, height: 844 })

		// Sort alone filters nothing.
		await page.goto('/recipes?sort=alphabetical')
		await expect(line).toHaveCount(0)
		await expect(page.getByText(/of 4 Recipes/)).toHaveCount(0)
	})

	test('filters that leave one Recipe, then none, say so; the hint names time and Favorites only when one is on', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, [
			{ title: 'Hummus', totalTime: 20, cuisine: 'Levantine' },
			{ title: 'Lamb shoulder', totalTime: 300, cuisine: 'Levantine' },
			{ title: 'Fish tacos', totalTime: 30, isFavorite: true },
		])
		const line = page.locator('[data-recipes-filtered]')
		const heading = page.getByRole('heading', {
			name: 'No Recipes match these filters',
		})
		const hint = page.getByText('Try a longer time, or turn Favorites off.', {
			exact: true,
		})

		await page.goto('/recipes?cuisine=levantine&maxTime=60')
		await expect(recipeLink(page, 'Hummus')).toBeVisible()
		await expect(recipeLink(page, 'Lamb shoulder')).toHaveCount(0)
		await expect(line).toContainText('1 of 3 Recipes')

		await page.goto('/recipes?cuisine=levantine&maxTime=60&favorites=true')
		await expect(heading).toBeVisible()
		await expect(hint).toBeVisible()
		await expect(line).toContainText('0 of 3 Recipes')
		await expect(page.getByText('clear all filters')).toHaveCount(0)

		await page.goto('/recipes?cuisine=levantine&quality=flagged')
		await expect(heading).toBeVisible()
		await expect(hint).toHaveCount(0)
		const clear = page.getByRole('button', {
			name: 'Clear search and filters',
		})
		await hydrated(clear)
		await clear.tap()
		await expect(page).toHaveURL(/\/recipes$/)
		await expect(recipeLink(page, 'Fish tacos')).toBeVisible()
	})
})

test.describe('the Getting started checklist', () => {
	test('keeps its space under the search row and the count line, and the list follows it', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, [
			{ title: 'Lemon rice', totalTime: 25 },
			{ title: 'Toast' },
		])
		const checklist = page.locator('[data-getting-started]')
		const first = recipeLink(page, 'Lemon rice')
		const gap = async (above: Locator, below: Locator) => {
			const a = await box(above)
			return Math.round((await box(below)).y - (a.y + a.height))
		}
		await page.goto('/recipes')
		await expect(checklist).toBeVisible()
		expect(await gap(pinnedRow(page), checklist)).toBe(12)
		expect(await gap(checklist, first)).toBeGreaterThan(0)

		await page.goto('/recipes?maxTime=30')
		await expect(checklist).toBeVisible()
		const line = page.locator('[data-recipes-filtered]')
		expect(await gap(pinnedRow(page), line)).toBe(0)
		expect(await gap(line, checklist)).toBe(12)

		// Without it the list starts right under the search row.
		await page
			.getByRole('button', { name: 'Dismiss getting started checklist' })
			.click()
		await expect(checklist).toHaveCount(0)
		await page.goto('/recipes')
		await expect(first).toBeVisible()
		expect(await gap(pinnedRow(page), first)).toBe(0)
	})
})

test.describe('a row', () => {
	test('is the name, a heart for a favourite, the time and description on one line, and the photo at the right', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, [
			{
				title: 'Shakshuka',
				description:
					'Eggs poached in a peppery tomato sauce, with plenty of bread to mop it all up.',
				totalTime: 35,
				isFavorite: true,
				photo: true,
			},
			{ title: 'Lentil soup', description: 'Red lentils and cumin.' },
			{ title: 'Toast' },
			{ title: 'Banana bread', totalTime: 75 },
		])
		await page.goto('/recipes')
		const shakshuka = recipeLink(page, 'Shakshuka')
		const name = shakshuka.getByRole('heading', { name: 'Shakshuka' })
		const nameSize = await name.evaluate((element) =>
			parseFloat(getComputedStyle(element).fontSize),
		)
		expect(nameSize).toBe(21.5)
		await expect(shakshuka.locator('[data-favorite]')).toBeVisible()
		// The heart says so to a screen reader.
		await expect(name).toHaveAccessibleName('Shakshuka Favorite')
		await expect(
			recipeLink(page, 'Toast').locator('[data-favorite]'),
		).toHaveCount(0)

		const meta = shakshuka.locator('[data-recipe-meta]')
		await expect(meta).toHaveText(/^35 min\s*Eggs poached/)
		const metaLook = await meta.evaluate((element) => {
			const time = element.firstElementChild!
			return {
				weight: getComputedStyle(time).fontWeight,
				oneLine:
					element.getBoundingClientRect().height <
					parseFloat(getComputedStyle(element).fontSize) * 2,
			}
		})
		expect(metaLook).toEqual({ weight: '600', oneLine: true })

		const photo = await box(shakshuka.locator('img'))
		const nameBox = await box(name)
		expect(photo.width).toBe(52)
		expect(photo.height).toBe(52)
		expect(photo.x).toBeGreaterThan(nameBox.x + nameBox.width)
		// On the content edge: the row's padding (the test browser keeps a
		// scrollbar gutter a phone doesn't have).
		const row = await box(shakshuka)
		expect(photo.x + photo.width).toBeCloseTo(row.x + row.width - 16, 0)

		// No photo: nothing at either end, no letter tile.
		const toast = recipeLink(page, 'Toast')
		await expect(
			toast.locator('img, [role="img"]').filter({ visible: true }),
		).toHaveCount(0)
		await expect(toast).toHaveAccessibleName('Toast')
		// Neither time nor description: no second line.
		await expect(toast.locator('[data-recipe-meta]')).toHaveCount(0)
		await expect(
			recipeLink(page, 'Lentil soup').locator('[data-recipe-meta]'),
		).toHaveText('Red lentils and cumin.')
		await expect(
			recipeLink(page, 'Banana bread').locator('[data-recipe-meta]'),
		).toHaveText('1 hr 15 min')

		// A cook-time filter says when the time is unknown.
		await page.goto('/recipes?maxTime=60')
		await expect(
			recipeLink(page, 'Toast').locator('[data-recipe-meta]'),
		).toHaveText('Time unknown')

		// A desktop card says nothing of it, so it is never said twice.
		await page.setViewportSize({ width: 1280, height: 800 })
		await expect(
			page.getByRole('heading', { name: 'Shakshuka', exact: true }),
		).toBeVisible()
		await expect(shakshuka).not.toHaveAccessibleName(/Favorite/)
	})

	test('at 320px a name wraps to three lines beside its photo without clipping, and a longer one stops at three', async ({
		page,
		login,
	}) => {
		// The test browser keeps a 15px scrollbar gutter a phone doesn't have,
		// so a 320px phone's layout needs a 335px window here.
		await page.setViewportSize({ width: 335, height: 640 })
		const user = await login()
		const fits = 'Slow-roasted lamb shoulder with anchovy and white beans'
		const tooLong =
			'Slow-roasted shoulder of lamb with anchovy, rosemary, garlic, lemon and white beans'
		const favorite = 'Lemon rice with curry leaves and peanuts'
		const longFavorite =
			'Slow-cooked beans with garlic, sage, rosemary, lemon peel and a lot of olive oil'
		await seedRecipes(user, [
			{ title: fits, totalTime: 300, photo: true },
			{ title: tooLong, photo: true },
			{ title: favorite, photo: true, isFavorite: true },
			{ title: longFavorite, photo: true, isFavorite: true },
		])
		await page.goto('/recipes')
		const look = (title: string) =>
			recipeLink(page, title)
				.getByRole('heading')
				.evaluate((heading) => {
					// The clamp is on the name inside the heading.
					const name = heading.firstElementChild as HTMLElement
					return {
						lines: Math.round(
							name.getBoundingClientRect().height /
								parseFloat(getComputedStyle(name).lineHeight),
						),
						clipped: name.scrollHeight > name.clientHeight + 1,
					}
				})
		expect(await look(fits)).toEqual({ lines: 3, clipped: false })
		expect(await look(tooLong)).toEqual({ lines: 3, clipped: true })
		expect(await look(longFavorite)).toEqual({ lines: 3, clipped: true })

		// A favorite's heart follows a name that fits, and ends the third line
		// of one that doesn't, beside the photo.
		const hearts = async (title: string) => {
			const link = recipeLink(page, title)
			const name = await box(link.getByRole('heading').locator(':scope > span'))
			const photo = await box(link.locator('img'))
			const shown = []
			for (const heart of await link
				.locator('[data-favorite]')
				.filter({ visible: true })
				.all()) {
				const at = await box(heart)
				if (at.y + at.height <= name.y + name.height + 0.5) shown.push(at)
			}
			return { shown, name, photo }
		}
		const fitting = await hearts(favorite)
		expect(fitting.shown).toHaveLength(1)
		const long = await hearts(longFavorite)
		expect(long.shown).toHaveLength(1)
		const heart = long.shown[0]!
		expect(heart.x + heart.width).toBeLessThanOrEqual(long.photo.x)
		expect(heart.y).toBeGreaterThan(long.name.y + long.name.height / 2)
		const link = recipeLink(page, fits)
		const nameBox = await box(link.getByRole('heading'))
		const photo = await box(link.locator('img'))
		const row = await box(link)
		expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(photo.x)
		expect(photo.x + photo.width).toBeCloseTo(row.x + row.width - 16, 0)
	})

	test('keeps its letter tile on a desktop card only', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedRecipes(user, [{ title: 'Toast' }])
		await page.goto('/recipes')
		await expect(recipeLink(page, 'Toast')).toBeVisible()
		await expect(page.getByRole('img', { name: 'Toast recipe' })).toHaveCount(0)
		await page.setViewportSize({ width: 1280, height: 800 })
		await expect(page.getByRole('img', { name: 'Toast recipe' })).toBeVisible()
	})
})

test.describe('a Menu row', () => {
	test('counts its Recipes, then gives the description or names them, with the guests at the right', async ({
		page,
		login,
	}) => {
		const user = await login()
		const [hummus, tabbouleh, lamb, salad] = await seedRecipes(user, [
			{ title: 'Hummus' },
			{ title: 'Tabbouleh' },
			{ title: 'Lamb shoulder' },
			{ title: 'Green salad' },
		])
		const menu = async (
			title: string,
			description: string | null,
			guests: number | null,
			recipeIds: string[],
		) =>
			prisma.menu.create({
				data: {
					title,
					titleKey: title.toLowerCase(),
					description,
					defaultGuestCount: guests,
					householdId: user.householdId,
					sections: {
						create: {
							items: {
								create: recipeIds.map((recipeId, order) => ({
									kind: 'recipe',
									recipeId,
									recipeTitle: 'x',
									order,
								})),
							},
						},
					},
				},
			})
		await menu('Mezze night', 'Small plates for a crowd.', 8, [
			hummus!,
			tabbouleh!,
			lamb!,
		])
		await menu('Sunday lunch', null, null, [lamb!, salad!])
		await menu('Salad bar', 'Only greens.', null, [salad!])
		await menu('Notes only', 'Just a reminder.', null, [])
		await page.goto('/recipes/menus')

		const meta = (title: string) =>
			page
				.getByRole('link', { name: new RegExp(`^${title}`) })
				.locator('[data-menu-meta]')
		await expect(meta('Mezze night')).toHaveText(
			/^3 Recipes\s*Small plates for a crowd\.$/,
		)
		await expect(meta('Sunday lunch')).toHaveText(
			/^2 Recipes\s*Lamb shoulder, Green salad$/,
		)
		await expect(meta('Salad bar')).toHaveText(/^1 Recipe\s*Only greens\.$/)
		await expect(meta('Notes only')).toHaveText('Just a reminder.')
		expect(
			await meta('Mezze night').evaluate(
				(element) => getComputedStyle(element.firstElementChild!).fontWeight,
			),
		).toBe('600')
		const mezze = page.getByRole('link', { name: /^Mezze night/ })
		const guests = await box(mezze.getByText('8 guests').first())
		const name = await box(mezze.getByRole('heading'))
		expect(guests.x).toBeGreaterThan(name.x + name.width)
		const nameSize = await mezze
			.getByRole('heading')
			.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
		expect(nameSize).toBe(21.5)
	})
})
