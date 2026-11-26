import { type Page, type Response } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, openShopping, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 } })

type Seed = {
	name: string
	checked?: boolean
	quantity?: string
	horizon?: 'next' | 'later'
}

async function seed(user: { id: string; householdId: string }, items: Seed[]) {
	await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: { create: items },
		},
	})
}

const row = (page: Page, name: string) =>
	page.getByRole('group', { name: `${name} shopping item` })

/** Next shop's rows in a group, each wrapped in its fold. */
const groupRows = (page: Page, which: 'to-buy' | 'checked') =>
	page.locator(
		`[data-testid="next-shopping-items"] [data-row-collapse][data-shopping-group="${which}"]`,
	)

/** The rows showing in a group, top to bottom; folded rows don't count. */
async function namesIn(page: Page, which: 'to-buy' | 'checked') {
	return groupRows(page, which).evaluateAll((wrappers) =>
		wrappers
			.filter((wrapper) => !wrapper.hasAttribute('data-hidden'))
			.map((wrapper) =>
				wrapper
					.querySelector('[aria-label$=" shopping item"]')!
					.getAttribute('aria-label')!
					.replace(/ shopping item$/, ''),
			),
	)
}

/** The fold wrapper of a row in a group, found even while it is shut. */
const wrapperIn = (page: Page, which: 'to-buy' | 'checked', name: string) =>
	groupRows(page, which).filter({
		has: page.locator(`[aria-label="${name} shopping item"]`),
	})

/** The rows showing in Later, top to bottom. */
async function namesInLater(page: Page) {
	return page
		.locator('#later-shopping-items [data-row-collapse]')
		.evaluateAll((wrappers) =>
			wrappers
				.filter((wrapper) => !wrapper.hasAttribute('data-hidden'))
				.map((wrapper) =>
					wrapper
						.querySelector('[aria-label$=" shopping item"]')!
						.getAttribute('aria-label')!
						.replace(/ shopping item$/, ''),
				),
		)
}

const isCheckWrite = (response: Response) =>
	response.url().includes('/resources/shopping-check') &&
	response.request().method() === 'POST'

/** Stops the page's clock, so a row's half second lasts until we move it on. */
async function pauseClock(page: Page) {
	const now = await page.evaluate(() => Date.now())
	await page.clock.pauseAt(now + 1000)
}

/** Moves the paused clock on a little at a time until `names` holds. */
async function advanceUntil(
	page: Page,
	which: 'to-buy' | 'checked',
	names: string[],
) {
	await expect
		.poll(
			async () => {
				await page.clock.runFor(100)
				return namesIn(page, which)
			},
			{ intervals: [50] },
		)
		.toEqual(names)
}

async function savedChecks(householdId: string) {
	const items = await prisma.shoppingListItem.findMany({
		where: { list: { householdId } },
		select: { name: true, checked: true },
		orderBy: { name: 'asc' },
	})
	return Object.fromEntries(items.map((item) => [item.name, item.checked]))
}

test.describe('a row checked off on a phone', () => {
	test('keeps its place for half a second once its check is saved, then folds to the top of Checked', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user, [
			{ name: 'Apples' },
			{ name: 'Bread', checked: true },
			{ name: 'Rice' },
		])
		await page.clock.install()
		await openShopping(page)
		await pauseClock(page)

		const saved = page.waitForResponse(isCheckWrite)
		await row(page, 'Rice')
			.getByRole('button', { name: 'Check off Rice' })
			.click()
		await saved
		await expect(page.locator('[id^="check-status-"]')).toHaveCount(0)
		await expect(
			row(page, 'Rice').getByRole('button', { name: 'Uncheck Rice' }),
		).toBeVisible()
		expect(await namesIn(page, 'to-buy')).toEqual(['Apples', 'Rice'])
		// The menu waits while the row is on its way.
		await expect(
			row(page, 'Rice').getByRole('button', { name: 'Item actions' }),
		).toBeDisabled()

		await page.clock.runFor(450)
		expect(await namesIn(page, 'to-buy')).toEqual(['Apples', 'Rice'])

		// Half a second on, it folds where it was.
		await page.clock.runFor(60)
		await expect(wrapperIn(page, 'to-buy', 'Rice')).toHaveAttribute(
			'data-hidden',
			'',
		)
		await advanceUntil(page, 'checked', ['Rice', 'Bread'])
		await expect(wrapperIn(page, 'to-buy', 'Rice')).toHaveCount(0)
		expect(await savedChecks(user.householdId)).toEqual({
			Apples: false,
			Bread: true,
			Rice: true,
		})
	})

	test('keeps its place when the list reloads inside the half second', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user, [
			{ name: 'Apples' },
			{ name: 'Bread', checked: true },
			{ name: 'Rice' },
		])
		await page.clock.install()
		await openShopping(page)
		await pauseClock(page)

		const saved = page.waitForResponse(isCheckWrite)
		await row(page, 'Rice')
			.getByRole('button', { name: 'Check off Rice' })
			.click()
		await saved

		// An add from the sheet saves, then reloads the list.
		await page.getByRole('button', { name: 'Add an item' }).click()
		const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })
		await sheet.getByPlaceholder('Add an item…').fill('Cheese')
		const reloaded = page.waitForResponse(
			(response) =>
				response.request().method() === 'GET' &&
				response.url().includes('/shopping.data'),
		)
		await sheet.getByRole('button', { name: 'Add to Next shop' }).click()
		await reloaded
		// The saved row, not the one shown while the add was out: the reload
		// has rendered.
		await expect(
			page.locator(
				'[aria-label="Cheese shopping item"]:not([data-optimistic-row])',
			),
		).toBeAttached()
		await expect(
			sheet.getByRole('button', { name: 'Undo adding Cheese' }),
		).toBeVisible()

		expect(await namesIn(page, 'to-buy')).toEqual(['Apples', 'Cheese', 'Rice'])
		await expect(
			row(page, 'Rice').getByRole('button', { name: 'Uncheck Rice' }),
		).toBeAttached()

		await page.clock.runFor(510)
		await advanceUntil(page, 'checked', ['Rice', 'Bread'])
		expect(await namesIn(page, 'to-buy')).toEqual(['Apples', 'Cheese'])
	})

	test('keeps its place when a change from the other phone arrives inside the half second', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user, [
			{ name: 'Apples' },
			{ name: 'Bread', checked: true },
			{ name: 'Rice' },
		])
		// The change arrives by the poll, whose timing the test controls.
		await page.route('**/resources/household-events', (route) => route.abort())
		await page.clock.install()
		await openShopping(page)
		await pauseClock(page)

		await page.request.post('/shopping', {
			form: { intent: 'add', name: 'Cheese', originClientId: 'other-phone' },
		})
		const polled = page.waitForResponse((response) =>
			response.url().includes('/resources/household-events-poll'),
		)
		await page.clock.fastForward(30_100)
		await (await polled).finished()
		// The page has read the poll: its refresh now waits out a 500ms
		// debounce. Check Rice off 100ms into it.
		await page.evaluate(() => 0)
		await page.clock.runFor(100)
		const saved = page.waitForResponse(isCheckWrite)
		await row(page, 'Rice')
			.getByRole('button', { name: 'Check off Rice' })
			.click()
		await saved

		const refreshed = page.waitForResponse(
			(response) =>
				response.request().method() === 'GET' &&
				response.url().includes('/shopping.data'),
		)
		await page.clock.runFor(450)
		await refreshed
		await expect(row(page, 'Cheese')).toBeVisible()
		// 450ms into Rice's half second, the refresh has landed.
		expect(await namesIn(page, 'to-buy')).toEqual(['Apples', 'Cheese', 'Rice'])
		await expect(
			row(page, 'Rice').getByRole('button', { name: 'Uncheck Rice' }),
		).toBeVisible()

		await page.clock.runFor(60)
		await advanceUntil(page, 'checked', ['Rice', 'Bread'])
	})

	test('Clear checked inside the half second clears the rows under Checked and leaves the held row to move', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user, [
			{ name: 'Apples' },
			{ name: 'Bread', checked: true },
			{ name: 'Rice' },
		])
		await page.clock.install()
		await openShopping(page)
		await pauseClock(page)

		const saved = page.waitForResponse(isCheckWrite)
		await row(page, 'Rice')
			.getByRole('button', { name: 'Check off Rice' })
			.click()
		await saved
		// The delete goes at once and reloads the list behind it.
		const reloaded = page.waitForResponse(
			(response) =>
				response.request().method() === 'GET' &&
				response.url().includes('/shopping.data'),
		)
		await page
			.getByRole('button', { name: 'Clear checked items from Next shop' })
			.click()
		await expect(row(page, 'Bread')).toBeHidden()
		await reloaded
		// The held row is not part of it, and still holds after the reload.
		expect(await savedChecks(user.householdId)).toEqual({
			Apples: false,
			Rice: true,
		})
		await expect.poll(() => namesIn(page, 'to-buy')).toEqual(['Apples', 'Rice'])
		await expect(wrapperIn(page, 'checked', 'Bread')).toHaveCount(0)

		await page.clock.runFor(510)
		await advanceUntil(page, 'checked', ['Rice'])
		await expect(
			page.getByRole('heading', { name: 'Checked', exact: true }),
		).toBeVisible()
	})

	for (const direction of ['to buy', 'Checked'] as const) {
		test(`a tap taking back a saved change keeps the row under ${direction} while that tap is out`, async ({
			page,
			login,
		}) => {
			const user = await login()
			await seed(user, [
				{ name: 'Apples' },
				{ name: 'Bread', checked: direction === 'Checked' },
				{ name: 'Rice' },
			])
			const row = direction === 'Checked' ? 'Bread' : 'Rice'
			const first = direction === 'Checked' ? 'Uncheck' : 'Check off'
			const second = direction === 'Checked' ? 'Check off' : 'Uncheck'
			let held: (() => void) | null = null
			let writes = 0
			await page.route('**/resources/shopping-check?*', async (route) => {
				if (route.request().method() !== 'POST') return route.continue()
				if (++writes === 1) return route.continue()
				await new Promise<void>((resolve) => (held = resolve))
				await route.continue()
			})
			await page.clock.install()
			await openShopping(page)
			await pauseClock(page)

			const saved = page.waitForResponse(isCheckWrite)
			await page
				.getByRole('group', { name: `${row} shopping item` })
				.getByRole('button', { name: `${first} ${row}` })
				.click()
			await saved
			await page
				.getByRole('group', { name: `${row} shopping item` })
				.getByRole('button', { name: `${second} ${row}` })
				.click()
			await expect.poll(() => held !== null).toBe(true)
			const expected =
				direction === 'Checked'
					? { toBuy: ['Apples', 'Rice'], checked: ['Bread'] }
					: { toBuy: ['Apples', 'Bread', 'Rice'], checked: [] }
			expect(await namesIn(page, 'to-buy')).toEqual(expected.toBuy)
			expect(await namesIn(page, 'checked')).toEqual(expected.checked)
			// Long after the half second, it still waits where it was.
			await page.clock.runFor(1000)
			expect(await namesIn(page, 'to-buy')).toEqual(expected.toBuy)
			expect(await namesIn(page, 'checked')).toEqual(expected.checked)

			held!()
			await expect(page.locator('[id^="check-status-"]')).toHaveCount(0)
			await page.clock.runFor(1000)
			expect(await namesIn(page, 'to-buy')).toEqual(expected.toBuy)
			expect(await namesIn(page, 'checked')).toEqual(expected.checked)
			expect(await savedChecks(user.householdId)).toEqual({
				Apples: false,
				Bread: direction === 'Checked',
				Rice: false,
			})
		})
	}

	test('an uncheck that fails after taking back a saved check leaves the row among the rows to buy, with Retry', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user, [
			{ name: 'Apples' },
			{ name: 'Bread', checked: true },
			{ name: 'Rice' },
		])
		let writes = 0
		await page.route('**/resources/shopping-check?*', (route) => {
			if (route.request().method() !== 'POST') return route.continue()
			return ++writes === 1 ? route.continue() : route.abort()
		})
		await page.clock.install()
		await openShopping(page)
		await pauseClock(page)

		const saved = page.waitForResponse(isCheckWrite)
		await row(page, 'Rice')
			.getByRole('button', { name: 'Check off Rice' })
			.click()
		await saved
		await row(page, 'Rice')
			.getByRole('button', { name: 'Uncheck Rice' })
			.click()
		await expect(row(page, 'Rice').getByRole('alert')).toContainText(
			'Couldn’t confirm this check',
		)
		await page.clock.runFor(1000)
		expect(await namesIn(page, 'to-buy')).toEqual(['Apples', 'Rice'])
		expect(await namesIn(page, 'checked')).toEqual(['Bread'])
		await expect(
			row(page, 'Rice').getByRole('button', { name: 'Check off Rice' }),
		).toBeVisible()
		await expect(
			row(page, 'Rice').getByRole('button', { name: 'Retry' }),
		).toBeVisible()
	})

	test('the count and its spoken form follow the tap while the check is out', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user, [
			{ name: 'Apples' },
			{ name: 'Bread', checked: true },
			{ name: 'Rice' },
		])
		let release: (() => void) | null = null
		await page.route('**/resources/shopping-check?*', async (route) => {
			if (route.request().method() !== 'POST') return route.continue()
			await new Promise<void>((resolve) => (release = resolve))
			await route.continue()
		})
		await openShopping(page)
		const title = page.getByRole('heading', { level: 1 })
		await row(page, 'Rice')
			.getByRole('button', { name: 'Check off Rice' })
			.click()
		await expect.poll(() => release !== null).toBe(true)
		await expect(title).toContainText('1 to buy')
		await expect(title).toContainText(', 2 of 3 items for this shop checked')
		release!()
	})

	test('a check that fails inside the half second leaves the row where it was, with Retry', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user, [
			{ name: 'Apples' },
			{ name: 'Bread', checked: true },
			{ name: 'Rice' },
		])
		await page.route('**/resources/shopping-check?*', (route) =>
			route.request().method() === 'POST' ? route.abort() : route.continue(),
		)
		await page.clock.install()
		await openShopping(page)
		await pauseClock(page)

		await row(page, 'Rice')
			.getByRole('button', { name: 'Check off Rice' })
			.click()
		await expect(row(page, 'Rice').getByRole('alert')).toContainText(
			'Couldn’t confirm this check',
		)
		await page.clock.runFor(1000)
		expect(await namesIn(page, 'to-buy')).toEqual(['Apples', 'Rice'])
		expect(await namesIn(page, 'checked')).toEqual(['Bread'])
		await expect(
			row(page, 'Rice').getByRole('button', { name: 'Uncheck Rice' }),
		).toBeVisible()
		await expect(
			row(page, 'Rice').getByRole('button', { name: 'Retry' }),
		).toBeVisible()
		expect(await savedChecks(user.householdId)).toEqual({
			Apples: false,
			Bread: true,
			Rice: false,
		})
	})

	test('a row the other phone moves to Later inside the half second leaves Next shop and stays out', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user, [
			{ name: 'Apples' },
			{ name: 'Bread', checked: true },
			{ name: 'Rice' },
		])
		await page.clock.install()
		await openShopping(page)
		await pauseClock(page)

		const saved = page.waitForResponse(isCheckWrite)
		await row(page, 'Rice')
			.getByRole('button', { name: 'Check off Rice' })
			.click()
		await saved
		const rice = await prisma.shoppingListItem.findFirstOrThrow({
			where: { name: 'Rice', list: { householdId: user.householdId } },
		})
		await page.request.post('/shopping', {
			form: {
				intent: 'move',
				itemId: rice.id,
				horizon: 'later',
				originClientId: 'other-phone',
			},
		})
		// An add from the sheet reloads the list inside the half second.
		await page.getByRole('button', { name: 'Add an item' }).click()
		const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })
		await sheet.getByPlaceholder('Add an item…').fill('Cheese')
		const reloaded = page.waitForResponse(
			(response) =>
				response.request().method() === 'GET' &&
				response.url().includes('/shopping.data'),
		)
		await sheet.getByRole('button', { name: 'Add to Next shop' }).click()
		await reloaded
		// The saved row, not the one shown while the add was out: the reload
		// has rendered.
		await expect(
			page.locator(
				'[aria-label="Cheese shopping item"]:not([data-optimistic-row])',
			),
		).toBeAttached()
		expect(await namesIn(page, 'to-buy')).toEqual(['Apples', 'Cheese'])
		expect(await namesIn(page, 'checked')).toEqual(['Bread'])
		await expect(page.getByRole('button', { name: /^Later/ })).toContainText(
			'(1)',
		)

		await page.clock.runFor(1000)
		expect(await namesIn(page, 'to-buy')).toEqual(['Apples', 'Cheese'])
		expect(await namesIn(page, 'checked')).toEqual(['Bread'])
	})

	test('a Later row checked on a phone holds its place, then moves to the checked end of Later', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user, [
			{ name: 'Milk' },
			{ name: 'axe', horizon: 'later' },
			{ name: 'tent', horizon: 'later' },
			{ name: 'zip ties', horizon: 'later' },
			{ name: 'sunscreen', horizon: 'later', checked: true },
		])
		await page.clock.install()
		await openShopping(page)
		await pauseClock(page)
		await page.getByRole('button', { name: /^Later/ }).click()
		expect(await namesInLater(page)).toEqual([
			'axe',
			'tent',
			'zip ties',
			'sunscreen',
		])

		const saved = page.waitForResponse(isCheckWrite)
		await row(page, 'tent')
			.getByRole('button', { name: 'Check off tent' })
			.click()
		await saved
		await page.clock.runFor(450)
		expect(await namesInLater(page)).toEqual([
			'axe',
			'tent',
			'zip ties',
			'sunscreen',
		])
		await page.clock.runFor(60)
		await expect
			.poll(
				async () => {
					await page.clock.runFor(100)
					return namesInLater(page)
				},
				{ intervals: [50] },
			)
			.toEqual(['axe', 'zip ties', 'tent', 'sunscreen'])
		// Nothing of Later's goes under Next shop's Checked.
		expect(await namesIn(page, 'checked')).toEqual([])
	})

	test('wider than a phone, a checked row moves once its check is saved, with no half second', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user, [
			{ name: 'Apples' },
			{ name: 'Bread', checked: true },
			{ name: 'Rice' },
		])
		await page.setViewportSize({ width: 1280, height: 800 })
		await page.clock.install()
		await openShopping(page)
		await pauseClock(page)

		const saved = page.waitForResponse(isCheckWrite)
		await row(page, 'Rice')
			.getByRole('button', { name: 'Check off Rice' })
			.click()
		await saved
		// The clock stands still: only the saved check moves it.
		await expect.poll(() => namesIn(page, 'checked')).toEqual(['Bread', 'Rice'])
		expect(await namesIn(page, 'to-buy')).toEqual(['Apples'])
	})

	test('three rows checked together each move on their own, and one unchecked in time stays', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user, [
			{ name: 'Apples' },
			{ name: 'Bread' },
			{ name: 'Eggs' },
			{ name: 'Rice' },
		])
		await page.clock.install()
		await openShopping(page)
		await pauseClock(page)

		for (const name of ['Apples', 'Eggs', 'Rice']) {
			await row(page, name)
				.getByRole('button', { name: `Check off ${name}` })
				.click()
		}
		await row(page, 'Eggs')
			.getByRole('button', { name: 'Uncheck Eggs' })
			.click()
		await expect(page.locator('[id^="check-status-"]')).toHaveCount(0)
		expect(await namesIn(page, 'to-buy')).toEqual([
			'Apples',
			'Bread',
			'Eggs',
			'Rice',
		])

		await page.clock.runFor(510)
		// The latest to arrive goes on top.
		await advanceUntil(page, 'checked', ['Rice', 'Apples'])
		expect(await namesIn(page, 'to-buy')).toEqual(['Bread', 'Eggs'])
		await expect(
			row(page, 'Eggs').getByRole('button', { name: 'Check off Eggs' }),
		).toBeVisible()
		expect(await savedChecks(user.householdId)).toEqual({
			Apples: true,
			Bread: false,
			Eggs: false,
			Rice: true,
		})

		// Unchecked under Checked, a row goes back to its place by name.
		await row(page, 'Apples')
			.getByRole('button', { name: 'Uncheck Apples' })
			.click()
		await expect(page.locator('[id^="check-status-"]')).toHaveCount(0)
		expect(await namesIn(page, 'checked')).toEqual(['Rice', 'Apples'])
		await page.clock.runFor(510)
		await advanceUntil(page, 'to-buy', ['Apples', 'Bread', 'Eggs'])
		expect(await namesIn(page, 'checked')).toEqual(['Rice'])
	})

	test('in a list of 200 rows, moving three re-creates no row element, moved or not', async ({
		page,
		login,
	}) => {
		const user = await login()
		const names = Array.from(
			{ length: 200 },
			(_, index) => `item ${String(index + 1).padStart(3, '0')}`,
		)
		await seed(
			user,
			names.map((name) => ({ name })),
		)
		await page.clock.install()
		await openShopping(page)
		await pauseClock(page)
		await page.evaluate(() => {
			const seen = new WeakSet<Element>()
			for (const element of document.querySelectorAll(
				'[aria-label$=" shopping item"]',
			))
				seen.add(element)
			Object.assign(window, { __seenRows: seen })
		})

		const moved = ['item 003', 'item 010', 'item 150']
		for (const name of moved) {
			await row(page, name)
				.getByRole('button', { name: `Check off ${name}` })
				.click()
		}
		await expect(page.locator('[id^="check-status-"]')).toHaveCount(0)
		await page.clock.runFor(510)
		await advanceUntil(page, 'checked', [...moved].reverse())

		const remounted = await page.evaluate(() => {
			const seen = (window as unknown as { __seenRows: WeakSet<Element> })
				.__seenRows
			return [...document.querySelectorAll('[aria-label$=" shopping item"]')]
				.filter((element) => !seen.has(element))
				.map((element) => element.getAttribute('aria-label'))
		})
		// The moved rows too: each row stays one element through its move.
		expect(remounted).toEqual([])
		expect(await namesIn(page, 'to-buy')).toHaveLength(197)
	})

	test('with reduced motion it moves when the half second is up, without folding', async ({
		page,
		login,
	}) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		const user = await login()
		await seed(user, [
			{ name: 'Apples' },
			{ name: 'Bread', checked: true },
			{ name: 'Rice' },
		])
		await page.clock.install()
		await openShopping(page)
		await pauseClock(page)
		await page.evaluate(() => {
			const folds: string[] = []
			Object.assign(window, { __folds: folds })
			new MutationObserver((records) => {
				for (const record of records) {
					const target = record.target as HTMLElement
					if (
						target.matches('[data-row-collapse][data-hidden]') &&
						target.querySelector('[aria-label="Rice shopping item"]')
					)
						folds.push('Rice')
				}
			}).observe(document.body, {
				subtree: true,
				attributes: true,
				attributeFilter: ['data-hidden'],
			})
		})

		const saved = page.waitForResponse(isCheckWrite)
		await row(page, 'Rice')
			.getByRole('button', { name: 'Check off Rice' })
			.click()
		await saved
		await page.clock.runFor(450)
		expect(await namesIn(page, 'to-buy')).toEqual(['Apples', 'Rice'])
		await page.clock.runFor(60)
		await expect.poll(() => namesIn(page, 'checked')).toEqual(['Rice', 'Bread'])
		expect(await namesIn(page, 'to-buy')).toEqual(['Apples'])
		expect(
			await page.evaluate(
				() => (window as unknown as { __folds: string[] }).__folds,
			),
		).toEqual([])
	})
})

test('the Checked group counts, clears and leaves "Everything is checked"; Later keeps its own checked rows', async ({
	page,
	login,
}) => {
	const user = await login()
	await seed(user, [
		{ name: 'Milk' },
		{ name: 'Bread', quantity: '2' },
		{ name: 'Tent pegs', horizon: 'later', checked: true },
	])
	await openShopping(page)
	const title = page.getByRole('heading', { level: 1 })
	await expect(title).toContainText('2 to buy')
	await expect(
		page.getByRole('heading', { name: 'Checked', exact: true }),
	).toHaveCount(0)

	await row(page, 'Milk')
		.getByRole('button', { name: 'Check off Milk' })
		.click()
	// The count follows the circle at once.
	await expect(title).toContainText('1 to buy')
	const checkedHeading = page.getByRole('heading', {
		name: 'Checked',
		exact: true,
	})
	await expect(checkedHeading).toBeVisible()
	await expect(page.getByText('1 of 2', { exact: true })).toBeVisible()
	await expect.poll(() => namesIn(page, 'checked')).toEqual(['Milk'])

	await row(page, 'Bread')
		.getByRole('button', { name: 'Check off Bread' })
		.click()
	await expect(title).toContainText('All checked')
	await expect(page.getByText('Everything is checked')).toBeVisible()
	await expect(
		page.getByText(
			'Clear the checked rows when you are home, or add what you forgot.',
		),
	).toBeVisible()
	await expect.poll(() => namesIn(page, 'checked')).toEqual(['Bread', 'Milk'])
	await expect(page.getByText('2 of 2', { exact: true })).toBeVisible()

	// Later's checked row stays in Later, not under Checked.
	await page.getByRole('button', { name: /^Later/ }).click()
	await expect(
		page
			.locator('#later-shopping-items')
			.getByRole('group', { name: 'Tent pegs shopping item' }),
	).toBeVisible()
	expect(await namesIn(page, 'checked')).toEqual(['Bread', 'Milk'])

	await page
		.getByRole('button', { name: 'Clear checked items from Next shop' })
		.click()
	await expect(row(page, 'Milk')).toBeHidden()
	await expect(row(page, 'Bread')).toBeHidden()
	await expect(checkedHeading).toBeHidden()
	await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
	await expect(page.getByText('Nothing in Next shop')).toBeVisible()
	await expect
		.poll(() => savedChecks(user.householdId), { timeout: 10_000 })
		.toEqual({ 'Tent pegs': true })
})

test('the search field waits behind a magnifier from 15 rows, takes focus in the tap and Done puts it away', async ({
	page,
	login,
}) => {
	const user = await login()
	await seed(
		user,
		Array.from({ length: 15 }, (_, index) => ({
			name: `${index < 3 ? 'lime' : 'pear'} ${index + 1}`,
			checked: index === 14,
		})),
	)
	await openShopping(page)
	const field = page.getByPlaceholder('Search Shopping…')
	const magnifier = page.getByRole('button', { name: 'Search Shopping' })
	await expect(field).toBeHidden()
	await expect(magnifier).toHaveAttribute('aria-expanded', 'false')

	// Where focus is as the tap ends, before any timer could move it: iOS
	// raises the keyboard only for a focus the tap itself makes.
	await page.evaluate(() =>
		document.addEventListener(
			'click',
			() =>
				Object.assign(window, {
					__focusAfterTap: (
						document.activeElement as HTMLElement | null
					)?.getAttribute('placeholder'),
				}),
			{ once: true },
		),
	)
	await magnifier.click()
	expect(
		await page.evaluate(
			() => (window as unknown as { __focusAfterTap?: string }).__focusAfterTap,
		),
	).toBe('Search Shopping…')
	await expect(field).toBeFocused()
	await field.fill('lime')
	await expect(page.getByRole('group', { name: /shopping item$/ })).toHaveCount(
		3,
	)

	await page.getByRole('button', { name: 'Done' }).click()
	await expect(field).toBeHidden()
	await expect(magnifier).toBeFocused()
	await expect(page.getByRole('group', { name: /shopping item$/ })).toHaveCount(
		15,
	)

	// Escape puts it away the same way.
	await magnifier.click()
	await field.fill('lime')
	await expect(page.getByRole('group', { name: /shopping item$/ })).toHaveCount(
		3,
	)
	await page.keyboard.press('Escape')
	await expect(field).toBeHidden()
	await expect(magnifier).toBeFocused()
	await expect(page.getByRole('group', { name: /shopping item$/ })).toHaveCount(
		15,
	)

	// Wider, the field shows and there is no magnifier. A search narrows the
	// list, not the count.
	await page.setViewportSize({ width: 1280, height: 800 })
	await expect(field).toBeVisible()
	await expect(magnifier).toBeHidden()
	const title = page.getByRole('heading', { level: 1 })
	await expect(title).toContainText('(1/15)')
	await field.fill('lime')
	await expect(page.getByRole('group', { name: /shopping item$/ })).toHaveCount(
		3,
	)
	await expect(title).toContainText('(1/15)')

	// The other phone deletes a row, leaving 14: the field goes, and so does
	// its query, rather than narrowing a list with no field to clear it.
	const pear = await prisma.shoppingListItem.findFirstOrThrow({
		where: { name: 'pear 4', list: { householdId: user.householdId } },
	})
	const reloaded = page.waitForResponse(
		(response) =>
			response.request().method() === 'GET' &&
			response.url().includes('/shopping.data'),
	)
	await page.request.post('/resources/undo-delete', {
		data: {
			intent: 'delete-shopping',
			itemIds: [pear.id],
			originClientId: 'other-phone',
		},
	})
	await reloaded
	await expect(field).toHaveCount(0)
	await expect(page.getByRole('group', { name: /shopping item$/ })).toHaveCount(
		14,
	)
})

test('the docked Add an item bar opens a tall sheet with focus in the tap; it lists each add with an Undo', async ({
	page,
	login,
}) => {
	const user = await login()
	await seed(user, [{ name: 'Milk' }])
	await openShopping(page)
	const bar = page.locator('[data-shopping-add-bar]')
	const addItem = page.getByRole('button', { name: 'Add an item' })
	const barBox = (await bar.boundingBox())!
	const tabBar = (await page.locator('[data-bottom-nav]').boundingBox())!
	expect(barBox.y + barBox.height).toBeLessThanOrEqual(tabBar.y + 1)
	expect((await addItem.boundingBox())!.height).toBeGreaterThanOrEqual(44)

	await page.evaluate(() =>
		document.addEventListener(
			'click',
			() =>
				Object.assign(window, {
					__focusAfterTap: (
						document.activeElement as HTMLElement | null
					)?.getAttribute('placeholder'),
				}),
			{ once: true },
		),
	)
	await addItem.click()
	expect(
		await page.evaluate(
			() => (window as unknown as { __focusAfterTap?: string }).__focusAfterTap,
		),
	).toBe('Add an item…')
	const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })
	const name = sheet.getByPlaceholder('Add an item…')
	await expect(name).toBeFocused()
	await sheet.evaluate((element) =>
		Promise.all(element.getAnimations().map((a) => a.finished)),
	)
	// Tall, with the field high up, clear of where the keyboard comes.
	expect((await sheet.boundingBox())!.height).toBeGreaterThan(844 * 0.8)
	expect((await name.boundingBox())!.y).toBeLessThan(200)

	const added = sheet.getByRole('list', { name: 'Just added' })
	await name.fill('2 lemons')
	await sheet.getByRole('button', { name: 'Add to Next shop' }).click()
	await expect(added.getByRole('listitem')).toHaveText([/lemons\s*2/])
	await expect(name).toHaveValue('')
	await name.fill('Butter')
	await sheet.getByRole('button', { name: 'Add to Next shop' }).click()
	await expect(added.getByRole('listitem')).toHaveText([/^Butter/, /lemons/])
	await expect
		.poll(() => savedChecks(user.householdId))
		.toEqual({ Butter: false, Milk: false, lemons: false })

	await sheet.getByRole('button', { name: 'Undo adding lemons' }).click()
	await expect(added.getByRole('listitem')).toHaveText([/^Butter/])
	await expect(name).toBeFocused()
	await expect
		.poll(() => savedChecks(user.householdId))
		.toEqual({ Butter: false, Milk: false })
	// Taking back an add is final: no Undo toast for it, now that the delete
	// has answered.
	await expect(page.getByText('Deleted lemons')).toHaveCount(0)
	await expect(page.locator('.undo-toaster [data-sonner-toast]')).toHaveCount(0)
	await expect(row(page, 'lemons')).toHaveCount(0)

	// The list starts empty on the next open.
	await sheet.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(sheet).toBeHidden()
	await addItem.click()
	await expect(name).toBeFocused()
	await expect(added).toHaveCount(0)
})

test('the add sheet’s Undo leaves a row that changed since it was added, and offers Undo again when the request fails', async ({
	page,
	login,
}) => {
	const user = await login()
	await seed(user, [{ name: 'Bread' }])
	await openShopping(page)
	await page.getByRole('button', { name: 'Add an item' }).click()
	const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })
	const name = sheet.getByPlaceholder('Add an item…')
	for (const item of ['milk', 'eggs']) {
		await name.fill(item)
		await sheet.getByRole('button', { name: 'Add to Next shop' }).click()
		await expect(
			sheet.getByRole('button', { name: `Undo adding ${item}` }),
		).toBeVisible()
	}
	const milk = await prisma.shoppingListItem.findFirstOrThrow({
		where: { name: 'milk', list: { householdId: user.householdId } },
	})
	// The other phone edits milk's amount while the sheet is open.
	await prisma.shoppingListItem.update({
		where: { id: milk.id },
		data: { quantity: '2', unit: 'l' },
	})
	await sheet.getByRole('button', { name: 'Undo adding milk' }).click()
	const milkLine = sheet.getByRole('listitem').filter({ hasText: 'milk' })
	await expect(milkLine).toContainText(
		'It changed since you added it, so it stays.',
	)
	await expect(
		sheet.getByRole('button', { name: 'Undo adding milk' }),
	).toHaveCount(0)
	expect(
		await prisma.shoppingListItem.findUnique({
			where: { id: milk.id },
			select: { quantity: true, unit: true },
		}),
	).toEqual({ quantity: '2', unit: 'l' })

	// Offline for a moment: the line stays, with its Undo, and says so.
	await page.route('**/resources/undo-delete', (route) => route.abort())
	await sheet.getByRole('button', { name: 'Undo adding eggs' }).click()
	const eggsLine = sheet.getByRole('listitem').filter({ hasText: 'eggs' })
	await expect(eggsLine).toContainText('Couldn’t take it back. Try again.')
	await page.unroute('**/resources/undo-delete')
	await sheet.getByRole('button', { name: 'Undo adding eggs' }).click()
	await expect(eggsLine).toHaveCount(0)
	await expect
		.poll(() => savedChecks(user.householdId))
		.toEqual({ Bread: false, milk: false })
})

for (const width of [1280, 390]) {
	test(`an open editor stays open with what was typed when the other phone checks its row (${width}px)`, async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user, [{ name: 'Apples' }, { name: 'Rice' }])
		await page.setViewportSize({ width, height: width < 768 ? 844 : 800 })
		await openShopping(page)
		await row(page, 'Rice')
			.getByRole('button', { name: 'Item actions' })
			.click()
		await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
		// On a phone the editor is a sheet; wider, it takes the row's place.
		const editor =
			width < 768
				? page.getByRole('dialog', { name: 'Edit item' })
				: page.getByRole('group', { name: 'Rice shopping item' })
		const quantity = editor.getByPlaceholder('Qty')
		await quantity.fill('750')

		// The other phone checks Rice off, and adds something, which this page
		// hears of and reloads for.
		await prisma.shoppingListItem.updateMany({
			where: { name: 'Rice', list: { householdId: user.householdId } },
			data: { checked: true },
		})
		const reloaded = page.waitForResponse(
			(response) =>
				response.request().method() === 'GET' &&
				response.url().includes('/shopping.data'),
		)
		await page.request.post('/shopping', {
			form: { intent: 'add', name: 'Cheese', originClientId: 'other-phone' },
		})
		await reloaded
		await expect(row(page, 'Cheese')).toBeVisible()
		await expect(quantity).toBeVisible()
		await expect(quantity).toHaveValue('750')
	})
}

test('a row checked from the keyboard keeps focus on its check once it has moved, without scrolling the page', async ({
	page,
	login,
}) => {
	const user = await login()
	await seed(
		user,
		Array.from({ length: 14 }, (_, index) => ({
			name: `item ${String(index + 1).padStart(2, '0')}`,
		})),
	)
	await openShopping(page)
	await page.evaluate(() => window.scrollTo(0, 200))
	const button = row(page, 'item 05').getByRole('button', {
		name: 'Check off item 05',
	})
	await button.focus()
	const scrolled = await page.evaluate(() => window.scrollY)
	await page.keyboard.press('Space')
	await expect.poll(() => namesIn(page, 'checked')).toEqual(['item 05'])
	await expect(
		row(page, 'item 05').getByRole('button', { name: 'Uncheck item 05' }),
	).toBeFocused()
	expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)

	// Unchecked from the keyboard, it keeps focus on the way back too.
	await page.keyboard.press('Space')
	await expect.poll(() => namesIn(page, 'checked')).toEqual([])
	await expect(
		row(page, 'item 05').getByRole('button', { name: 'Check off item 05' }),
	).toBeFocused()
})

test.describe('swiping a row that holds', () => {
	test.use({ hasTouch: true })

	/** Drags one finger from 80% to 20% of the row's width. */
	async function swipeLeft(page: Page, name: string) {
		const box = (await row(page, name).boundingBox())!
		const y = box.y + box.height / 2
		const cdp = await page.context().newCDPSession(page)
		const at = (fraction: number) => [
			{ x: box.x + box.width * fraction, y, id: 1 },
		]
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: at(0.8),
		})
		for (let i = 1; i <= 12; i++) {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: at(0.8 - (0.6 * i) / 12),
			})
		}
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchEnd',
			touchPoints: [],
		})
		await cdp.detach()
	}

	test('does nothing until the row has moved', async ({ page, login }) => {
		const user = await login()
		await seed(user, [{ name: 'Apples' }, { name: 'Rice' }])
		await page.clock.install()
		await openShopping(page)
		await pauseClock(page)

		const saved = page.waitForResponse(isCheckWrite)
		await row(page, 'Rice')
			.getByRole('button', { name: 'Check off Rice' })
			.click()
		await saved
		// A row that isn't moving swipes open, clock stopped or not.
		await swipeLeft(page, 'Apples')
		await expect(
			row(page, 'Apples').getByRole('button', { name: 'Delete' }),
		).toBeVisible()
		// Rice's swipe would open Rice and shut Apples; it does neither.
		await swipeLeft(page, 'Rice')
		await page.waitForTimeout(300)
		await expect(
			row(page, 'Rice').getByRole('button', { name: 'Later' }),
		).toBeHidden()
		await expect(
			row(page, 'Apples').getByRole('button', { name: 'Delete' }),
		).toBeVisible()
		expect(await namesIn(page, 'to-buy')).toEqual(['Apples', 'Rice'])
	})
})
