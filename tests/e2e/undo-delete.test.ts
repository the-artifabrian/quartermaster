import { type Locator, type Page } from '@playwright/test'
import { getWeekStart, serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	browserToday,
	expect,
	openShopping,
	test,
} from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
test.describe.configure({ timeout: 45_000 })

/** How long Undo stays on offer. */
const UNDO_WINDOW_MS = 5000

const row = (page: Page, name: string) =>
	page.getByRole('group', { name: `${name} shopping item` })

/** The Undo of the toast showing now, not of one still leaving. */
const undoButton = (page: Page, text?: string) =>
	page
		.locator('[data-sonner-toast]:not([data-removed="true"])', {
			hasText: text,
		})
		.getByRole('button', { name: 'Undo' })

/** The toast the Undo button sits in. */
const toastOf = (undo: Locator) => undo.locator('xpath=ancestor::li[1]')

const failureToast = (page: Page) =>
	page.getByText(/^(Couldn’t|You’re offline)/)

type CollapseTransition = {
	property: string
	duration?: number
	delay?: number
}

/**
 * Records every transition a row's collapse wrapper starts from now on, so a
 * slow runner cannot miss a 200ms one by looking too late.
 */
async function recordCollapses(page: Page) {
	await page.evaluate(() => {
		const record: unknown[] = []
		Object.assign(window, { __collapses: record })
		document.addEventListener(
			'transitionrun',
			(event) => {
				const target = event.target as HTMLElement
				if (!target.matches?.('[data-row-collapse]')) return
				if (event.propertyName.startsWith('border-')) return
				const timing = target
					.getAnimations()
					.find(
						(animation) =>
							(animation as CSSTransition).transitionProperty ===
							event.propertyName,
					)
					?.effect?.getTiming()
				record.push({
					property: event.propertyName,
					duration: timing?.duration,
					delay: timing?.delay,
				})
				// Captured: nothing on the way down can stop it reaching here.
			},
			true,
		)
	})
}

/**
 * Waits for the collapse transitions to have started (their events come with
 * the next frame), then forgets them for the next check.
 */
async function expectCollapses(page: Page, expected: CollapseTransition[]) {
	const started = () =>
		page.evaluate(
			() =>
				(window as unknown as { __collapses: CollapseTransition[] })
					.__collapses,
		)
	await expect.poll(started).toEqual(expect.arrayContaining(expected))
	await page.evaluate(() =>
		(window as unknown as { __collapses: unknown[] }).__collapses.splice(0),
	)
}

const OPENING = [{ property: 'grid-template-rows', duration: 200, delay: 0 }]
const CLOSING = [
	{ property: 'grid-template-rows', duration: 200, delay: 0 },
	{ property: 'opacity', duration: 200, delay: 0 },
]

async function deleteFromMenu(page: Page, name: string) {
	await row(page, name).getByRole('button', { name: 'Item actions' }).click()
	await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
	// Its exit has run: a menu reopened while its last one is still leaving
	// can close again at once (Radix), which is not what this tests.
	await expect(page.getByRole('menu')).toHaveCount(0)
}

async function seedShopping(
	user: { id: string; householdId: string },
	items: Array<{ name: string; checked?: boolean; quantity?: string }>,
) {
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: { create: items },
		},
	})
}

function saved(householdId: string) {
	return prisma.shoppingListItem.findMany({
		where: { list: { householdId } },
		select: { id: true, name: true, quantity: true, checked: true },
		orderBy: { name: 'asc' },
	})
}

const savedNames = (householdId: string) =>
	saved(householdId).then((items) => items.map((item) => item.name))

const UNDO_ROUTE = (url: URL) => url.pathname === '/resources/undo-delete'

test('a deleted Shopping item is deleted at once and collapses; Undo above the tab bar puts it back as it was, even from another tab', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedShopping(user, [
		{ name: 'eggs' },
		{ name: 'lemons', quantity: '3' },
		{ name: 'oat milk' },
	])
	await openShopping(page)
	const before = await saved(user.householdId)
	const lemons = row(page, 'lemons')

	await recordCollapses(page)
	await deleteFromMenu(page, 'lemons')
	await expect(lemons).toBeHidden()
	await expectCollapses(page, CLOSING)
	// Saved at once.
	await expect
		.poll(() => savedNames(user.householdId))
		.toEqual(['eggs', 'oat milk'])

	// Undo sits at the bottom, above the tab bar, beside the Add item button.
	const undo = undoButton(page)
	await expect(toastOf(undo)).toContainText('Deleted lemons')
	await toastOf(undo).evaluate((element) =>
		Promise.all(element.getAnimations().map((a) => a.finished)),
	)
	const toast = (await toastOf(undo).boundingBox())!
	const tabBar = (await page.locator('[data-bottom-nav]').boundingBox())!
	const fab = (await page
		.getByRole('button', { name: 'Add item' })
		.boundingBox())!
	expect(toast.y + toast.height).toBeLessThanOrEqual(tabBar.y)
	expect(toast.y + toast.height).toBeGreaterThan(tabBar.y - 40)
	expect(toast.x + toast.width).toBeLessThanOrEqual(fab.x)

	// Undo puts it back as it was, same row, and it opens where it was.
	await undo.click()
	await expect(lemons).toBeVisible()
	await expectCollapses(page, OPENING)
	await expect.poll(() => saved(user.householdId)).toEqual(before)

	// Left alone, the toast goes and the row stays deleted.
	await deleteFromMenu(page, 'lemons')
	await expect(lemons).toBeHidden()
	await expect(undo).toBeVisible()
	await expect(undo).toBeHidden({ timeout: UNDO_WINDOW_MS + 3000 })
	expect(await savedNames(user.householdId)).toEqual(['eggs', 'oat milk'])
	await expect(lemons).toBeHidden()

	// Undo works from another tab while its toast is up.
	await deleteFromMenu(page, 'eggs')
	await page.getByRole('link', { name: 'Plan' }).click()
	await expect(page).toHaveURL(/\/plan/)
	await undoButton(page).click()
	await expect
		.poll(() => savedNames(user.householdId))
		.toEqual(['eggs', 'oat milk'])
})

test('a delete made while the last Undo toast is leaving gets its own Undo', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedShopping(user, [
		{ name: 'eggs' },
		{ name: 'lemons' },
		{ name: 'rice' },
	])
	await openShopping(page)
	await deleteFromMenu(page, 'eggs')
	await expect(undoButton(page, 'Deleted eggs')).toBeVisible()
	// The next delete is ready and lands the moment the first toast starts
	// to leave on its own: watched in the page, so a slow runner cannot miss
	// the toast's 200ms exit.
	await row(page, 'lemons')
		.getByRole('button', { name: 'Item actions' })
		.click()
	const deleteLemons = page.getByRole('menuitem', {
		name: 'Delete',
		exact: true,
	})
	await expect(deleteLemons).toBeVisible()
	await deleteLemons.evaluate(
		(item) =>
			new Promise<void>((resolve) => {
				const observer = new MutationObserver(() => {
					const leaving = document.querySelector(
						'[data-sonner-toast][data-removed="true"]',
					)
					if (!leaving?.textContent?.includes('Deleted eggs')) return
					observer.disconnect()
					;(item as HTMLElement).click()
					resolve()
				})
				observer.observe(document.body, {
					subtree: true,
					attributes: true,
					attributeFilter: ['data-removed'],
				})
			}),
		undefined,
		{ timeout: UNDO_WINDOW_MS + 5000 },
	)
	await expect(undoButton(page, 'Deleted lemons')).toBeVisible()
	await page.waitForTimeout(500)
	await expect(undoButton(page, 'Deleted lemons')).toBeVisible()
	await undoButton(page, 'Deleted lemons').click()
	await expect
		.poll(() => savedNames(user.householdId))
		.toEqual(['lemons', 'rice'])
})

test('under reduced motion a deleted row fades where it is, then gives up its space', async ({
	page,
	login,
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await seedShopping(await login(), [{ name: 'eggs' }, { name: 'lemons' }])
	await openShopping(page)
	await recordCollapses(page)
	await deleteFromMenu(page, 'lemons')
	await expect(row(page, 'lemons')).toBeHidden()
	await expectCollapses(page, [
		{ property: 'opacity', duration: 120, delay: 0 },
		{ property: 'grid-template-rows', duration: 0, delay: 120 },
	])
})

test('Clear checked clears at once; Undo brings the rows back checked', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedShopping(user, [
		{ name: 'bread', checked: true },
		{ name: 'butter', checked: true },
		{ name: 'jam' },
	])
	await openShopping(page)
	const before = await saved(user.householdId)
	await page
		.getByRole('button', { name: 'Clear checked items from Next shop' })
		.click()
	await expect(row(page, 'bread')).toBeHidden()
	await expect(row(page, 'butter')).toBeHidden()
	await expect(row(page, 'jam')).toBeVisible()
	await expect(toastOf(undoButton(page))).toContainText(
		'Cleared 2 checked items',
	)
	await expect.poll(() => savedNames(user.householdId)).toEqual(['jam'])

	await undoButton(page).click()
	await expect(row(page, 'bread')).toBeVisible()
	await expect(row(page, 'butter')).toBeVisible()
	await expect.poll(() => saved(user.householdId)).toEqual(before)
	await expect(
		row(page, 'bread').getByRole('button', { name: 'Uncheck bread' }),
	).toBeVisible()
})

test('a delete that fails brings the row back at once and says why; one already gone stays quiet', async ({
	page,
	context,
	login,
}) => {
	const user = await login()
	await seedShopping(user, [{ name: 'eggs' }, { name: 'lemons' }])
	await openShopping(page)

	// The server refuses it: the row comes back, and the toast names it.
	await page.route(UNDO_ROUTE, (route) =>
		route.fulfill({ status: 500, body: 'down' }),
	)
	await deleteFromMenu(page, 'lemons')
	await expect(
		page.getByText('Couldn’t delete lemons. Try again.'),
	).toBeVisible()
	await expect(row(page, 'lemons')).toBeVisible()
	await expect(undoButton(page)).toBeHidden()
	await page.unroute(UNDO_ROUTE)
	await expect(failureToast(page)).toBeHidden({ timeout: 10_000 })

	// Offline: the same, and the toast says why.
	await context.setOffline(true)
	await deleteFromMenu(page, 'lemons')
	await expect(
		page.getByText('You’re offline, so lemons wasn’t deleted.'),
	).toBeVisible()
	await expect(row(page, 'lemons')).toBeVisible({ timeout: 2000 })
	await context.setOffline(false)
	expect(await savedNames(user.householdId)).toEqual(['eggs', 'lemons'])
	await expect(failureToast(page)).toBeHidden({ timeout: 10_000 })

	// The other member deleted it first: nothing to report, and it is gone.
	await prisma.shoppingListItem.deleteMany({
		where: { name: 'lemons', list: { householdId: user.householdId } },
	})
	await deleteFromMenu(page, 'lemons')
	await expect(row(page, 'lemons')).toBeHidden()
	await page.waitForTimeout(1000)
	await expect(failureToast(page)).toBeHidden()
	await expect(
		page.getByRole('heading', { level: 1, name: /^Shopping/ }),
	).toBeVisible()
})

test('an Undo that cannot reach the server leaves the row deleted and says so', async ({
	page,
	context,
	login,
}) => {
	const user = await login()
	await seedShopping(user, [{ name: 'eggs' }, { name: 'lemons' }])
	await openShopping(page)
	await deleteFromMenu(page, 'lemons')
	await expect.poll(() => savedNames(user.householdId)).toEqual(['eggs'])
	await context.setOffline(true)
	await undoButton(page).click()
	await expect(
		page.getByText('You’re offline, so lemons couldn’t come back.'),
	).toBeVisible()
	await expect(row(page, 'lemons')).toBeHidden()
	await context.setOffline(false)
	expect(await savedNames(user.householdId)).toEqual(['eggs'])
})

test('Undo after the item was added again in the meantime does not double it', async ({
	page,
	context,
	login,
}) => {
	const user = await login()
	await seedShopping(user, [{ name: 'eggs' }, { name: 'milk', quantity: '1' }])
	await openShopping(page)
	await deleteFromMenu(page, 'milk')
	await expect.poll(() => savedNames(user.householdId)).toEqual(['eggs'])

	// The other member adds milk while the toast is up.
	const other = await context.newPage()
	await openShopping(other)
	await other.getByRole('button', { name: 'Add item' }).click()
	const sheet = other.getByRole('dialog', { name: 'Add to Shopping' })
	await sheet.getByPlaceholder('Add an item...').fill('2 milk')
	await sheet.getByRole('button', { name: 'Add to Next shop' }).click()
	await expect
		.poll(() => savedNames(user.householdId))
		.toEqual(['eggs', 'milk'])

	await undoButton(page).click()
	await page.waitForTimeout(1000)
	// One milk, the one asked for since, with its amount.
	expect(
		(await saved(user.householdId)).map(({ name, quantity }) => [
			name,
			quantity,
		]),
	).toEqual([
		['eggs', null],
		['milk', '2'],
	])
	await other.close()
})

test('opening a sheet closes the Undo toast, so it never covers the sheet', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedShopping(user, [{ name: 'eggs' }, { name: 'lemons' }])
	await openShopping(page)
	await deleteFromMenu(page, 'lemons')
	await expect(undoButton(page)).toBeVisible()
	await page.getByRole('button', { name: 'Add item' }).click()
	const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })
	await sheet.evaluate((element) =>
		Promise.all(element.getAnimations().map((a) => a.finished)),
	)
	await expect(undoButton(page)).toBeHidden()
	const input = sheet.getByPlaceholder('Add an item...')
	const box = (await input.boundingBox())!
	expect(
		await page.evaluate(
			({ x, y }) =>
				document.elementFromPoint(x, y)?.getAttribute('placeholder'),
			{ x: box.x + box.width - 8, y: box.y + box.height / 2 },
		),
	).toBe('Add an item...')
	expect(await savedNames(user.householdId)).toEqual(['eggs'])
})

test('a hidden last row takes the hairline above it along', async ({
	page,
	login,
}) => {
	await seedShopping(await login(), [{ name: 'eggs' }, { name: 'lemons' }])
	await openShopping(page)
	const eggsWrapper = page
		.getByRole('group', { name: 'eggs shopping item' })
		.locator('xpath=ancestor::*[@data-row-collapse][1]')
	const lineUnder = () =>
		eggsWrapper.evaluate(
			(element) => getComputedStyle(element).borderBottomColor,
		)
	expect(await lineUnder()).not.toBe('rgba(0, 0, 0, 0)')
	await deleteFromMenu(page, 'lemons')
	await expect.poll(lineUnder).toBe('rgba(0, 0, 0, 0)')
})

async function seedRecipe(
	user: { id: string; householdId: string },
	title: string,
) {
	return prisma.recipe.create({
		data: {
			title,
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: { name: `${title.toLowerCase()} base`, amount: '1', order: 0 },
			},
		},
	})
}

async function openPlanDay(page: Page) {
	const day = serializeDate(getWeekStart(browserToday()))
	await page.goto(`/plan?weekStart=${day}&day=${day}`)
}

async function seedTextMeals(user: { householdId: string }, texts: string[]) {
	const weekStart = getWeekStart(browserToday())
	const plan = await prisma.mealPlan.create({
		data: {
			householdId: user.householdId,
			weekStart,
			meals: {
				create: texts.map((genericText, order) => ({
					date: weekStart,
					order,
					genericText,
				})),
			},
		},
		include: { meals: true },
	})
	return plan.meals
}

const mealActions = (page: Page, name: string) =>
	page.getByRole('button', { name: `Meal actions for ${name}` })

async function deleteMealFromMenu(page: Page, name: string) {
	await mealActions(page, name).click()
	await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
	await expect(page.getByRole('menu')).toHaveCount(0)
}

const mealOrder = (householdId: string) =>
	prisma.meal
		.findMany({
			where: { mealPlan: { householdId } },
			orderBy: { order: 'asc' },
			select: { genericText: true },
		})
		.then((meals) => meals.map((meal) => meal.genericText))

test('a deleted Meal is deleted at once and collapses; Undo puts it back; the day reads as empty meanwhile', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedTextMeals(user, ['Soup', 'Pizza'])
	await openPlanDay(page)
	const soup = mealActions(page, 'Soup')
	const pizza = mealActions(page, 'Pizza')
	const dayButton = page
		.getByRole('button', { name: /^Show .*planned$/ })
		.first()

	await soup.click()
	const deleteMeal = page.getByRole('menuitem', { name: 'Delete', exact: true })
	// Red from the start: no arming.
	await expect(deleteMeal).toHaveCSS('color', 'rgb(184, 92, 74)')
	await recordCollapses(page)
	await deleteMeal.click()
	await expect(soup).toBeHidden()
	await expectCollapses(page, CLOSING)
	await expect(pizza).toBeVisible()
	await expect(toastOf(undoButton(page))).toContainText('Deleted Soup')
	await expect.poll(() => mealOrder(user.householdId)).toEqual(['Pizza'])
	await expect(page.getByRole('menu')).toHaveCount(0)

	// The last Meal of the day goes: the day reads as empty.
	await deleteMealFromMenu(page, 'Pizza')
	await expect(
		page.getByTestId('mobile-plan').getByText('Nothing planned'),
	).toBeVisible()
	await expect(dayButton).toHaveAccessibleName(/no Meals planned/)
	await expect.poll(() => mealOrder(user.householdId)).toEqual([])

	await undoButton(page, 'Deleted Pizza').click()
	await expect(pizza).toBeVisible()
	await expect.poll(() => mealOrder(user.householdId)).toEqual(['Pizza'])
	await expect(dayButton).toHaveAccessibleName(/1 Meal planned/)
})

test('a Meal moved while another is deleted moves among the Meals showing', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedTextMeals(user, ['Breakfast', 'Lunch', 'Dinner'])
	await openPlanDay(page)
	await deleteMealFromMenu(page, 'Breakfast')
	await expect(mealActions(page, 'Breakfast')).toBeHidden()
	// Lunch is first now: it cannot move earlier.
	await mealActions(page, 'Lunch').click()
	await expect(
		page.getByRole('menuitem', { name: 'Move earlier' }),
	).toBeHidden()
	await page.keyboard.press('Escape')
	await mealActions(page, 'Dinner').click()
	await page.getByRole('menuitem', { name: 'Move earlier' }).click()
	await expect
		.poll(() => mealOrder(user.householdId))
		.toEqual(['Dinner', 'Lunch'])
})

test('a Recipe removed from a Meal is removed at once and collapses; Undo puts it back', async ({
	page,
	login,
}) => {
	const user = await login()
	const dal = await seedRecipe(user, 'Dal')
	const rice = await seedRecipe(user, 'Rice')
	const weekStart = getWeekStart(browserToday())
	const meal = await prisma.meal.create({
		data: {
			mealPlan: { create: { householdId: user.householdId, weekStart } },
			date: weekStart,
			order: 0,
			recipeItems: {
				create: [
					{ recipeId: dal.id, recipeTitle: 'Dal', order: 0 },
					{ recipeId: rice.id, recipeTitle: 'Rice', order: 1 },
				],
			},
		},
	})
	const riceSaved = () =>
		prisma.mealRecipeItem.count({
			where: { mealId: meal.id, recipeId: rice.id },
		})
	await openPlanDay(page)
	const riceLink = page.getByRole('link', { name: 'Rice', exact: true })
	const removeRice = page.getByRole('button', {
		name: 'Remove Rice from this meal',
	})

	await removeRice.click()
	await expect(riceLink).toBeHidden()
	await expect(toastOf(undoButton(page))).toContainText('Removed Rice')
	// The last Recipe left goes with its Meal, so it offers no remove.
	await expect(
		page.getByRole('button', { name: 'Remove Dal from this meal' }),
	).toBeHidden()
	await expect.poll(riceSaved).toBe(0)

	await undoButton(page).click()
	await expect(riceLink).toBeVisible()
	await expect.poll(riceSaved).toBe(1)
	await expect(
		page.getByRole('button', { name: 'Remove Dal from this meal' }),
	).toBeVisible()
})

test('the first card showing loses the hairline above it', async ({
	page,
	login,
}) => {
	const user = await login()
	const dal = await seedRecipe(user, 'Dal')
	const rice = await seedRecipe(user, 'Rice')
	const weekStart = getWeekStart(browserToday())
	await prisma.meal.create({
		data: {
			mealPlan: { create: { householdId: user.householdId, weekStart } },
			date: weekStart,
			order: 0,
			recipeItems: {
				create: [
					{ recipeId: dal.id, recipeTitle: 'Dal', order: 0 },
					{ recipeId: rice.id, recipeTitle: 'Rice', order: 1 },
				],
			},
		},
	})
	await openPlanDay(page)
	const riceWrapper = page
		.getByRole('link', { name: 'Rice', exact: true })
		.locator('xpath=ancestor::*[@data-row-collapse][1]')
	const lineAbove = () =>
		riceWrapper.evaluate((element) => getComputedStyle(element).borderTopColor)
	expect(await lineAbove()).not.toBe('rgba(0, 0, 0, 0)')
	await page.getByRole('button', { name: 'Remove Dal from this meal' }).click()
	await expect.poll(lineAbove).toBe('rgba(0, 0, 0, 0)')
})

test('Delete · remove generated amount takes its Shopping amounts; Undo brings them back', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
	const recipe = await seedRecipe(user, 'Dal')
	const weekStart = getWeekStart(browserToday())
	await prisma.meal.create({
		data: {
			mealPlan: { create: { householdId: user.householdId, weekStart } },
			date: weekStart,
			order: 0,
			recipeItems: {
				create: { recipeId: recipe.id, recipeTitle: 'Dal', order: 0 },
			},
		},
	})
	await openPlanDay(page)
	const actions = mealActions(page, 'Dal')
	await actions.click()
	await page.getByRole('menuitem', { name: 'Add to Shopping' }).click()
	await expect.poll(() => savedNames(user.householdId)).toEqual(['dal base'])
	await page.reload()

	await actions.click()
	await page
		.getByRole('menuitem', { name: 'Delete · remove generated amount' })
		.click()
	await expect(actions).toBeHidden()
	await expect.poll(() => savedNames(user.householdId)).toEqual([])
	await undoButton(page).click()
	await expect(actions).toBeVisible()
	await expect.poll(() => savedNames(user.householdId)).toEqual(['dal base'])
	expect(
		await prisma.mealShoppingContribution.count({
			where: { meal: { mealPlan: { householdId: user.householdId } } },
		}),
	).toBe(1)
})

test('a Meal delete that fails offline brings it back and says so', async ({
	page,
	context,
	login,
}) => {
	const user = await login()
	await seedTextMeals(user, ['Soup'])
	await openPlanDay(page)
	await context.setOffline(true)
	await deleteMealFromMenu(page, 'Soup')
	await expect(
		page.getByText('You’re offline, so the Meal wasn’t deleted.'),
	).toBeVisible()
	await expect(mealActions(page, 'Soup')).toBeVisible({ timeout: 2000 })
	await context.setOffline(false)
	expect(await mealOrder(user.householdId)).toEqual(['Soup'])
})

// A phone deletes a Staple by a swipe (consistency-leftovers.test.ts); a
// mouse has the trash button.
test.describe('with a mouse', () => {
	test.use({ viewport: { width: 1024, height: 768 }, hasTouch: false })

	test('a removed Staple is removed at once and collapses; Undo marks it again', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.householdIngredient.createMany({
			data: ['Apples', 'Salt'].map((displayName) => ({
				householdId: user.householdId,
				displayName,
				canonicalKey: displayName.toLowerCase(),
				isStaple: true,
			})),
		})
		const isStaple = () =>
			prisma.householdIngredient
				.findFirstOrThrow({
					where: { householdId: user.householdId, canonicalKey: 'salt' },
					select: { isStaple: true },
				})
				.then((staple) => staple.isStaple)
		await page.goto('/inventory')

		const remove = page.getByRole('button', { name: 'Delete Salt' })
		// Red from the start: no arming.
		await expect(remove).toHaveCSS('color', 'rgb(184, 92, 74)')
		await recordCollapses(page)
		await remove.click()
		await expect(remove).toBeHidden()
		await expectCollapses(page, OPENING)
		await expect(toastOf(undoButton(page))).toContainText('Deleted Salt')
		await expect.poll(isStaple).toBe(false)

		await undoButton(page).click()
		await expect(remove).toBeVisible()
		await expect.poll(isStaple).toBe(true)
		await expect(
			page.getByRole('button', { name: 'Delete Apples' }),
		).toBeVisible()
	})

	test('a Staple removal that fails brings it back and says so', async ({
		page,
		context,
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
		await page.goto('/inventory')
		const remove = page.getByRole('button', { name: 'Delete Salt' })
		await context.setOffline(true)
		await remove.click()
		await expect(
			page.getByText('You’re offline, so Salt wasn’t deleted.'),
		).toBeVisible()
		await expect(remove).toBeVisible({ timeout: 2000 })
		await context.setOffline(false)
		expect(
			(
				await prisma.householdIngredient.findFirstOrThrow({
					where: { householdId: user.householdId },
				})
			).isStaple,
		).toBe(true)
	})
})

test('a Recipe delete asks in a confirm sheet: Cancel and Escape keep it, Delete removes it', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Weeknight dal',
			userId: user.id,
			householdId: user.householdId,
		},
	})
	// The iOS app's bridge, recorded: a destructive question warns.
	await page.addInitScript(() => {
		const messages: string[] = []
		Object.assign(window, {
			__bridgeMessages: messages,
			webkit: {
				messageHandlers: {
					haptic: { postMessage: (m: string) => messages.push(`haptic:${m}`) },
				},
			},
		})
	})
	const haptics = () =>
		page.evaluate(
			() =>
				(window as unknown as { __bridgeMessages: string[] }).__bridgeMessages,
		)
	await page.goto(`/recipes/${recipe.id}/edit`)

	const trigger = page.getByRole('button', { name: 'Delete Recipe' })
	const sheet = page.getByRole('dialog', { name: 'Delete this Recipe?' })
	expect(await haptics()).not.toContain('haptic:warning')
	await trigger.click()
	await expect(sheet).toBeVisible()
	expect(await haptics()).toContain('haptic:warning')
	await expect(sheet).toHaveAccessibleDescription(
		'Its ingredients, steps and photo go for good.',
	)
	// Focus starts on Cancel, so a stray Return keeps the Recipe.
	await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeFocused()
	await sheet.getByRole('button', { name: 'Cancel' }).click()
	await expect(sheet).toBeHidden()
	await trigger.click()
	await expect(sheet).toBeVisible()
	await page.keyboard.press('Escape')
	await expect(sheet).toBeHidden()
	expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(1)

	await trigger.click()
	await sheet.getByRole('button', { name: 'Delete Recipe' }).click()
	await expect(page).toHaveURL('/recipes')
	expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(0)
})
