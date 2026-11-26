import { type Locator, type Page } from '@playwright/test'
import { parseDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, hydrated, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

/**
 * One finger from (x, y) through each of `moves` (px from the start), lifting
 * at the last. CDP touch events arrive ~30ms apart.
 */
async function touchDrag(
	page: Page,
	x: number,
	y: number,
	moves: Array<[number, number]>,
) {
	const cdp = await page.context().newCDPSession(page)
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ x, y, id: 1 }],
	})
	for (const [dx, dy] of moves) {
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: x + dx, y: y + dy, id: 1 }],
		})
		await page.waitForTimeout(30)
	}
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	})
	await cdp.detach()
}

/** A sideways swipe of `dx` px that starts at (x, y). */
function swipeAt(page: Page, x: number, y: number, dx: number) {
	const steps = 6
	return touchDrag(
		page,
		x,
		y,
		Array.from({ length: steps }, (_, i) => [(dx * (i + 1)) / steps, 0]),
	)
}

/** Swipes sideways across the middle of `target`. */
async function swipeOn(page: Page, target: Locator, dx: number) {
	const box = (await target.boundingBox())!
	await swipeAt(page, box.x + box.width / 2, box.y + box.height / 2, dx)
}

/** The day showing: the strip's picked day, the heading and the URL agree. */
async function expectDay(page: Page, weekday: string, monthDay: string) {
	await expect(
		page.locator('[data-slot="mobile-week-days"]').getByRole('button', {
			name: new RegExp(`^Show ${weekday}, ${monthDay},`),
		}),
	).toHaveAttribute('aria-pressed', 'true')
	await expect(
		page.getByTestId('mobile-plan').getByRole('heading', { level: 2 }),
	).toHaveText(monthDay)
}

async function seedRecipeMeal(
	user: { id: string; householdId: string },
	date: string,
	title = 'Miso Soup',
) {
	const recipe = await prisma.recipe.create({
		data: { title, userId: user.id, householdId: user.householdId },
	})
	await prisma.mealPlan.create({
		data: {
			householdId: user.householdId,
			weekStart: parseDate('2026-11-16'),
			meals: {
				create: {
					date: parseDate(date),
					order: 0,
					label: 'dinner',
					recipeItems: {
						create: { recipeId: recipe.id, recipeTitle: title, order: 0 },
					},
				},
			},
		},
	})
	return recipe
}

test('a sideways swipe on the bare foot of a short day steps the day, and past Sunday turns the week', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/plan?weekStart=2026-11-16&day=2026-11-21')
	const day = page.getByTestId('mobile-plan')
	await hydrated(day)
	await expectDay(page, 'Saturday', 'Nov 21')

	// Well below the empty day's last line.
	await swipeAt(page, 300, 640, -150)
	await expectDay(page, 'Sunday', 'Nov 22')
	await expect(page).toHaveURL(/weekStart=2026-11-16&day=2026-11-22$/)

	await swipeAt(page, 300, 640, -150)
	await expect(page).toHaveURL(/weekStart=2026-11-23&day=2026-11-23$/)
	await expect(page.getByText('Nov 23 – 29')).toBeVisible()
	await expectDay(page, 'Monday', 'Nov 23')

	await hydrated(day)
	await swipeAt(page, 90, 640, 150)
	await expect(page).toHaveURL(/weekStart=2026-11-16&day=2026-11-22$/)
	await expectDay(page, 'Sunday', 'Nov 22')

	// A short swipe stays.
	await swipeAt(page, 200, 640, -50)
	await page.waitForTimeout(300)
	await expectDay(page, 'Sunday', 'Nov 22')
})

/** A tap whose finger drifts `dx` px sideways before it lifts. */
async function wobbleTap(page: Page, target: Locator, dx: number) {
	const box = (await target.boundingBox())!
	await touchDrag(page, box.x + box.width / 2, box.y + box.height / 2, [
		[dx / 2, 1],
		[dx, 2],
	])
}

test('a tap that drifts a little sideways on a dish name still opens the Recipe', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await seedRecipeMeal(user, '2026-11-18')
	await page.goto('/plan?weekStart=2026-11-16&day=2026-11-18')
	const dish = page.getByTestId('mobile-plan').getByRole('link', {
		name: 'Miso Soup',
	})
	await hydrated(dish)
	await wobbleTap(page, dish, 10)
	await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}$`))
})

test('a tap that drifts a little sideways on the cooked circle still marks the dish cooked', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedRecipeMeal(user, '2026-11-18')
	await page.goto('/plan?weekStart=2026-11-16&day=2026-11-18')
	const circle = page
		.getByTestId('mobile-plan')
		.getByRole('button', { name: 'Mark Miso Soup cooked' })
	await hydrated(circle)
	await wobbleTap(page, circle, 10)
	await expect(
		page
			.getByTestId('mobile-plan')
			.getByRole('button', { name: 'Mark Miso Soup not cooked' }),
	).toBeVisible()
	await expect
		.poll(
			async () =>
				(
					await prisma.mealRecipeItem.findFirstOrThrow({
						where: {
							recipeTitle: 'Miso Soup',
							meal: { mealPlan: { householdId: user.householdId } },
						},
					})
				).cooked,
		)
		.toBe(true)
})

test('a short sideways drag that ends on a dish name opens nothing and stays on the day', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedRecipeMeal(user, '2026-11-18', 'Miso Soup with Tofu')
	await page.goto('/plan?weekStart=2026-11-16&day=2026-11-18')
	const dish = page.getByTestId('mobile-plan').getByRole('link', {
		name: 'Miso Soup with Tofu',
	})
	await hydrated(dish)
	// From near the name's right end, 40px left, still over the name.
	const box = (await dish.boundingBox())!
	await touchDrag(page, box.x + box.width - 8, box.y + box.height / 2, [
		[-12, 0],
		[-26, 0],
		[-40, 0],
	])
	await page.waitForTimeout(400)
	await expect(page).toHaveURL(/\/plan\?weekStart=2026-11-16&day=2026-11-18$/)
	await expectDay(page, 'Wednesday', 'Nov 18')
})

test('a multiplier typed but not yet saved is saved when a swipe changes the day', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedRecipeMeal(user, '2026-11-18')
	// A phone, and the width where the day's pickers open in place.
	for (const [width, value] of [
		[390, '3'],
		[700, '2.5'],
	] as const) {
		await page.setViewportSize({ width, height: 844 })
		await page.goto('/plan?weekStart=2026-11-16&day=2026-11-18')
		const field = page
			.getByTestId('mobile-plan')
			.getByRole('textbox', { name: 'Scale multiplier' })
		await hydrated(field)
		await field.tap()
		await expect(field).toBeFocused()
		await field.fill(value)
		// No Done: the swipe on the bare day under its Add Meal is next.
		const foot = (await page
			.getByTestId('mobile-plan')
			.getByRole('button', { name: 'Add Meal', exact: true })
			.boundingBox())!
		await swipeAt(page, width - 90, foot.y + foot.height + 40, -150)
		await expectDay(page, 'Thursday', 'Nov 19')
		await expect
			.poll(
				async () =>
					(
						await prisma.mealRecipeItem.findFirstOrThrow({
							where: { meal: { mealPlan: { householdId: user.householdId } } },
						})
					).scaleMultiplier,
			)
			.toBe(Number(value))
	}
})

test('a scroll that drifts sideways leaves the day alone', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/plan?weekStart=2026-11-16&day=2026-11-18')
	await hydrated(page.getByTestId('mobile-plan'))
	// Mostly up the page, with some sideways travel.
	await touchDrag(page, 200, 600, [
		[-4, -12],
		[-30, -60],
		[-70, -140],
	])
	// Starts sideways, then slants up: still too slanted to step.
	await touchDrag(page, 300, 600, [
		[-12, -2],
		[-50, -30],
		[-90, -70],
	])
	await page.waitForTimeout(300)
	await expectDay(page, 'Wednesday', 'Nov 18')
	await expect(page).toHaveURL(/day=2026-11-18$/)
})

test('a swipe that starts in the scale field leaves the day alone', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedRecipeMeal(user, '2026-11-18')
	await page.goto('/plan?weekStart=2026-11-16&day=2026-11-18')
	const field = page
		.getByTestId('mobile-plan')
		.getByRole('textbox', { name: 'Scale multiplier' })
	await hydrated(field)
	await swipeOn(page, field, -150)
	await page.waitForTimeout(300)
	await expectDay(page, 'Wednesday', 'Nov 18')
})

test('days picked in quick succession, by tap or by swipe, end on the last one', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/plan?weekStart=2026-11-16&day=2026-11-18')
	const strip = page.locator('[data-slot="mobile-week-days"]')
	await hydrated(strip)
	const day = (name: string) =>
		strip.getByRole('button', { name: new RegExp(`^Show ${name},`) })

	await day('Thursday').tap()
	await day('Friday').tap()
	await expectDay(page, 'Friday', 'Nov 20')
	await expect(page).toHaveURL(/day=2026-11-20$/)

	// Away and straight back to where it started.
	await day('Saturday').tap()
	await day('Friday').tap()
	await expectDay(page, 'Friday', 'Nov 20')
	await expect(page).toHaveURL(/day=2026-11-20$/)

	await swipeAt(page, 300, 640, -150)
	await swipeAt(page, 90, 640, 150)
	await expectDay(page, 'Friday', 'Nov 20')
	await expect(page).toHaveURL(/day=2026-11-20$/)
	await swipeAt(page, 300, 640, -150)
	await swipeAt(page, 300, 640, -150)
	await expectDay(page, 'Sunday', 'Nov 22')
	await expect(page).toHaveURL(/day=2026-11-22$/)
})

test('a swipe while the next week loads waits, so the turn still lands on Monday', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/plan?weekStart=2026-11-16&day=2026-11-22')
	await hydrated(page.getByTestId('mobile-plan'))
	let release = () => {}
	const held = new Promise<void>((resolve) => (release = resolve))
	await page.route(/weekStart=2026-11-23/, async (route) => {
		await held
		await route.continue()
	})
	await swipeAt(page, 300, 640, -150)
	// The first swipe's week is still on its way; a swipe back from the
	// Sunday still showing would go to Saturday.
	await swipeAt(page, 90, 640, 150)
	release()
	await expect(page).toHaveURL(/weekStart=2026-11-23&day=2026-11-23$/)
	await expectDay(page, 'Monday', 'Nov 23')
	await page.waitForTimeout(300)
	await expect(page).toHaveURL(/day=2026-11-23$/)
})

test('a swipe on the strip turns the week without stepping the day', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/plan?weekStart=2026-11-16&day=2026-11-18')
	const strip = page.locator('[data-slot="mobile-week-days"]')
	await hydrated(strip)
	await swipeOn(page, strip, -220)
	await expect(page).toHaveURL(/weekStart=2026-11-23$/)
	await expect(page.getByText('Nov 23 – 29')).toBeVisible()
})
