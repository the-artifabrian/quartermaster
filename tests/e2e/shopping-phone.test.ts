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

const group = (page: Page, which: 'to-buy' | 'checked') =>
	page.locator(`[data-shopping-group="${which}"]`)

/** The rows showing in a group, top to bottom; folded rows don't count. */
async function namesIn(page: Page, which: 'to-buy' | 'checked') {
	const container = group(page, which)
	if ((await container.count()) === 0) return []
	return container
		.locator(
			'[data-row-collapse]:not([data-hidden]) [aria-label$=" shopping item"]',
		)
		.evaluateAll((rows) =>
			rows.map((element) =>
				element.getAttribute('aria-label')!.replace(/ shopping item$/, ''),
			),
		)
}

/** The fold wrapper of a row in a group, found even while it is shut. */
const wrapperIn = (page: Page, which: 'to-buy' | 'checked', name: string) =>
	group(page, which)
		.locator('[data-row-collapse]')
		.filter({ has: page.locator(`[aria-label="${name} shopping item"]`) })

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
		await expect(
			group(page, 'to-buy').locator('[aria-label="Cheese shopping item"]'),
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

	test('in a list of 200 rows, moving three leaves every other row element in place', async ({
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

		const remounted = await page.evaluate((movedNames) => {
			const seen = (window as unknown as { __seenRows: WeakSet<Element> })
				.__seenRows
			return [...document.querySelectorAll('[aria-label$=" shopping item"]')]
				.map((element) => ({
					name: element
						.getAttribute('aria-label')!
						.replace(/ shopping item$/, ''),
					same: seen.has(element),
				}))
				.filter((entry) => !movedNames.includes(entry.name) && !entry.same)
				.map((entry) => entry.name)
		}, moved)
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

	// Wider, the field shows and there is no magnifier.
	await page.setViewportSize({ width: 1280, height: 800 })
	await expect(field).toBeVisible()
	await expect(magnifier).toBeHidden()
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
	// Taking back an add is final: no Undo toast for it.
	await expect(page.locator('.undo-toaster [data-sonner-toast]')).toHaveCount(0)
	await expect
		.poll(() => savedChecks(user.householdId))
		.toEqual({ Butter: false, Milk: false })
	await expect(row(page, 'lemons')).toHaveCount(0)

	// The list starts empty on the next open.
	await sheet.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(sheet).toBeHidden()
	await addItem.click()
	await expect(name).toBeFocused()
	await expect(added).toHaveCount(0)
})
