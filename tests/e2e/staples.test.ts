import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { SHELL_UA } from '#tests/native-shell.ts'
import { expect, test, waitForHydration } from '#tests/playwright-utils.ts'

async function waitForStaplesHydration(page: Page) {
	const addButton = page.getByRole('button', { name: 'Add Staple' })
	const addInput = page.getByRole('textbox', { name: 'Add a Staple' })
	await expect(async () => {
		if (!(await addInput.isVisible())) await addButton.click()
		await expect(addInput).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15_000 })
	await page.getByRole('button', { name: 'Cancel' }).click()
	await expect(addInput).toBeHidden()
}

test('tapping a Staple adds it to Next shop from a phone', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.householdIngredient.create({
		data: {
			householdId: user.householdId,
			displayName: 'Salt',
			canonicalKey: 'salt',
			isStaple: true,
		},
	})
	await prisma.subscription.create({
		data: {
			userId: user.id,
			tier: 'pro',
			trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		},
	})

	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/staples')
	await waitForStaplesHydration(page)
	await page.route('**/staples*', async (route) => {
		if (
			route.request().method() === 'POST' &&
			route.request().postData()?.includes('intent=add-staple-to-shop')
		) {
			await new Promise((resolve) => setTimeout(resolve, 500))
		}
		await route.continue()
	})

	// Scoped to the row, because the button's name flips to "On list"
	// the moment it is pressed.
	const saltRow = page
		.getByRole('list', { name: 'Staples' })
		.getByRole('listitem')
		.filter({ hasText: 'Salt' })
	const saltButton = saltRow.getByRole('button').first()
	await expect(saltButton).toHaveAccessibleName('Need, Salt')
	const response = page.waitForResponse(
		(candidate) =>
			candidate.request().method() === 'POST' &&
			candidate.request().postData()?.includes('intent=add-staple-to-shop') ===
				true,
	)
	await saltButton.click()
	// The row answers for itself straight away, and keeps saying so.
	await expect(saltButton).toHaveText('On list')
	await expect(saltButton).toHaveAttribute('aria-busy', 'true')
	await response
	await expect(saltButton).toHaveAccessibleName('On list, Salt')
	await expect(saltButton).toHaveText('On list')
	await expect(saltButton).toBeFocused()

	await page.getByRole('link', { name: 'Shopping', exact: true }).click()
	const nextShop = page.getByTestId('next-shopping-items')
	await expect(
		nextShop.getByRole('group', { name: 'Salt shopping item' }),
	).toBeVisible()
	await expect
		.poll(() =>
			prisma.householdEvent.count({
				where: {
					householdId: user.householdId,
					type: 'shopping_list_item_added',
				},
			}),
		)
		.toBe(1)
})

test('a failed restock reports it and leaves the Staple tappable', async ({
	page,
	login,
}) => {
	const user = await login()
	const staple = await prisma.householdIngredient.create({
		data: {
			householdId: user.householdId,
			displayName: 'Failure salt',
			canonicalKey: 'failure salt',
			isStaple: true,
		},
		select: { id: true },
	})
	await prisma.$executeRawUnsafe(`
		CREATE TRIGGER reject_failure_staple_restock
		BEFORE INSERT ON "ShoppingListItem"
		WHEN NEW.name = 'Failure salt'
		BEGIN
			SELECT RAISE(ABORT, 'simulated shopping failure');
		END
	`)

	try {
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto('/staples')
		await waitForStaplesHydration(page)
		const saltRow = page
			.getByRole('list', { name: 'Staples' })
			.getByRole('listitem')
			.filter({ hasText: 'Failure salt' })
		const saltButton = saltRow.getByRole('button').first()

		await saltButton.click()

		// The failure is reported on the row that failed, not at the top of a
		// list the shopper has already scrolled past.
		await expect(
			saltRow.getByRole('alert').filter({
				hasText: 'Could not add Failure salt to Next shop. Try again.',
			}),
		).toBeVisible()
		await expect(saltButton).toHaveAccessibleName('Need, Failure salt')
		await expect(saltButton).not.toHaveAttribute('aria-busy')
		await expect(saltButton).toBeEnabled()
		await expect(saltButton).toBeFocused()
		// The Staple itself is untouched — a tap never changed it.
		expect(
			await prisma.householdIngredient.findUniqueOrThrow({
				where: { id: staple.id },
				select: { isStaple: true },
			}),
		).toEqual({ isStaple: true })
	} finally {
		await prisma.$executeRawUnsafe('DROP TRIGGER reject_failure_staple_restock')
	}
})

/**
 * Drags one finger across a locator's middle, from `fromX` to `toX` (as
 * fractions of its width), moving `dy` px down on the way. CDP touch events
 * arrive ~40ms apart, so a few big moves make the drag.
 */
async function drag(
	page: Page,
	target: Locator,
	{ fromX, toX, dy = 0 }: { fromX: number; toX: number; dy?: number },
) {
	const box = (await target.boundingBox())!
	const y = box.y + box.height / 2
	const cdp = await page.context().newCDPSession(page)
	const steps = 6
	const point = (i: number) => [
		{
			x: box.x + box.width * (fromX + ((toX - fromX) * i) / steps),
			y: y + (dy * i) / steps,
			id: 1,
		},
	]
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: point(0),
	})
	for (let i = 1; i <= steps; i++) {
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: point(i),
		})
		await page.waitForTimeout(30)
	}
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	})
	await cdp.detach()
}

/** Where a Staple row's sliding layer rests (px), once any settle has run. */
async function restingX(row: Locator) {
	return row.evaluate(async (element) => {
		const layer = element.querySelector<HTMLElement>('.touch-pan-y')!
		await Promise.all(layer.getAnimations().map((a) => a.finished))
		await new Promise((resolve) => setTimeout(resolve, 350))
		return new DOMMatrix(getComputedStyle(layer).transform).m41
	})
}

/** Whether a finger at the control's middle lands on it (not on a cover). */
async function onTop(control: Locator) {
	return control.evaluate((element) => {
		const box = element.getBoundingClientRect()
		const hit = document.elementFromPoint(
			box.left + box.width / 2,
			box.top + box.height / 2,
		)
		return hit != null && element.contains(hit)
	})
}

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

function isStaple(householdId: string, canonicalKey: string) {
	return prisma.householdIngredient
		.findFirstOrThrow({
			where: { householdId, canonicalKey },
			select: { isStaple: true },
		})
		.then((staple) => staple.isStaple)
}

const stapleRow = (page: Page, name: string) =>
	page
		.getByRole('list', { name: 'Staples' })
		.getByRole('listitem')
		.filter({ hasText: name })

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } })

	test('a household with no Staples adds the first ones from the suggestions', async ({
		page,
		login,
	}) => {
		const user = await login()
		await page.goto('/staples')

		await expect(
			page.getByRole('heading', { name: 'No Staples yet' }),
		).toBeVisible()
		const suggestions = page.getByRole('list', { name: 'Suggested Staples' })
		const oliveOil = suggestions.getByRole('button', { name: 'Add olive oil' })
		await expect(oliveOil).toHaveText('olive oil')
		await oliveOil.click()

		const staples = page.getByRole('list', { name: 'Staples' })
		await expect(staples.getByText('olive oil', { exact: true })).toBeVisible()
		await expect(oliveOil).toHaveCount(0)
		await expect(
			page.getByRole('heading', { name: 'Others you might keep' }),
		).toBeVisible()
		await suggestions.getByRole('button', { name: 'Add garlic' }).click()
		await expect(staples.getByText('garlic', { exact: true })).toBeVisible()

		await expect
			.poll(() =>
				prisma.householdIngredient.findMany({
					where: { householdId: user.householdId, isStaple: true },
					select: { displayName: true },
					orderBy: { displayName: 'asc' },
				}),
			)
			.toEqual([{ displayName: 'garlic' }, { displayName: 'olive oil' }])

		// A later visit with Staples present shows no suggestions.
		await page.goto('/staples')
		await expect(staples.getByText('garlic', { exact: true })).toBeVisible()
		await expect(
			page.getByRole('list', { name: 'Suggested Staples' }),
		).toHaveCount(0)
	})
})

test.describe('with a finger', () => {
	// A phone: a finger, so each row shows what a phone shows.
	test.use({ hasTouch: true })

	test('a large Staples list stays task-first and reachable on a phone', async ({
		page,
		login,
	}) => {
		const user = await login()
		const stapleNames = [
			'Apples',
			'Beans',
			'Coffee',
			'Eggs',
			'Flour',
			'Garlic',
			'Honey',
			'Lentils',
			'Milk',
			'Oats',
			'Olive oil',
			'Onions',
			'Pasta',
			'Pepper',
			'Potatoes',
			'Soy sauce',
			'Sugar',
			'Tea',
			'Tomatoes',
			'Tortillas',
			'Vinegar',
			'Yogurt',
			'Zucchini',
			'Baking powder',
			'Cinnamon',
			'Cornmeal',
			'Yeast',
			'Brown rice',
			'Salt',
			'Vanilla',
		]
		await prisma.householdIngredient.createMany({
			data: stapleNames.map((displayName) => ({
				householdId: user.householdId,
				displayName,
				canonicalKey: displayName.toLocaleLowerCase(),
				isStaple: true,
			})),
		})

		await page.setViewportSize({ width: 390, height: 844 })
		await page.route('**/staples*', async (route) => {
			if (
				route.request().method() === 'POST' &&
				route.request().postData()?.includes('intent=add-staple-to-shop')
			) {
				await new Promise((resolve) => setTimeout(resolve, 400))
			}
			await route.continue()
		})
		await page.goto('/staples')
		await waitForStaplesHydration(page)

		const list = page.getByRole('list', { name: 'Staples' })
		await expect(list.getByRole('listitem')).toHaveCount(30)

		const search = page.getByRole('searchbox', { name: 'Search Staples' })
		const addButton = page.getByRole('button', { name: 'Add Staple' })
		const [searchBox, addBox] = await Promise.all([
			search.boundingBox(),
			addButton.boundingBox(),
		])
		expect(searchBox).not.toBeNull()
		expect(addBox).not.toBeNull()
		// The + sits beside the title, above the search.
		expect(addBox!.y + addBox!.height).toBeLessThanOrEqual(searchBox!.y)

		// Every add and delete control is a 44×44 touch target on the phone:
		// Delete is the one a swipe uncovers.
		const applesRow = list.getByRole('listitem').filter({ hasText: 'Apples' })
		for (const control of [
			addButton,
			applesRow.getByRole('button', { name: 'Need, Apples' }),
			applesRow.getByRole('button', { name: 'Delete Apples' }),
		]) {
			const box = await control.boundingBox()
			expect(box, `${control}`).not.toBeNull()
			expect(box!.width, `${control} width`).toBeGreaterThanOrEqual(44)
			expect(box!.height, `${control} height`).toBeGreaterThanOrEqual(44)
		}

		await addButton.click()
		await expect(search).toBeHidden()
		await expect(
			page.getByRole('textbox', { name: 'Add a Staple' }),
		).toHaveAttribute('placeholder', 'Staple name')
		await page.getByRole('button', { name: 'Cancel' }).click()
		await expect(search).toBeVisible()

		await search.fill('rice')
		await expect(list.getByRole('listitem')).toHaveCount(1)
		await expect(list.getByText('Brown rice')).toBeVisible()
		await search.fill('missing staple')
		await expect(
			page.getByRole('heading', { name: 'No Staples found' }),
		).toBeVisible()
		await page.getByRole('button', { name: 'Clear search' }).click()

		const response = page.waitForResponse(
			(candidate) =>
				candidate.request().method() === 'POST' &&
				candidate
					.request()
					.postData()
					?.includes('intent=add-staple-to-shop') === true,
		)
		const applesButton = applesRow.getByRole('button').first()
		await applesButton.click()
		await expect(applesButton).toBeFocused()
		await response
		// The row says where it went, and stays where it was.
		await expect(applesButton).toHaveAccessibleName('On list, Apples')
		await expect(applesButton).toBeFocused()
		await expect(list.getByRole('listitem')).toHaveCount(30)

		const finalRow = list.getByRole('listitem').filter({ hasText: 'Zucchini' })
		await finalRow.scrollIntoViewIfNeeded()
		const bottomNav = page.getByRole('navigation', { name: 'Main' }).filter({
			has: page.getByRole('link', { name: 'Shopping', exact: true }),
		})
		const [rowBox, navBox] = await Promise.all([
			finalRow.boundingBox(),
			bottomNav.boundingBox(),
		])
		expect(rowBox).not.toBeNull()
		expect(navBox).not.toBeNull()
		expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(navBox!.y)
	})
})

test.describe('in the iOS app on a phone', () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		userAgent: SHELL_UA,
	})

	test('a Staple row swiped left shows a Delete that removes it at once, with Undo', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, ['Apples', 'Salt'])
		await page.goto('/staples')

		const salt = stapleRow(page, 'Salt')
		// The spoken name starts with the words on the button (so Voice Control's
		// "tap Need" works), then says which Staple.
		const add = salt.getByRole('button', { name: /^Need/ })
		await expect(add).toHaveAccessibleName('Need, Salt')
		await expect(add).toHaveText('Need')
		// No trash button on a phone, only the Delete waiting under the row.
		const del = salt.getByRole('button', { name: 'Delete Salt' })
		await expect(del).toHaveCount(1)
		await expect(del).toHaveText('Delete')
		expect(await onTop(del)).toBe(false)

		await drag(page, salt, { fromX: 0.8, toX: 0.2 })
		await expect.poll(() => restingX(salt)).toBe(-76)
		expect(await onTop(del)).toBe(true)

		// Opening another row shuts this one.
		const apples = stapleRow(page, 'Apples')
		await drag(page, apples, { fromX: 0.8, toX: 0.2 })
		await expect.poll(() => restingX(apples)).toBe(-76)
		await expect.poll(() => restingX(salt)).toBe(0)

		// A tap on an open row shuts it rather than adding the Staple.
		await apples.getByRole('button', { name: 'Need, Apples' }).tap()
		await expect.poll(() => restingX(apples)).toBe(0)
		await expect(
			apples.getByRole('button', { name: 'Need, Apples' }),
		).toBeVisible()

		await drag(page, salt, { fromX: 0.8, toX: 0.2 })
		// The drag overshoots and the row eases back to rest. Wait for it to
		// settle, so the button isn't still sliding when the finger lands.
		await expect.poll(() => restingX(salt)).toBe(-76)
		expect(await onTop(del)).toBe(true)
		// This step has failed on CI only (twice, all retries): the tap reached
		// the page but the Staple stayed. Record what the finger hit and which
		// events arrived, so a failure says why.
		await page.evaluate(() => {
			const w = window as unknown as { __tapLog: string[] }
			w.__tapLog = []
			const name = (target: EventTarget | null) =>
				target instanceof Element
					? `${target.tagName.toLowerCase()}[${target.getAttribute('aria-label') ?? target.textContent?.trim().slice(0, 20) ?? ''}]`
					: String(target)
			for (const type of ['pointerdown', 'pointerup', 'click', 'focusin']) {
				window.addEventListener(
					type,
					(event) =>
						w.__tapLog.push(
							`${Math.round(event.timeStamp)} ${type} ${name(event.target)}${event.defaultPrevented ? ' (prevented)' : ''}`,
						),
					{ capture: true },
				)
			}
		})
		const before = await del.evaluate((element) => {
			const box = element.getBoundingClientRect()
			const layer = element.previousElementSibling as HTMLElement | null
			return {
				box: [box.left, box.top, box.width, box.height].map(Math.round),
				hit: document
					.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
					?.getAttribute('aria-label'),
				layer: layer ? getComputedStyle(layer).transform : null,
			}
		})
		await del.tap()
		try {
			await expect(salt).toBeHidden()
		} catch (error) {
			const log = await page.evaluate(
				() => (window as unknown as { __tapLog: string[] }).__tapLog,
			)
			throw new Error(
				`${String(error)}\nbefore tap: ${JSON.stringify(before)}\nevents: ${log.join(' | ')}`,
			)
		}
		await expect(page.getByText('Deleted Salt')).toBeVisible()
		await expect.poll(() => isStaple(user.householdId, 'salt')).toBe(false)
		expect(await isStaple(user.householdId, 'apples')).toBe(true)

		await page.getByRole('button', { name: 'Undo' }).tap()
		await expect(salt).toBeVisible()
		await expect.poll(() => isStaple(user.householdId, 'salt')).toBe(true)
		// It comes back shut.
		expect(await restingX(salt)).toBe(0)
	})

	test('a mostly vertical drag on a Staple row scrolls the page and leaves the row shut', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(
			user.householdId,
			Array.from(
				{ length: 30 },
				(_, i) => `Staple ${String(i).padStart(2, '0')}`,
			),
		)
		await page.goto('/staples')
		const row = stapleRow(page, 'Staple 03')
		await expect(row).toBeVisible()
		expect(await page.evaluate(() => window.scrollY)).toBe(0)
		// Well past half the 76px reveal sideways, but further up.
		await drag(page, row, { fromX: 0.8, toX: 0.4, dy: -300 })
		await expect
			.poll(() => page.evaluate(() => window.scrollY))
			.toBeGreaterThan(50)
		expect(await restingX(row)).toBe(0)
	})

	test('without a swipe, Tab reaches a Staple’s Delete, which slides into view, and Enter removes it', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, ['Apples', 'Salt'])
		await page.goto('/staples')

		const salt = stapleRow(page, 'Salt')
		const del = salt.getByRole('button', { name: 'Delete Salt' })
		// Tab from the top of the page, as a keyboard reaches it.
		await page.getByRole('heading', { name: 'Staples', level: 1 }).click()
		for (let i = 0; i < 12; i++) {
			await page.keyboard.press('Tab')
			const focused = await page.evaluate(() =>
				document.activeElement?.getAttribute('aria-label'),
			)
			if (focused === 'Delete Salt') break
		}
		await expect(del).toBeFocused()
		// The stop before it is the row's own Add.
		await page.keyboard.press('Shift+Tab')
		await expect(salt.getByRole('button', { name: 'Need, Salt' })).toBeFocused()
		await page.keyboard.press('Tab')
		await expect(del).toBeFocused()
		await expect.poll(() => onTop(del)).toBe(true)

		// Leaving it shuts the row again.
		await page.keyboard.press('Shift+Tab')
		await expect.poll(() => restingX(salt)).toBe(0)

		await page.keyboard.press('Tab')
		await expect.poll(() => onTop(del)).toBe(true)
		await page.keyboard.press('Enter')
		await expect(salt).toBeHidden()
		await expect.poll(() => isStaple(user.householdId, 'salt')).toBe(false)
		expect(await isStaple(user.householdId, 'apples')).toBe(true)
	})

	test('a Staple row a finger swipes after Tab opened it stays open when focus leaves', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, ['Apples', 'Salt'])
		await page.goto('/staples')
		const salt = stapleRow(page, 'Salt')
		const del = salt.getByRole('button', { name: 'Delete Salt' })
		await page.getByRole('heading', { name: 'Staples', level: 1 }).click()
		for (let i = 0; i < 12; i++) {
			await page.keyboard.press('Tab')
			const focused = await page.evaluate(() =>
				document.activeElement?.getAttribute('aria-label'),
			)
			if (focused === 'Delete Salt') break
		}
		await expect(del).toBeFocused()
		await expect.poll(() => restingX(salt)).toBe(-76)

		// The finger takes the row over: a swipe that leaves it open.
		await drag(page, salt, { fromX: 0.5, toX: 0.3 })
		await expect.poll(() => restingX(salt)).toBe(-76)
		// Focus leaves Delete; the row is the finger's now, so it stays open.
		await page.getByRole('heading', { name: 'Staples', level: 1 }).click()
		await expect(del).not.toBeFocused()
		expect(await restingX(salt)).toBe(-76)
	})
})

test.describe('with a mouse', () => {
	test.use({
		viewport: { width: 1024, height: 768 },
		hasTouch: false,
		userAgent: undefined,
	})

	test('a Staple row keeps its trash button and no hidden Delete', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, ['Salt'])
		await page.goto('/staples')
		const salt = stapleRow(page, 'Salt')
		// One Delete, the trash in the row: the swipe's is not there.
		const del = salt.getByRole('button', { name: 'Delete Salt' })
		await expect(del).toHaveCount(1)
		await expect(del).toHaveText('')
		await del.click()
		await expect(page.getByText('Deleted Salt')).toBeVisible()
		await expect(salt).toBeHidden()
		await expect.poll(() => isStaple(user.householdId, 'salt')).toBe(false)
	})
})

// Staples used to live at /inventory. Bookmarks, the iOS app's saved page and
// tabs still running the build from before the move all ask for it there.
test.describe('the old /inventory address', () => {
	test('opening /inventory shows Staples at /staples, query and all', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, ['Salt'])

		const response = await page.goto('/inventory?from=bookmark')

		await expect(page).toHaveURL('/staples?from=bookmark')
		await expect(
			page.getByRole('heading', { name: 'Staples', level: 1 }),
		).toBeVisible()
		await expect(stapleRow(page, 'Salt')).toBeVisible()
		const hop = await response?.request().redirectedFrom()?.response()
		expect(hop?.status()).toBe(301)
	})

	test('/inventory answers a permanent redirect without a session, for GET and HEAD', async ({
		request,
	}) => {
		const get = await request.get('/inventory?a=1&b=two', { maxRedirects: 0 })
		const head = await request.head('/inventory', { maxRedirects: 0 })

		expect(get.status()).toBe(301)
		expect(get.headers().location).toBe('/staples?a=1&b=two')
		expect(head.status()).toBe(301)
		expect(head.headers().location).toBe('/staples')
	})

	test('a data request from an older page, with its old route id, tells it to load /staples as a new page', async ({
		page,
		login,
	}) => {
		await login()
		// A tab switch leaves the root out, so the old page names only the
		// Staples route it knew.
		const partial = await page.request.get(
			'/inventory.data?_routes=routes%2Finventory%2Findex&q=1',
			{ maxRedirects: 0 },
		)
		const full = await page.request.get('/inventory.data', {
			maxRedirects: 0,
		})

		for (const response of [partial, full]) {
			expect(response.status()).toBe(202)
			expect(response.headers()['x-remix-reload-document']).toBe('true')
		}
		const partialBody = await partial.text()
		expect(partialBody).toContain('/staples?q=1')
		expect(partialBody).not.toContain('_routes')
		expect(partialBody).not.toContain('.data')
		expect(await full.text()).toContain('/staples')
	})

	test('a form sent to /inventory from an older page sends it to /staples', async ({
		page,
		login,
	}) => {
		const user = await login()
		const form = { intent: 'add-staple', displayName: 'Pepper' }

		const fromRouter = await page.request.post('/inventory.data?index', {
			form,
			maxRedirects: 0,
		})
		const withoutScript = await page.request.post('/inventory?index', {
			form,
			maxRedirects: 0,
		})

		expect(fromRouter.status()).toBe(202)
		expect(fromRouter.headers()['x-remix-reload-document']).toBe('true')
		expect(await fromRouter.text()).toContain('/staples')
		expect(withoutScript.status()).toBe(301)
		expect(withoutScript.headers().location).toBe('/staples')
		// The redirect answers before the Staples action runs, so nothing is added.
		expect(
			await prisma.householdIngredient.count({
				where: { householdId: user.householdId },
			}),
		).toBe(0)
	})

	// An older page runs the same Staples client loader under the old route
	// id. Answering its Staples data request with what /inventory.data says
	// to that page plays the tap without the old build.
	async function answerAsOldPage(page: Page) {
		await page.route(
			'**/staples.data*',
			async (route) => {
				const response = await route.fetch({
					url: new URL(
						'/inventory.data?_routes=routes%2Finventory%2Findex',
						route.request().url(),
					).toString(),
					maxRedirects: 0,
				})
				await route.fulfill({ response })
			},
			{ times: 1 },
		)
	}

	async function markDocument(page: Page) {
		await page.evaluate(() => {
			;(window as { beforeNavigation?: boolean }).beforeNavigation = true
		})
	}

	async function expectNewStaplesDocument(page: Page) {
		await expect(page).toHaveURL('/staples')
		await expect(stapleRow(page, 'Salt')).toBeVisible()
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Staples')
		expect(
			await page.evaluate(
				() => (window as { beforeNavigation?: boolean }).beforeNavigation,
			),
		).toBeUndefined()
	}

	test('an older page tapping Staples for the first time lands on Staples', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, ['Salt'])
		await page.goto('/recipes')
		await waitForHydration(page)
		await markDocument(page)
		await answerAsOldPage(page)

		await page
			.getByRole('navigation', { name: 'Main' })
			.getByRole('link', { name: 'Staples', exact: true })
			.click()

		await expectNewStaplesDocument(page)
	})

	test('an older page tapping Staples again, with Staples in memory, lands on Staples', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, ['Salt'])
		await page.goto('/staples')
		await expect(stapleRow(page, 'Salt')).toBeVisible()
		await waitForHydration(page)
		const nav = page.getByRole('navigation', { name: 'Main' })
		await nav.getByRole('link', { name: 'Recipes', exact: true }).click()
		await expect(page).toHaveURL('/recipes')
		await markDocument(page)
		await answerAsOldPage(page)

		// The stored Staples show at once; the refresh behind them meets the
		// redirect.
		await nav.getByRole('link', { name: 'Staples', exact: true }).click()

		await expectNewStaplesDocument(page)
	})

	test('a client-side navigation to /inventory loads Staples as a new page', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedStaples(user.householdId, ['Salt'])
		await page.goto('/recipes')
		await waitForHydration(page)
		await page.evaluate(() => {
			;(window as { beforeNavigation?: boolean }).beforeNavigation = true
		})

		await page.evaluate(() =>
			(
				window as unknown as {
					__reactRouterDataRouter: { navigate: (to: string) => unknown }
				}
			).__reactRouterDataRouter.navigate('/inventory'),
		)

		await expect(page).toHaveURL('/staples')
		await expect(stapleRow(page, 'Salt')).toBeVisible()
		expect(
			await page.evaluate(
				() => (window as { beforeNavigation?: boolean }).beforeNavigation,
			),
		).toBeUndefined()
	})
})
