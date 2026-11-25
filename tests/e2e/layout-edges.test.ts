import { type Locator } from '@playwright/test'
import { getWeekStart, serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, openShopping, test } from '#tests/playwright-utils.ts'

// On a phone every row lines up on the page's edges: what leads a row (a
// cooked circle, a checkbox, a step number, a small label, the first icon)
// starts on the content edge, and the dots, trash and cart glyphs that end a
// row end on it. 44px tap areas reach into the gutter instead of pushing the
// glyphs in.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function box(locator: Locator) {
	await expect(locator).toBeVisible()
	const rect = (await locator.boundingBox())!
	return {
		left: Math.round(rect.x),
		right: Math.round(rect.x + rect.width),
		top: Math.round(rect.y),
		bottom: Math.round(rect.y + rect.height),
	}
}

/** Within a pixel: glyph boxes land on half pixels. */
function expectNear(actual: number, expected: number) {
	expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1)
}

function todayUTC() {
	const today = new Date()
	return new Date(
		Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
	)
}

/** The seeded week, named: bare /plan picks its week by the UTC date. */
function planWeek(today: Date) {
	return `/plan?weekStart=${serializeDate(getWeekStart(today))}`
}

test('Plan rows share the page edges, and a Meal without a label has no empty header line', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = (title: string) =>
		prisma.recipe.create({
			data: { title, userId: user.id, householdId: user.householdId },
		})
	const [soup, rice, pasta] = [
		await recipe('Miso Soup'),
		await recipe('Steamed Rice'),
		await recipe('Pasta alla Norma'),
	]
	const today = todayUTC()
	const plan = await prisma.mealPlan.create({
		data: { householdId: user.householdId, weekStart: getWeekStart(today) },
	})
	await prisma.meal.create({
		data: {
			mealPlanId: plan.id,
			date: today,
			order: 0,
			label: 'dinner',
			recipeItems: {
				create: [
					{ recipeId: soup.id, recipeTitle: soup.title, order: 0 },
					{ recipeId: rice.id, recipeTitle: rice.title, order: 1 },
				],
			},
		},
	})
	await prisma.meal.create({
		data: {
			mealPlanId: plan.id,
			date: today,
			order: 1,
			recipeItems: {
				create: { recipeId: pasta.id, recipeTitle: pasta.title, order: 0 },
			},
		},
	})

	await page.goto(planWeek(today))
	const mobile = page.getByTestId('mobile-plan')
	const heading = await box(
		page.getByRole('heading', { name: 'Plan', level: 1 }),
	)
	const add = await box(page.getByRole('button', { name: /^Add Meal to / }))
	const [left, right] = [heading.left, add.right]

	// Leading: the label and every cooked circle on the content edge.
	expectNear(
		(await box(mobile.getByText('Dinner', { exact: true }))).left,
		left,
	)
	for (const title of ['Miso Soup', 'Steamed Rice', 'Pasta alla Norma']) {
		const circle = mobile
			.getByRole('button', { name: `Mark ${title} cooked` })
			.locator('span')
			.first()
		expectNear((await box(circle)).left, left)
	}

	// Titles share one edge, past the circles.
	const titles = await Promise.all(
		['Miso Soup', 'Steamed Rice', 'Pasta alla Norma'].map((name) =>
			box(mobile.getByRole('link', { name })),
		),
	)
	expect(titles[0]!.left).toBeGreaterThan(left + 20)
	for (const title of titles) expectNear(title.left, titles[0]!.left)

	// The scale fields form one column, whether or not a Recipe has a trash
	// button beside it.
	const fields = mobile.getByRole('textbox', { name: 'Scale multiplier' })
	await expect(fields).toHaveCount(3)
	const fieldEdges = await Promise.all(
		[0, 1, 2].map(async (index) => (await box(fields.nth(index))).right),
	)
	for (const edge of fieldEdges) expectNear(edge, fieldEdges[0]!)

	// Trailing: the trash and dots glyphs end on the content edge.
	const trash = mobile
		.getByRole('button', { name: 'Remove Miso Soup from this Meal' })
		.locator('svg')
	expectNear((await box(trash)).right, right)
	const dinnerDots = mobile
		.getByRole('button', { name: 'Meal actions for Dinner' })
		.locator('svg')
	expectNear((await box(dinnerDots)).right, right)

	// The unlabeled Meal starts with its Recipe: its cooked toggle is the
	// first thing under the Meal's top padding, with no header line above it.
	const pastaMeal = await box(
		mobile
			.locator('[data-meal-id]')
			.filter({ has: page.getByRole('link', { name: 'Pasta alla Norma' }) }),
	)
	const pastaToggle = await box(
		mobile.getByRole('button', { name: 'Mark Pasta alla Norma cooked' }),
	)
	expect(pastaToggle.top - pastaMeal.top).toBeLessThanOrEqual(14)
	// The labeled Meal keeps its header line above its first Recipe.
	const dinnerMeal = await box(
		mobile
			.locator('[data-meal-id]')
			.filter({ has: page.getByRole('link', { name: 'Miso Soup' }) }),
	)
	const soupToggle = await box(
		mobile.getByRole('button', { name: 'Mark Miso Soup cooked' }),
	)
	expect(soupToggle.top - dinnerMeal.top).toBeGreaterThan(30)
	// Its actions end the row that holds Add Recipe.
	const pastaDots = await box(
		mobile.getByRole('button', { name: 'Meal actions for Pasta alla Norma' }),
	)
	const pastaAdd = await box(
		mobile.getByRole('button', { name: 'Add Recipe to Pasta alla Norma' }),
	)
	expect(pastaDots.top).toBeGreaterThan(titles[2]!.bottom)
	expectNear(
		(pastaDots.top + pastaDots.bottom) / 2,
		(pastaAdd.top + pastaAdd.bottom) / 2,
	)
	expectNear(
		(
			await box(
				mobile
					.getByRole('button', { name: 'Meal actions for Pasta alla Norma' })
					.locator('svg'),
			)
		).right,
		right,
	)
})

test('a Recipe page starts its actions, headings, checkboxes and steps on the content edge', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Weeknight Curry',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: [
					{ name: 'chicken thighs', amount: '600', unit: 'g', order: 0 },
					{ name: 'yogurt', amount: '150', unit: 'ml', order: 1 },
				],
			},
			instructions: {
				create: [
					{ content: 'Marinate the chicken.', order: 0 },
					{ content: 'Simmer until done.', order: 1 },
				],
			},
		},
	})

	await page.goto(`/recipes/${recipe.id}`)
	const title = await box(
		page.getByRole('heading', { name: 'Weeknight Curry', level: 1 }),
	)
	const left = title.left

	const favorite = page
		.getByRole('button', { name: 'Add to favorites' })
		.locator('svg')
	expectNear((await box(favorite)).left, left)
	expectNear(
		(await box(page.getByRole('heading', { name: 'Ingredients' }).first()))
			.left,
		left,
	)
	expectNear(
		(await box(page.getByRole('heading', { name: 'Instructions' }))).left,
		left,
	)

	// Checkboxes and step numbers share a column; ingredient and step text
	// share the next.
	const ingredient = page.getByRole('checkbox', { name: 'chicken thighs' })
	const checkbox = await box(ingredient.locator('span').first())
	expectNear(checkbox.left, left)
	const step = page.getByRole('checkbox').filter({ hasText: 'Marinate' })
	const number = await box(step.locator('span').first())
	expectNear(number.left, left)
	expectNear(number.right, checkbox.right)
	expectNear(
		(await box(step.locator('p'))).left,
		(await box(ingredient.locator('span').nth(1))).left,
	)

	// The cart glyph ends on the content edge, under the Metric toggle's end.
	const metric = await box(page.getByRole('button', { name: 'Metric' }))
	const cart = await box(
		ingredient.getByRole('button', { name: 'Add to Shopping' }).locator('svg'),
	)
	expectNear(cart.right, metric.right)
})

test('Shopping rows start on the content edge and end their dots on it', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: { create: [{ name: 'Milk' }, { name: 'Fennel' }] },
		},
	})

	await openShopping(page)
	const heading = await box(page.getByRole('heading', { level: 1 }))
	const milk = page.getByRole('group', { name: 'Milk shopping item' })
	const checkbox = await box(
		milk.getByRole('button', { name: 'Check off Milk' }).locator('div').first(),
	)
	expectNear(checkbox.left, heading.left)
	// The page's right content edge: the From Staples chip starts on the left
	// one, so measure against the list's hairline row instead.
	const row = await box(page.locator('[data-shopping-horizon]').first())
	const dots = await box(
		milk.getByRole('button', { name: 'Item actions' }).locator('svg'),
	)
	expectNear(dots.right, row.right)
})

test.describe('a wide touch screen', () => {
	// An iPad, or a phone on its side, gets the wide agenda but is touched:
	// its Meal controls stay 44px.
	test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true })

	test('keeps the Meal row controls 44px', async ({ page, login }) => {
		const user = await login()
		const soup = await prisma.recipe.create({
			data: {
				title: 'Miso Soup',
				userId: user.id,
				householdId: user.householdId,
			},
		})
		const today = todayUTC()
		await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart: getWeekStart(today),
				meals: {
					create: {
						date: today,
						order: 0,
						label: 'dinner',
						recipeItems: {
							create: { recipeId: soup.id, recipeTitle: soup.title, order: 0 },
						},
					},
				},
			},
		})

		await page.goto(planWeek(today))
		const agenda = page.getByTestId('desktop-plan')
		expect(
			await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
		).toBe(true)
		for (const control of [
			agenda.getByRole('button', { name: 'Mark Miso Soup cooked' }),
			agenda.getByRole('button', { name: 'Add Recipe to Miso Soup' }),
			agenda.getByRole('link', { name: 'Miso Soup' }),
		]) {
			expect(
				(await box(control)).bottom - (await box(control)).top,
			).toBeGreaterThanOrEqual(44)
		}
		const toggle = await box(
			agenda.getByRole('button', { name: 'Mark Miso Soup cooked' }),
		)
		expect(toggle.right - toggle.left).toBeGreaterThanOrEqual(44)
		// The dots are 32px to the eye; a pseudo-element takes taps around them.
		const dots = agenda.getByRole('button', {
			name: 'Meal actions for Miso Soup',
		})
		const hit = await dots.evaluate((element) => {
			const before = getComputedStyle(element, '::before')
			return { display: before.display, inset: before.top }
		})
		expect(hit.display).not.toBe('none')
		// So does the scale field: 28px to the eye, 44px to the thumb.
		const scale = await agenda
			.getByRole('textbox', { name: 'Scale multiplier' })
			.evaluate(
				(input) => getComputedStyle(input.closest('label')!, '::before').height,
			)
		expect(parseFloat(scale)).toBeGreaterThanOrEqual(44)
	})
})

test.describe('the desktop agenda', () => {
	test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false })

	test('closes Edit details after a save that adds or removes the header line', async ({
		page,
		login,
	}) => {
		const user = await login()
		const soup = await prisma.recipe.create({
			data: {
				title: 'Miso Soup',
				userId: user.id,
				householdId: user.householdId,
			},
		})
		const today = todayUTC()
		await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart: getWeekStart(today),
				meals: {
					create: {
						date: today,
						order: 0,
						recipeItems: {
							create: { recipeId: soup.id, recipeTitle: soup.title, order: 0 },
						},
					},
				},
			},
		})

		await page.goto(planWeek(today))
		const agenda = page.getByTestId('desktop-plan')
		const label = agenda.getByLabel('Label')
		for (const choice of ['dinner', '']) {
			await agenda
				.getByRole('button', { name: /^Meal actions for (Miso Soup|Dinner)$/ })
				.click()
			await page.getByRole('menuitem', { name: 'Edit details' }).click()
			await label.selectOption(choice)
			await agenda.getByRole('button', { name: 'Save' }).click()
			await expect(label).toHaveCount(0)
			const meal = await prisma.meal.findFirstOrThrow({
				where: { mealPlan: { householdId: user.householdId } },
			})
			expect(meal.label).toBe(choice || null)
		}
	})
})
