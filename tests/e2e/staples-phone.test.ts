import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { SHELL_UA, setShellSafeArea } from '#tests/native-shell.ts'
import {
	animationsFinished,
	expect,
	expectThumbSized,
	hydrated,
	test,
} from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function seedStaples(householdId: string, names: string[]) {
	await prisma.householdIngredient.createMany({
		data: names.map((displayName) => ({
			householdId,
			displayName,
			canonicalKey: displayName.toLowerCase(),
			isStaple: true,
		})),
	})
}

/** `count` Staples that sort in the order they are numbered. */
const many = (count: number) =>
	Array.from(
		{ length: count },
		(_, index) => `Staple ${String(index + 1).padStart(3, '0')}`,
	)

async function box(locator: Locator) {
	const found = await locator.boundingBox()
	expect(found, 'has a box').not.toBeNull()
	return found!
}

const searchField = (page: Page) =>
	page.getByRole('searchbox', { name: 'Search Staples' })
const pinnedRow = (page: Page) => page.locator('[data-staples-tools]')
const addStaple = (page: Page) =>
	page.getByRole('button', { name: 'Add Staple' })
const stapleList = (page: Page) => page.getByRole('list', { name: 'Staples' })
const stapleRow = (page: Page, name: string) =>
	stapleList(page).getByRole('listitem').filter({ hasText: name })
const scrollY = (page: Page) => () => page.evaluate(() => window.scrollY)

async function scrollTo(page: Page, y: number) {
	await page.evaluate((y) => window.scrollTo(0, y), y)
	await expect.poll(scrollY(page)).toBe(y)
	// The pinned state is read on the next frame.
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			),
	)
}

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

/** The resolved value of a color token, as the page paints it. */
function tokenColor(page: Page, token: string) {
	return page.evaluate((token) => {
		const probe = document.createElement('div')
		probe.style.color = `var(${token})`
		document.body.append(probe)
		const color = getComputedStyle(probe).color
		probe.remove()
		return color
	}, token)
}

/** Records every Need request the page sends. */
function recordNeedRequests(page: Page) {
	const sent: string[] = []
	page.on('request', (request) => {
		if (
			request.method() === 'POST' &&
			request.postData()?.includes('intent=add-staple-to-shop')
		) {
			sent.push(request.postData()!)
		}
	})
	return sent
}

test.describe('a row', () => {
	test('is at least 56px tall, its name on the content edge at 17px and weight 500, with hairlines between', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, ['Apples', 'Butter', 'Salt'])
		await page.goto('/staples')
		const rows = stapleList(page).getByRole('listitem')
		await expect(rows).toHaveCount(3)
		for (const name of ['Apples', 'Butter', 'Salt']) {
			const row = stapleRow(page, name)
			expect((await box(row)).height).toBeGreaterThanOrEqual(56)
			const label = row.getByText(name, { exact: true })
			expect((await box(label)).x).toBe(16)
			expect(
				await label.evaluate((element) => {
					const style = getComputedStyle(element)
					return [style.fontSize, style.fontWeight, style.textOverflow]
				}),
			).toEqual(['17px', '500', 'clip'])
		}
		// A hairline between rows, none above the first or below the last.
		const borders = await rows.evaluateAll((items) =>
			items.map((item) => {
				const style = getComputedStyle(item)
				return [
					parseFloat(style.borderTopWidth),
					parseFloat(style.borderBottomWidth),
				]
			}),
		)
		expect(borders[0]![0]).toBe(0)
		expect(borders.at(-1)![1]).toBe(0)
		for (let i = 0; i < borders.length - 1; i++) {
			expect(borders[i]![1]! + borders[i + 1]![0]!).toBe(1)
		}
	})

	test('at 320px a long name and a long word wrap beside a Need button that keeps its width, and nothing scrolls sideways', async ({
		page,
		login,
	}) => {
		// The test browser keeps a 15px scrollbar gutter: 335 lays out at 320.
		await page.setViewportSize({ width: 335, height: 700 })
		const user = await login()
		const sentence =
			'Extra virgin olive oil from the little shop by the old station'
		const word = 'Supercalifragilisticexpialidociousflour1'
		expect(sentence).toHaveLength(62)
		expect(word).toHaveLength(40)
		await seedStaples(user.householdId, ['Salt', sentence, word])
		await page.goto('/staples')
		// The page's own width, past any scrollbar gutter.
		const gutter = await page.evaluate(
			() =>
				window.innerWidth -
				document.getElementById('main-content')!.getBoundingClientRect().width,
		)
		await page.setViewportSize({ width: 320 + gutter, height: 700 })
		expect(
			await page.evaluate(
				() =>
					document.getElementById('main-content')!.getBoundingClientRect()
						.width,
			),
		).toBe(320)
		const shortButton = await box(
			stapleRow(page, 'Salt').getByRole('button', { name: 'Need, Salt' }),
		)
		for (const name of [sentence, word]) {
			const row = stapleRow(page, name)
			const label = row.getByText(name, { exact: true })
			const button = row.getByRole('button', { name: `Need, ${name}` })
			const [labelBox, buttonBox] = [await box(label), await box(button)]
			// Wrapped to two lines or more, all of it showing.
			expect(labelBox.height).toBeGreaterThan(40)
			expect(
				await label.evaluate(
					(element) =>
						element.scrollWidth <= element.clientWidth &&
						element.scrollHeight <= element.clientHeight,
				),
			).toBe(true)
			expect(buttonBox.width).toBe(shortButton.width)
			expect(buttonBox.height).toBeGreaterThanOrEqual(44)
			expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(buttonBox.x)
			expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(320 - 16 + 0.5)
		}
		expect(
			await page.evaluate(
				() =>
					document.documentElement.scrollWidth <=
					document.documentElement.clientWidth,
			),
		).toBe(true)
	})

	test('tapping Need on a two-line row keeps its height and the button its width', async ({
		page,
		login,
	}) => {
		await page.setViewportSize({ width: 335, height: 700 })
		const user = await login()
		const name = 'Smoked sweet paprika from the market on Saturdays'
		await seedStaples(user.householdId, [name])
		await page.goto('/staples')
		const row = stapleRow(page, name)
		const need = row.getByRole('button', { name: `Need, ${name}` })
		await hydrated(need)
		// Layout sizes, which the press's scale leaves alone.
		const size = (locator: Locator) =>
			locator.evaluate((element: HTMLElement) => [
				element.offsetWidth,
				element.offsetHeight,
			])
		const [rowBefore, buttonBefore] = [await size(row), await size(need)]
		expect(rowBefore[1]).toBeGreaterThan(56)
		await need.tap()
		const onList = row.getByRole('button', { name: `On list, ${name}` })
		await expect(onList).toBeVisible()
		expect((await size(row))[1]).toBe(rowBefore[1])
		expect((await size(onList))[0]).toBe(buttonBefore[0])
	})

	test('a tap on the row beside the name adds nothing', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, ['Salt'])
		const sent = recordNeedRequests(page)
		await page.goto('/staples')
		const row = stapleRow(page, 'Salt')
		await hydrated(row)
		const rowBox = await box(row)
		// The name, and the space between the name and the button.
		await page.touchscreen.tap(rowBox.x + 20, rowBox.y + rowBox.height / 2)
		await page.touchscreen.tap(rowBox.x + 150, rowBox.y + rowBox.height / 2)
		await page.waitForTimeout(600)
		expect(sent).toEqual([])
		await expect(row.getByRole('button', { name: 'Need, Salt' })).toBeVisible()
		expect(
			await prisma.shoppingListItem.count({
				where: { list: { householdId: user.householdId } },
			}),
		).toBe(0)
	})

	test('Need tapped on three rows within a second shows a failure on the failing row only', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, ['Apples', 'Failing beans', 'Salt'])
		await prisma.$executeRawUnsafe(`
			CREATE TRIGGER reject_failing_beans
			BEFORE INSERT ON "ShoppingListItem"
			WHEN NEW.name = 'Failing beans'
			BEGIN
				SELECT RAISE(ABORT, 'simulated shopping failure');
			END
		`)
		try {
			await page.goto('/staples')
			const apples = stapleRow(page, 'Apples')
			const beans = stapleRow(page, 'Failing beans')
			const salt = stapleRow(page, 'Salt')
			await hydrated(apples.getByRole('button', { name: 'Need, Apples' }))
			await apples.getByRole('button', { name: 'Need, Apples' }).tap()
			await beans.getByRole('button', { name: 'Need, Failing beans' }).tap()
			await salt.getByRole('button', { name: 'Need, Salt' }).tap()

			await expect(
				beans.getByRole('alert').filter({
					hasText: 'Could not add Failing beans to Next shop. Try again.',
				}),
			).toBeVisible()
			await expect(
				beans.getByRole('button', { name: 'Need, Failing beans' }),
			).toBeEnabled()
			await expect(
				apples.getByRole('button', { name: 'On list, Apples' }),
			).toBeVisible()
			await expect(
				salt.getByRole('button', { name: 'On list, Salt' }),
			).toBeVisible()
			await expect(page.getByRole('alert')).toHaveCount(1)
			await expect
				.poll(() =>
					prisma.shoppingListItem
						.findMany({
							where: { list: { householdId: user.householdId } },
							select: { name: true },
							orderBy: { name: 'asc' },
						})
						.then((rows) => rows.map((row) => row.name)),
				)
				.toEqual(['Apples', 'Salt'])
		} finally {
			await prisma.$executeRawUnsafe('DROP TRIGGER reject_failing_beans')
		}
	})

	test('a swipe that starts on Need opens the row and adds nothing', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, ['Apples', 'Salt'])
		const sent = recordNeedRequests(page)
		await page.goto('/staples')
		const row = stapleRow(page, 'Salt')
		const need = row.getByRole('button', { name: 'Need, Salt' })
		await hydrated(need)
		const needBox = await box(need)
		const y = needBox.y + needBox.height / 2
		const cdp = await page.context().newCDPSession(page)
		const at = (x: number) => [{ x, y, id: 1 }]
		const startX = needBox.x + needBox.width / 2
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: at(startX),
		})
		for (let i = 1; i <= 6; i++) {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: at(startX - i * 25),
			})
			await page.waitForTimeout(30)
		}
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchEnd',
			touchPoints: [],
		})
		await cdp.detach()

		await expect
			.poll(() =>
				row.evaluate(async (element) => {
					const layer = element.querySelector<HTMLElement>('.touch-pan-y')!
					await Promise.all(layer.getAnimations().map((a) => a.finished))
					return new DOMMatrix(getComputedStyle(layer).transform).m41
				}),
			)
			.toBe(-76)
		await page.waitForTimeout(400)
		expect(sent).toEqual([])
		await expect(row.getByRole('button', { name: 'Need, Salt' })).toBeVisible()
	})
})

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`in ${scheme}`, () => {
		test.use({ colorScheme: scheme })

		test(`Need is a quiet pill and On list is green text that clears 4.5:1 (${scheme})`, async ({
			page,
			login,
		}) => {
			const user = await login()
			await seedStaples(user.householdId, ['Salt'])
			await page.goto('/staples')
			const row = stapleRow(page, 'Salt')
			const need = row.getByRole('button', { name: 'Need, Salt' })
			await hydrated(need)
			const muted = await page.evaluate(() => {
				const probe = document.createElement('div')
				probe.style.backgroundColor = 'var(--muted)'
				document.body.append(probe)
				const color = getComputedStyle(probe).backgroundColor
				probe.remove()
				return color
			})
			expect(
				await need.evaluate((element) => {
					const style = getComputedStyle(element)
					return {
						background: style.backgroundColor,
						border: style.borderTopWidth,
						size: style.fontSize,
						weight: style.fontWeight,
						height: element.getBoundingClientRect().height,
					}
				}),
			).toEqual({
				background: muted,
				border: '0px',
				size: '14px',
				weight: '600',
				height: 44,
			})
			expect(await contrastOnPage(need)).toBeGreaterThanOrEqual(4.5)

			await need.tap()
			const onList = row.getByRole('button', { name: 'On list, Salt' })
			await expect(onList).toHaveText('On list')
			await expect(onList).toBeEnabled()
			await animationsFinished(page)
			// Focused by the tap, with no ring: that is for the keyboard.
			await expect(onList).toBeFocused()
			expect(
				await onList.evaluate((element) => getComputedStyle(element).boxShadow),
			).not.toMatch(/ [1-9][\d.]*px/)
			expect(
				await onList.evaluate(
					(element) => getComputedStyle(element).backgroundColor,
				),
			).toBe('rgba(0, 0, 0, 0)')
			const words = onList.getByText('On list', { exact: true })
			expect(
				await words.evaluate((element) => getComputedStyle(element).color),
			).toBe(await tokenColor(page, '--primary'))
			expect(await contrastOnPage(words)).toBeGreaterThanOrEqual(4.5)
		})
	})
}

test.describe('the search row', () => {
	test('shows from 12 Staples and not at 11', async ({ page, login }) => {
		const user = await login()
		await seedStaples(user.householdId, many(11))
		await page.goto('/staples')
		await expect(stapleList(page).getByRole('listitem')).toHaveCount(11)
		await expect(searchField(page)).toHaveCount(0)
		await expect(pinnedRow(page)).toHaveCount(0)

		await seedStaples(user.householdId, ['Staple 012'])
		await page.goto('/staples')
		await expect(stapleList(page).getByRole('listitem')).toHaveCount(12)
		await expect(searchField(page)).toBeVisible()
		await expect(pinnedRow(page)).toHaveCount(1)
	})

	test('stays pinned under the status bar while the list scrolls, opaque with a hairline, as the title scrolls away', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, many(40))
		await page.goto('/staples')
		await hydrated(searchField(page))
		const title = page.getByRole('heading', { level: 1, name: 'Staples' })
		const resting = await box(searchField(page))
		await scrollTo(page, 900)
		const pinned = await box(searchField(page))
		expect(pinned.y).toBe(14)
		expect(resting.y).toBeGreaterThan(pinned.y)
		expect((await box(title)).y + (await box(title)).height).toBeLessThan(0)
		expect(
			await pinnedRow(page).evaluate((element) => {
				const style = getComputedStyle(element)
				return [style.backgroundColor, style.borderBottomWidth]
			}),
		).toEqual([
			await page.evaluate(
				() => getComputedStyle(document.body).backgroundColor,
			),
			'1px',
		])
		// A row's control scrolled to lands below it.
		const need = page.getByRole('button', { name: 'Need, Staple 020' })
		await need.evaluate((element) => element.scrollIntoView({ block: 'start' }))
		await expect.poll(scrollY(page)).toBeGreaterThan(900)
		const needBox = await box(need)
		const rowAt = await box(pinnedRow(page))
		expect(rowAt.y).toBe(0)
		expect(needBox.y).toBeGreaterThanOrEqual(rowAt.y + rowAt.height)
	})

	test('focusing its field far down the list keeps the page where it is', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, many(40))
		await page.goto('/staples')
		await hydrated(searchField(page))
		await scrollTo(page, 1500)
		// From the keyboard: back from the first Need under the pinned row.
		await searchField(page).focus()
		expect(await scrollY(page)()).toBe(1500)
		await page.keyboard.press('Tab')
		await page.keyboard.press('Shift+Tab')
		await expect(searchField(page)).toBeFocused()
		expect(await scrollY(page)()).toBe(1500)
	})

	test('its clear button empties the field, shows every Staple again and keeps focus there', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, [...many(12), 'Brown rice'])
		await page.goto('/staples')
		const field = searchField(page)
		await hydrated(field)
		const clear = page.getByRole('button', { name: 'Clear the search field' })
		await expect(clear).toHaveCount(0)
		await field.fill('rice')
		await expect(stapleList(page).getByRole('listitem')).toHaveCount(1)
		await expectThumbSized(clear)
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
		await expect(stapleList(page).getByRole('listitem')).toHaveCount(13)
		await expect(clear).toHaveCount(0)
	})

	test('a delete that takes the list from 12 to 11 while scrolled keeps the field, its search and the list where they are', async ({
		page,
		login,
	}) => {
		await page.setViewportSize({ width: 390, height: 600 })
		const user = await login()
		await seedStaples(user.householdId, many(12))
		await page.goto('/staples')
		const field = searchField(page)
		await hydrated(field)
		await field.fill('Staple')
		await field.blur()
		await scrollTo(page, 300)
		const reference = stapleRow(page, 'Staple 008')
		const target = stapleRow(page, 'Staple 009')
		const before = await box(reference)
		const del = target.getByRole('button', { name: 'Delete Staple 009' })
		await target.getByRole('button', { name: 'Need, Staple 009' }).focus()
		await page.keyboard.press('Tab')
		await expect(del).toBeFocused()
		const settled = page.waitForResponse(
			(response) =>
				response.url().includes('/staples.data') &&
				response.request().method() === 'GET',
		)
		await page.keyboard.press('Enter')
		await expect(target).toBeHidden()
		await expect
			.poll(() =>
				prisma.householdIngredient.count({
					where: { householdId: user.householdId, isStaple: true },
				}),
			)
			.toBe(11)
		await settled
		await animationsFinished(page)
		await expect(field).toBeVisible()
		await expect(field).toHaveValue('Staple')
		expect((await box(reference)).y).toBe(before.y)
		const pinned = await box(pinnedRow(page))
		expect(pinned.y).toBe(0)
		expect((await box(field)).y).toBe(14)
	})

	test('reloaded far down the list, it is pinned with its + before any scroll', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, many(40))
		await page.goto('/staples')
		await hydrated(searchField(page))
		await scrollTo(page, 1500)
		await page.reload()
		await hydrated(searchField(page))
		await expect.poll(scrollY(page)).toBeGreaterThan(1000)
		await expect(
			pinnedRow(page).getByRole('button', { name: 'Add Staple' }),
		).toBeVisible()
		await expect(addStaple(page)).toHaveCount(1)
	})

	test('the offline notice opens below it, at rest and scrolled', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, many(30))
		await page.goto('/staples')
		await hydrated(searchField(page))
		await page.context().setOffline(true)
		await offlineNotice(page)
		for (const y of [0, 900]) {
			await scrollTo(page, y)
			const row = await box(pinnedRow(page))
			if (y > 0) expect(row.y).toBe(0)
			else expect(row.y).toBeGreaterThan(100)
			expect((await offlineNotice(page)).y).toBeGreaterThanOrEqual(
				row.y + row.height,
			)
		}
	})

	test('with the demo banner, the offline notice opens below it at rest', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.user.update({
			where: { id: user.id },
			data: { demoExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
		})
		await seedStaples(user.householdId, many(30))
		await page.goto('/staples')
		await hydrated(searchField(page))
		await expect(page.getByRole('region', { name: 'Demo' })).toBeVisible()
		await page.context().setOffline(true)
		const notice = await offlineNotice(page)
		const row = await box(pinnedRow(page))
		expect(notice.y).toBeGreaterThanOrEqual(row.y + row.height)
	})

	for (const width of [335, 390, 700]) {
		test(`the toasts' line clears it where it rests at ${width}px`, async ({
			page,
			login,
		}) => {
			await page.setViewportSize({ width, height: 844 })
			const user = await login()
			await seedStaples(user.householdId, many(30))
			await page.goto('/staples')
			await hydrated(searchField(page))
			const row = await box(pinnedRow(page))
			// Read where a toaster would, through a probe, since it is a calc.
			const bottom = await page.evaluate(() => {
				const toaster = document.createElement('div')
				toaster.setAttribute('data-sonner-toaster', '')
				const probe = document.createElement('div')
				probe.style.height = 'var(--pinned-header-bottom, 0px)'
				toaster.append(probe)
				document.body.append(toaster)
				const height = probe.getBoundingClientRect().height
				toaster.remove()
				return height
			})
			expect(bottom).toBeGreaterThanOrEqual(row.y + row.height)
			expect(bottom).toBeLessThan(row.y + row.height + 24)
		})
	}

	test.describe('in the iOS app', () => {
		test.use({ userAgent: SHELL_UA })

		test('pins under the status bar inset', async ({ page, login }) => {
			const user = await login()
			await seedStaples(user.householdId, many(30))
			await setShellSafeArea(page, { top: 47, bottom: 34 })
			await page.goto('/staples')
			await hydrated(searchField(page))
			await scrollTo(page, 900)
			expect((await box(pinnedRow(page))).y).toBe(47)
			expect((await box(searchField(page))).y).toBe(47 + 14)
			await searchField(page).focus()
			expect(await scrollY(page)()).toBe(900)
		})
	})
})

test.describe('the pinned +', () => {
	test('only one Add Staple is reachable at a time: the title’s at the top, the pinned row’s far down', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, many(40))
		await page.goto('/staples')
		await hydrated(searchField(page))
		const titlePlus = page.locator('[data-title-add]')
		const pinnedPlus = pinnedRow(page).getByRole('button', {
			name: 'Add Staple',
		})
		await expect(addStaple(page)).toHaveCount(1)
		await expect(titlePlus).toBeVisible()
		await expect(pinnedPlus).toHaveCount(0)

		// A scroll, and a jump that crosses no line on the way.
		for (const y of [1500, 0, 1700]) {
			await scrollTo(page, y)
			await expect(addStaple(page)).toHaveCount(1)
			if (y === 0) {
				await expect(titlePlus).toBeVisible()
			} else {
				await expectThumbSized(pinnedPlus)
				const [plus, row] = [await box(pinnedPlus), await box(pinnedRow(page))]
				const page390 = await page.evaluate(
					() =>
						document.getElementById('main-content')!.getBoundingClientRect()
							.width,
				)
				expect(plus.x + plus.width).toBe(page390 - 16)
				expect(plus.y).toBeGreaterThanOrEqual(row.y)
			}
		}
		// Wider, where the field stops short, the + still ends the row.
		await page.setViewportSize({ width: 700, height: 844 })
		await scrollTo(page, 1500)
		const wide = await box(pinnedPlus)
		const content = await page.evaluate(() =>
			document.getElementById('main-content')!.getBoundingClientRect(),
		)
		expect(wide.x + wide.width).toBe(content.width - 32)
	})

	test('opens the add form at the top of the page with its field focused inside the tap', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, many(40))
		await page.goto('/staples')
		await hydrated(searchField(page))
		await scrollTo(page, 1500)
		await page.evaluate(() => {
			const w = window as unknown as { focusAtClick: string[] }
			w.focusAtClick = []
			// After the page's own handler, still inside the tap.
			window.addEventListener('click', () =>
				w.focusAtClick.push(document.activeElement?.id ?? ''),
			)
		})
		await pinnedRow(page).getByRole('button', { name: 'Add Staple' }).tap()
		const field = page.getByRole('textbox', { name: 'Add a Staple' })
		await expect(field).toBeFocused()
		expect(
			await page.evaluate(
				() => (window as unknown as { focusAtClick: string[] }).focusAtClick,
			),
		).toEqual(['new-staple'])
		const fieldBox = await box(field)
		expect(fieldBox.y).toBeGreaterThanOrEqual(0)
		// Above where the keyboard comes up.
		expect(fieldBox.y + fieldBox.height).toBeLessThan(844 / 2)
	})

	test('focus on it moves to the title’s + when the page goes back to the top', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, many(40))
		await page.goto('/staples')
		await hydrated(searchField(page))
		await scrollTo(page, 1500)
		const pinnedPlus = pinnedRow(page).getByRole('button', {
			name: 'Add Staple',
		})
		await pinnedPlus.focus()
		await scrollTo(page, 0)
		await expect(page.locator('[data-title-add]')).toBeFocused()
		await scrollTo(page, 1500)
		await expect(pinnedPlus).toBeFocused()
	})

	test('Cancel and Escape give focus back to a + on the screen', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, many(40))
		await page.goto('/staples')
		await hydrated(searchField(page))
		const field = page.getByRole('textbox', { name: 'Add a Staple' })
		for (const how of ['Cancel', 'Escape'] as const) {
			await scrollTo(page, 1500)
			await pinnedRow(page).getByRole('button', { name: 'Add Staple' }).tap()
			await expect(field).toBeFocused()
			if (how === 'Cancel')
				await page.getByRole('button', { name: 'Cancel' }).tap()
			else await page.keyboard.press('Escape')
			await expect(field).toBeHidden()
			const focused = page.locator(':focus')
			await expect(focused).toHaveAccessibleName('Add Staple')
			const focusedBox = await box(focused)
			expect(focusedBox.y).toBeGreaterThanOrEqual(0)
			expect(focusedBox.y + focusedBox.height).toBeLessThanOrEqual(844)
		}
	})
})

test.describe('the keyboard', () => {
	test('Tab goes from the title’s +, to Search and its clear, then each row’s Need and Delete', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, [...many(11), 'Apples'])
		await page.goto('/staples')
		await hydrated(searchField(page))
		await searchField(page).fill('Apples')
		await expect(stapleList(page).getByRole('listitem')).toHaveCount(1)
		await page.getByRole('heading', { level: 1, name: 'Staples' }).click()
		const order: string[] = []
		for (let i = 0; i < 5; i++) {
			await page.keyboard.press('Tab')
			order.push(
				await page.evaluate(
					() =>
						document.activeElement?.getAttribute('aria-label') ??
						document.activeElement?.id ??
						'',
				),
			)
		}
		expect(order).toEqual([
			'Add Staple',
			'search-staples',
			'Clear the search field',
			'Need, Apples',
			'Delete Apples',
		])
	})

	test('a Need reached from the keyboard under the pinned row shows its whole focus ring', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, many(40))
		await page.goto('/staples')
		await hydrated(searchField(page))
		await scrollTo(page, 1500)
		// The row half under the pinned row, reached back from the next one.
		const row = await box(pinnedRow(page))
		const hidden = await page.evaluate(
			(bottom) =>
				[...document.querySelectorAll('[aria-label^="Need, "]')]
					.map((element) => element.getAttribute('aria-label')!)
					.find((_, index, all) => {
						const element = document.querySelector(
							`[aria-label="${all[index]}"]`,
						)!
						const box = element.getBoundingClientRect()
						return box.bottom > 0 && box.top < bottom
					})!,
			row.y + row.height,
		)
		const need = page.getByRole('button', { name: hidden, exact: true })
		const index = Number(hidden.slice(-3))
		const next = page.getByRole('button', {
			name: `Need, Staple ${String(index + 1).padStart(3, '0')}`,
			exact: true,
		})
		await next.focus()
		await page.keyboard.press('Shift+Tab')
		await page.keyboard.press('Shift+Tab')
		await expect(need).toBeFocused()
		const ring = await need.evaluate((element) => {
			const box = element.getBoundingClientRect()
			// ring-2 with ring-offset-2: 4px outside the box.
			const r = {
				top: box.top - 4,
				right: box.right + 4,
				bottom: box.bottom + 4,
			}
			let clip = { top: -Infinity, right: Infinity, bottom: Infinity }
			// Up to the row's list item; the page's own boxes clip nothing.
			for (
				let el = element.parentElement;
				el && el.tagName !== 'UL';
				el = el.parentElement
			) {
				const style = getComputedStyle(el)
				if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
					const b = el.getBoundingClientRect()
					clip = {
						top: Math.max(clip.top, b.top),
						right: Math.min(clip.right, b.right),
						bottom: Math.min(clip.bottom, b.bottom),
					}
				}
			}
			return { r, clip, shadow: getComputedStyle(element).boxShadow }
		})
		expect(ring.shadow).not.toBe('none')
		const pinnedBottom =
			(await box(pinnedRow(page))).y + (await box(pinnedRow(page))).height
		expect(ring.r.top).toBeGreaterThanOrEqual(pinnedBottom)
		expect(ring.r.right).toBeLessThanOrEqual(ring.clip.right)
		expect(ring.r.top).toBeGreaterThanOrEqual(ring.clip.top)
		expect(ring.r.bottom).toBeLessThanOrEqual(ring.clip.bottom)
	})
})

test.describe('the add form', () => {
	test('has a 44px field, Add as the green button and Cancel as the quiet one', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/staples')
		const plus = addStaple(page)
		await hydrated(plus)
		await plus.tap()
		const field = page.getByRole('textbox', { name: 'Add a Staple' })
		await expect(field).toBeFocused()
		expect((await box(field)).height).toBe(44)
		await field.fill('Salt')
		const [fill, muted] = await page.evaluate(() => {
			const probe = document.createElement('div')
			document.body.append(probe)
			probe.style.backgroundColor = 'var(--primary-fill)'
			const fill = getComputedStyle(probe).backgroundColor
			probe.style.backgroundColor = 'var(--muted)'
			const muted = getComputedStyle(probe).backgroundColor
			probe.remove()
			return [fill, muted]
		})
		const background = (locator: Locator) =>
			locator.evaluate((element) => getComputedStyle(element).backgroundColor)
		const add = page.getByRole('button', { name: 'Add', exact: true })
		const cancel = page.getByRole('button', { name: 'Cancel' })
		expect(await background(add)).toBe(fill)
		expect(await background(cancel)).toBe(muted)
		expect((await box(add)).height).toBe(44)
		expect((await box(cancel)).height).toBe(44)
	})
})

test.describe('the empty states', () => {
	test('No Staples found sits on the page, its heading in the serif', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, many(12))
		await page.goto('/staples')
		await hydrated(searchField(page))
		await searchField(page).fill('nothing like this')
		const heading = page.getByRole('heading', { name: 'No Staples found' })
		await expect(heading).toBeVisible()
		const look = await heading.evaluate((element) => {
			const fills: string[] = []
			for (
				let el = element.parentElement;
				el && el !== document.body;
				el = el.parentElement
			) {
				const bg = getComputedStyle(el).backgroundColor
				if (bg !== 'rgba(0, 0, 0, 0)') fills.push(bg)
			}
			return {
				family: getComputedStyle(element).fontFamily,
				fills,
			}
		})
		expect(look.family).toMatch(/Newsreader/)
		// Nothing between it and the page but the page itself.
		const body = await page.evaluate(
			() => getComputedStyle(document.body).backgroundColor,
		)
		expect(look.fills.every((fill) => fill === body)).toBe(true)
	})

	test('No Staples yet and its suggestions sit on the page', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/staples')
		const heading = page.getByRole('heading', { name: 'No Staples yet' })
		await expect(heading).toBeVisible()
		const body = await page.evaluate(
			() => getComputedStyle(document.body).backgroundColor,
		)
		const fills = await heading.evaluate((element) => {
			const fills: string[] = []
			for (
				let el = element.parentElement;
				el && el !== document.body;
				el = el.parentElement
			) {
				const bg = getComputedStyle(el).backgroundColor
				if (bg !== 'rgba(0, 0, 0, 0)') fills.push(bg)
			}
			return fills
		})
		expect(fills.every((fill) => fill === body)).toBe(true)
		expect(
			await heading.evaluate((element) => getComputedStyle(element).fontFamily),
		).toMatch(/Newsreader/)
		await expect(
			page
				.getByRole('list', { name: 'Suggested Staples' })
				.locator('[data-slot="chip"]')
				.first(),
		).toBeVisible()
	})
})

test.describe('a long list', () => {
	test('a swipe on one of 200 rows slides only that row, by a transform', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, many(200))
		await page.goto('/staples')
		await hydrated(searchField(page))
		await expect(stapleList(page).getByRole('listitem')).toHaveCount(200)
		const row = stapleRow(page, 'Staple 005')
		const neighbour = stapleRow(page, 'Staple 006')
		const before = await box(neighbour)
		const rowBox = await box(row)
		const y = rowBox.y + rowBox.height / 2
		const cdp = await page.context().newCDPSession(page)
		const at = (x: number) => [{ x, y, id: 1 }]
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: at(300),
		})
		for (let i = 1; i <= 6; i++) {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: at(300 - i * 25),
			})
			await page.waitForTimeout(30)
		}
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchEnd',
			touchPoints: [],
		})
		await cdp.detach()
		await animationsFinished(page)
		// Open by a transform alone: its box in the layout has not moved.
		expect(
			await row.evaluate((element) => {
				const layer = element.querySelector<HTMLElement>('.touch-pan-y')!
				return [
					layer.offsetLeft,
					new DOMMatrix(getComputedStyle(layer).transform).m41,
				]
			}),
		).toEqual([0, -76])
		expect(await box(neighbour)).toEqual(before)
	})
})
