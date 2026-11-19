import { type Locator, type Page } from '@playwright/test'
import {
	addDaysUTC,
	formatMonthDay,
	formatWeekdayName,
	getWeekStart,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { SHELL_UA } from '#tests/native-shell.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.use({
	viewport: { width: 390, height: 844 },
	hasTouch: true,
	userAgent: SHELL_UA,
})

function todayUTC() {
	const today = new Date()
	return new Date(
		Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
	)
}

/** "Thursday, Nov 19", as the Plan names a day. */
function dayName(date: Date) {
	return `${formatWeekdayName(date)}, ${formatMonthDay(date)}`
}

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

/**
 * How far a control's tap area reaches, probed with elementFromPoint along
 * the lines through its drawn middle: the height and width over which a
 * finger still lands on it, and the rectangle that spans.
 */
async function hitArea(control: Locator) {
	return control.evaluate((element) => {
		const box = element.getBoundingClientRect()
		const cx = box.left + box.width / 2
		const cy = box.top + box.height / 2
		const lands = (x: number, y: number) => {
			const hit = document.elementFromPoint(x, y)
			if (!hit) return false
			// A tap on a control's label is the control's.
			const owner =
				hit === element ||
				element.contains(hit) ||
				(hit instanceof HTMLLabelElement && hit.control === element) ||
				hit.contains(element)
			return owner && hit.closest('a, button, label, input') != null
		}
		let top = cy
		while (lands(cx, top - 1)) top--
		let bottom = cy
		while (lands(cx, bottom + 1)) bottom++
		let left = cx
		while (lands(left - 1, cy)) left--
		let right = cx
		while (lands(right + 1, cy)) right++
		return {
			top,
			bottom,
			left,
			right,
			height: bottom - top + 1,
			width: right - left + 1,
		}
	})
}

test('Recipes, Staples and Plan put one round + beside the title; Plan’s adds a Meal to the day showing', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.recipe.create({
		data: {
			title: 'Miso Soup',
			userId: user.id,
			householdId: user.householdId,
		},
	})

	type Look = {
		width: number
		height: number
		radius: string
		background: string
		rightGap: number
		afterTitle: boolean
		centerOffset: number
	}
	async function titlePlus(path: string, name: string | RegExp) {
		await page.goto(path)
		const plus = page.getByRole('button', { name })
		await expect(plus).toBeVisible()
		const h1 = page.getByRole('heading', { level: 1 })
		const titleBox = (await h1.boundingBox())!
		const box = (await plus.boundingBox())!
		const style = await plus.evaluate((element) => {
			const computed = getComputedStyle(element)
			return {
				radius: computed.borderTopLeftRadius,
				background: computed.backgroundColor,
			}
		})
		return {
			width: box.width,
			height: box.height,
			...style,
			// At the right end of the title's row, past the title.
			rightGap: await h1.evaluate((title, plusRight) => {
				const row = title.parentElement!
				const padding = Number.parseFloat(getComputedStyle(row).paddingRight)
				return Math.round(
					row.getBoundingClientRect().right - padding - plusRight,
				)
			}, box.x + box.width),
			afterTitle: box.x > titleBox.x + titleBox.width,
			centerOffset: Math.round(
				Math.abs(box.y + box.height / 2 - (titleBox.y + titleBox.height / 2)),
			),
		} satisfies Look
	}

	const recipes = await titlePlus('/recipes', 'New Recipe')
	const staples = await titlePlus('/inventory', 'Add Staple')
	const plan = await titlePlus('/plan', /^Add Meal to /)
	expect(recipes).toMatchObject({
		width: 44,
		height: 44,
		rightGap: 0,
		afterTitle: true,
		centerOffset: 0,
	})
	expect(Number.parseFloat(recipes.radius)).toBeGreaterThanOrEqual(22)
	expect(staples).toEqual(recipes)
	expect(plan).toEqual(recipes)

	// Plan's + follows the day showing: pick a day that is not today.
	const today = todayUTC()
	const weekStart = getWeekStart(today)
	const other =
		serializeDate(today) === serializeDate(weekStart)
			? addDaysUTC(weekStart, 1)
			: weekStart
	const otherName = dayName(other)
	await page
		.getByRole('button', { name: new RegExp(`^Show ${otherName}`) })
		.tap()
	const plus = page.getByRole('button', { name: `Add Meal to ${otherName}` })
	await expect(plus).toBeVisible()
	// The day heading no longer carries an Add Meal of its own.
	await expect(page.getByRole('button', { name: /^Add Meal/ })).toHaveCount(1)

	await plus.tap()
	const sheet = page.getByRole('dialog', { name: 'Add a Meal' })
	await expect(sheet).toBeVisible()
	await sheet.getByRole('button', { name: /Miso Soup/ }).tap()
	await expect(sheet).toBeHidden()
	await expect(
		page.getByTestId('mobile-plan').getByRole('link', { name: 'Miso Soup' }),
	).toBeVisible()
	await expect
		.poll(() =>
			prisma.meal.findMany({
				where: { mealPlan: { householdId: user.householdId } },
				select: { date: true, recipeItems: { select: { recipeTitle: true } } },
			}),
		)
		.toEqual([{ date: other, recipeItems: [{ recipeTitle: 'Miso Soup' }] }])
})

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

test('a Staple row swiped left shows a red Delete that removes it at once, with Undo', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedStaples(user.householdId, ['Apples', 'Salt'])
	await page.goto('/inventory')

	const salt = stapleRow(page, 'Salt')
	const add = salt.getByRole('button', { name: 'Add Salt to Next shop' })
	await expect(add).toHaveText('Add to Shopping')
	// No trash button on a phone; Delete waits under the row.
	await expect(salt.getByRole('button', { name: 'Remove Salt' })).toBeHidden()
	const del = salt.getByRole('button', { name: 'Delete Salt' })
	expect(await onTop(del)).toBe(false)

	// A mostly vertical drag is a scroll, not a swipe.
	await drag(page, salt, { fromX: 0.6, toX: 0.5, dy: -80 })
	expect(await restingX(salt)).toBe(0)

	await drag(page, salt, { fromX: 0.8, toX: 0.2 })
	await expect.poll(() => restingX(salt)).toBe(-76)
	expect(await onTop(del)).toBe(true)
	await expect(del).toHaveCSS('background-color', 'rgb(184, 92, 74)')

	// Opening another row shuts this one.
	const apples = stapleRow(page, 'Apples')
	await drag(page, apples, { fromX: 0.8, toX: 0.2 })
	await expect.poll(() => restingX(apples)).toBe(-76)
	await expect.poll(() => restingX(salt)).toBe(0)

	// A tap on an open row shuts it rather than adding the Staple.
	await apples.getByRole('button', { name: 'Add Apples to Next shop' }).tap()
	await expect.poll(() => restingX(apples)).toBe(0)
	await expect(
		apples.getByRole('button', { name: 'Add Apples to Next shop' }),
	).toBeVisible()

	await drag(page, salt, { fromX: 0.8, toX: 0.2 })
	await expect.poll(() => onTop(del)).toBe(true)
	await del.tap()
	await expect(salt).toBeHidden()
	await expect(page.getByText('Removed Salt')).toBeVisible()
	await expect.poll(() => isStaple(user.householdId, 'salt')).toBe(false)
	expect(await isStaple(user.householdId, 'apples')).toBe(true)

	await page.getByRole('button', { name: 'Undo' }).tap()
	await expect(salt).toBeVisible()
	await expect.poll(() => isStaple(user.householdId, 'salt')).toBe(true)
	// It comes back shut.
	expect(await restingX(salt)).toBe(0)
})

test('without a swipe, Tab reaches a Staple’s Delete, which slides into view, and Enter removes it', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedStaples(user.householdId, ['Apples', 'Salt'])
	await page.goto('/inventory')

	const salt = stapleRow(page, 'Salt')
	const del = salt.getByRole('button', { name: 'Delete Salt' })
	await salt.getByRole('button', { name: 'Add Salt to Next shop' }).focus()
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
		await page.goto('/inventory')
		const salt = stapleRow(page, 'Salt')
		await expect(salt.getByRole('button', { name: 'Delete Salt' })).toHaveCount(
			0,
		)
		await salt.getByRole('button', { name: 'Remove Salt' }).click()
		await expect(salt).toBeHidden()
		await expect.poll(() => isStaple(user.householdId, 'salt')).toBe(false)
	})
})

test('Recipes search and its filter button are 44px and share the field shape', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/recipes')
	const search = page.getByRole('searchbox', {
		name: 'Search by name or ingredient',
	})
	const filters = page.getByRole('button', { name: 'Toggle filters' })
	await expect(search).toBeVisible()
	expect((await search.boundingBox())!.height).toBe(44)
	expect(await filters.boundingBox()).toMatchObject({ width: 44, height: 44 })
	const radius = (control: Locator) =>
		control.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)
	expect(await radius(search)).toBe(await radius(filters))
	expect(Number.parseFloat(await radius(search))).toBeLessThanOrEqual(8)
})

test('a Plan Meal’s Recipe link and scale field each take a 44px tap area, side by side', async ({
	page,
	login,
}) => {
	const user = await login()
	const [miso, rice] = await Promise.all(
		['Miso Soup', 'Steamed Rice'].map((title) =>
			prisma.recipe.create({
				data: { title, userId: user.id, householdId: user.householdId },
			}),
		),
	)
	const today = todayUTC()
	const weekStart = getWeekStart(today)
	await prisma.mealPlan.create({
		data: {
			householdId: user.householdId,
			weekStart,
			meals: {
				create: {
					date: today,
					order: 0,
					label: 'dinner',
					recipeItems: {
						create: [
							{ recipeId: miso!.id, recipeTitle: miso!.title, order: 0 },
							{ recipeId: rice!.id, recipeTitle: rice!.title, order: 1 },
						],
					},
				},
			},
		},
	})
	await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
	const mobile = page.getByTestId('mobile-plan')
	const links = mobile.getByRole('link', { name: /Miso Soup|Steamed Rice/ })
	const scales = mobile.getByRole('textbox', { name: 'Scale multiplier' })
	await expect(links).toHaveCount(2)
	await expect(scales).toHaveCount(2)

	const areas = []
	for (const i of [0, 1]) {
		const link = await hitArea(links.nth(i))
		const scale = await hitArea(scales.nth(i))
		expect(link.height).toBeGreaterThanOrEqual(44)
		expect(link.width).toBeGreaterThanOrEqual(44)
		expect(scale.height).toBeGreaterThanOrEqual(44)
		expect(scale.width).toBeGreaterThanOrEqual(44)
		areas.push(link, scale)
	}
	// No two tap areas overlap, within a Recipe or across the two.
	for (const [i, a] of areas.entries()) {
		for (const b of areas.slice(i + 1)) {
			const overlap =
				a.left <= b.right &&
				b.left <= a.right &&
				a.top <= b.bottom &&
				b.top <= a.bottom
			expect(overlap).toBe(false)
		}
	}
	// Each Recipe stays one 44px line.
	const rowHeight = await links
		.nth(0)
		.evaluate(
			(element) =>
				element.closest('.flex.items-center')!.getBoundingClientRect().height,
		)
	expect(rowHeight).toBeLessThanOrEqual(50)

	// A tap just under the drawn field still focuses it.
	const field = scales.nth(0)
	const box = (await field.boundingBox())!
	await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height + 6)
	await expect(field).toBeFocused()
	await field.blur()
	// A tap just above the drawn link text, inside its area, opens the Recipe.
	const misoLink = links.nth(0)
	const text = (await misoLink.locator('span').boundingBox())!
	await page.touchscreen.tap(text.x + 4, text.y - 8)
	await expect(page).toHaveURL(new RegExp(`/recipes/${miso!.id}$`))
})

test('a Recipe’s ingredient summary row and Link recipe take 44px taps', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Miso Soup',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: [
					{ name: 'miso', amount: '2', unit: 'tbsp', order: 0 },
					{ name: 'tofu', amount: '200', unit: 'g', order: 1 },
				],
			},
		},
	})
	await page.goto(`/recipes/${recipe.id}/edit`)
	const summary = page.getByRole('button', { name: /^2 tbsp miso/ })
	await expect(summary).toBeVisible()
	const summaryArea = await hitArea(summary)
	expect(summaryArea.height).toBeGreaterThanOrEqual(44)
	// Its edge, well outside the 20px line of text, still opens it.
	const box = (await summary.boundingBox())!
	await page.touchscreen.tap(box.x + 40, summaryArea.top + 2)
	const notes = page.getByRole('textbox', { name: 'Ingredient 1 notes' })
	await expect(notes).toBeVisible()

	const linkRecipe = page.getByRole('button', { name: 'Link recipe' })
	const link = await hitArea(linkRecipe)
	expect(link.height).toBeGreaterThanOrEqual(44)
	// The notes field above keeps its own bottom edge.
	const notesBox = (await notes.boundingBox())!
	expect(link.top).toBeGreaterThanOrEqual(notesBox.y + notesBox.height)
	// A tap just under the drawn button opens the picker.
	const drawn = (await linkRecipe.boundingBox())!
	await page.touchscreen.tap(drawn.x + 20, drawn.y + drawn.height + 8)
	await expect(
		page.getByRole('dialog', { name: 'Link a Recipe' }),
	).toBeVisible()
})

test('the header, status bar strip and tab bar are opaque, with no blur', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/plan')
	const chrome = [
		'[data-site-header]',
		'[data-status-bar-backdrop]',
		'[data-bottom-nav]',
	]
	for (const selector of chrome) {
		const element = page.locator(selector)
		await expect(element).toHaveCount(1)
		const { alpha, blur } = await element.evaluate((node) => {
			const style = getComputedStyle(node)
			// The canvas reads any colour syntax (oklch, color()) as RGBA.
			const canvas = document.createElement('canvas')
			canvas.width = canvas.height = 1
			const context = canvas.getContext('2d')!
			context.fillStyle = style.backgroundColor
			context.fillRect(0, 0, 1, 1)
			return {
				alpha: context.getImageData(0, 0, 1, 1).data[3],
				blur: style.backdropFilter,
			}
		})
		expect({ selector, alpha, blur }).toEqual({
			selector,
			alpha: 255,
			blur: 'none',
		})
	}
})
