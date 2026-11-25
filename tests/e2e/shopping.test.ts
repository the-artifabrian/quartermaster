import { type Locator, type Page } from '@playwright/test'
import { getWeekStart, serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	convertToMetric,
	displayMetricAmount,
} from '#app/utils/metric-conversion.ts'
import {
	browserToday,
	expect,
	expectThumbSized,
	expectThumbTall,
	openShopping,
	tapUntil,
	test,
} from '#tests/playwright-utils.ts'

async function expectLocalPendingFeedback({
	page,
	button,
	statusName,
}: {
	page: Page
	button: Locator
	statusName: string
}) {
	const widthBefore = (await button.boundingBox())?.width
	expect(widthBefore).toBeDefined()

	const submission = button.click()
	await expect(button).toBeDisabled()
	const status = page.getByRole('status')
	await expect(status).toBeVisible()
	await expect(status).toContainText(statusName)
	expect((await button.boundingBox())?.width).toBe(widthBefore)
	await expect(
		page.getByRole('progressbar', { includeHidden: true }),
	).toHaveCount(0)

	await submission
	await expect(status).toBeHidden()
}

test('Recipe ingredient addition creates an outstanding purchase beside checked rice', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Rice supper',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: { name: 'rice', amount: '400', unit: 'g', order: 0 },
			},
			instructions: { create: { content: 'Cook the rice.', order: 0 } },
		},
	})
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: {
				create: { name: 'rice', quantity: '200', unit: 'g', checked: true },
			},
		},
	})
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`/recipes/${recipe.id}`)
	await page
		.getByRole('button', { name: 'Add to Shopping', exact: true })
		.click()
	await expect(
		page.getByRole('button', { name: 'Add to Shopping', exact: true }),
	).toBeDisabled()
	await expect
		.poll(() =>
			prisma.shoppingListItem.count({
				where: { list: { householdId: user.householdId } },
			}),
		)
		.toBe(2)
	await page
		.getByRole('link', { name: 'Shopping', exact: true })
		.filter({ visible: true })
		.click()
	const rows = page.getByRole('group', { name: 'rice shopping item' })
	const previous = rows.filter({ hasText: '200 g' })
	const outstanding = rows.filter({ hasText: '400 g' })
	await expect(rows).toHaveCount(2)
	await expect(
		previous.getByRole('button', { name: /^Uncheck / }),
	).toBeVisible()
	await expect(
		outstanding.getByRole('button', { name: /^Check off / }),
	).toBeVisible()
	await page.reload()
	await expect(
		previous.getByRole('button', { name: /^Uncheck / }),
	).toBeVisible()
	await expect(
		outstanding.getByRole('button', { name: /^Check off / }),
	).toBeVisible()
	await page.screenshot({
		path: test.info().outputPath('separate-purchases.png'),
		fullPage: true,
		animations: 'disabled',
	})

	// Either portion can be checked and cleared without affecting the other.
	await previous.getByRole('button', { name: /^Uncheck / }).click()
	await expect(previous.getByRole('status')).toBeHidden()
	await outstanding.getByRole('button', { name: /^Check off / }).click()
	await expect(outstanding.getByRole('status')).toBeHidden()
	const clearChecked = page.getByRole('button', {
		name: 'Clear checked items from Next shop',
	})
	await clearChecked.click()
	await expect(rows).toHaveCount(1)
	await expect(
		previous.getByRole('button', { name: /^Check off / }),
	).toBeVisible()
	// Cleared once its Undo toast has gone.
	await expect
		.poll(
			() =>
				prisma.shoppingListItem.count({
					where: { list: { householdId: user.householdId } },
				}),
			{ timeout: 10_000 },
		)
		.toBe(1)
	await page.reload()
	await expect(rows).toHaveCount(1)
	await expect(previous).toBeVisible()
})

test('a Meal joining a row added from Recipe detail shows the summed amount', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Leek soup',
			userId: user.id,
			householdId: user.householdId,
			ingredients: { create: { name: 'leeks', amount: '2', order: 0 } },
			instructions: { create: { content: 'Simmer.', order: 0 } },
		},
	})
	const weekStart = getWeekStart(browserToday())
	await prisma.meal.create({
		data: {
			mealPlan: { create: { householdId: user.householdId, weekStart } },
			date: weekStart,
			order: 0,
			recipeItems: {
				create: { recipeId: recipe.id, recipeTitle: recipe.title, order: 0 },
			},
		},
	})
	await page.setViewportSize({ width: 390, height: 844 })

	await page.goto(`/recipes/${recipe.id}`)
	await page
		.getByRole('button', { name: 'Add to Shopping', exact: true })
		.click()
	await expect
		.poll(() =>
			prisma.shoppingListItem.findMany({
				where: { list: { householdId: user.householdId } },
				select: { source: true, quantity: true },
			}),
		)
		.toEqual([{ source: 'recipe', quantity: '2' }])

	const day = serializeDate(weekStart)
	await page.goto(`/plan?weekStart=${day}&day=${day}`)
	await page.getByRole('button', { name: 'Meal actions for Leek soup' }).click()
	await page.getByRole('menuitem', { name: 'Add to Shopping' }).click()
	await expect(
		page.getByText('Added to 1 item already on Shopping'),
	).toBeVisible()

	await page
		.getByRole('link', { name: 'Shopping', exact: true })
		.filter({ visible: true })
		.click()
	const row = page.getByRole('group', { name: /^leeks? shopping item$/ })
	await expect(row).toHaveCount(1)
	// The amount line is the summed amount alone.
	await expect(row.getByText('4', { exact: true })).toBeVisible()
	await expect(row).not.toContainText('incl. meals')

	// In the database the Recipe-detail row keeps its own 2, and the Meal's
	// 2 is recorded against it.
	const saved = await prisma.shoppingListItem.findFirstOrThrow({
		where: { list: { householdId: user.householdId } },
		include: {
			mealContributions: { select: { quantity: true, mealId: true } },
		},
	})
	expect(saved).toMatchObject({
		source: 'recipe',
		quantity: '2',
		checked: false,
		mealContributions: [{ quantity: '2', mealId: expect.any(String) }],
	})
})

test('a range amount added from a Recipe keeps both ends on Shopping', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Garlic toast',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: [
					{ name: 'garlic', amount: '1-2', unit: 'cloves', order: 0 },
					{ name: 'flour', amount: '1-2', unit: 'cups', order: 1 },
				],
			},
			instructions: { create: { content: 'Rub the toast.', order: 0 } },
		},
	})
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`/recipes/${recipe.id}`)
	await expect(page.getByText('1-2 cloves', { exact: false })).toBeVisible()
	const savedItems = () =>
		prisma.shoppingListItem.findMany({
			where: { list: { householdId: user.householdId } },
			select: { name: true, quantity: true, unit: true },
			orderBy: { name: 'asc' },
		})
	const addRow = (name: string) =>
		page
			.getByRole('checkbox', { name, exact: true })
			.getByRole('button', { name: 'Add to Shopping', exact: true })
			.click()

	await addRow('garlic')
	await expect
		.poll(savedItems)
		.toEqual([{ name: 'garlic', quantity: '1-2', unit: 'cloves' }])

	// Metric converts a single amount; a range has no single value and
	// stays in the author's unit.
	await page.getByRole('button', { name: 'Metric' }).click()
	await expect(page.getByRole('button', { name: 'Metric' })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
	await addRow('flour')
	await expect.poll(savedItems).toEqual([
		{ name: 'flour', quantity: '1-2', unit: 'cups' },
		{ name: 'garlic', quantity: '1-2', unit: 'cloves' },
	])

	await page
		.getByRole('link', { name: 'Shopping', exact: true })
		.filter({ visible: true })
		.click()
	await expect(
		page.getByRole('group', { name: 'garlic shopping item' }),
	).toContainText('1-2 cloves')
	await expect(
		page.getByRole('group', { name: 'flour shopping item' }),
	).toContainText('1-2 cups')
})

test('"1-1/2 cups" reads as one and a half on the Recipe, scales, and converts to metric', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Drop scones',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: { name: 'flour', amount: '1-1/2', unit: 'cups', order: 0 },
			},
			instructions: { create: { content: 'Mix and fry.', order: 0 } },
		},
	})
	await page.setViewportSize({ width: 390, height: 844 })
	const flourRow = page.getByRole('checkbox', { name: 'flour', exact: true })

	await page.goto(`/recipes/${recipe.id}?scale=2`)
	await expect(flourRow).toContainText('3 cups')

	await page.goto(`/recipes/${recipe.id}`)
	await expect(flourRow).toContainText('1 1/2 cups')

	// A range would stay in cups; one number converts.
	await page.getByRole('button', { name: 'Metric' }).click()
	await expect(page.getByRole('button', { name: 'Metric' })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
	await flourRow
		.getByRole('button', { name: 'Add to Shopping', exact: true })
		.click()
	const metric = displayMetricAmount(convertToMetric(1.5, 'cups', 'flour')!)
	await expect
		.poll(() =>
			prisma.shoppingListItem.findMany({
				where: { list: { householdId: user.householdId } },
				select: { name: true, quantity: true, unit: true },
			}),
		)
		.toEqual([{ name: 'flour', quantity: metric.quantity, unit: metric.unit }])
	expect(metric.unit).toBe('g')
})

test('a typed "1 L milk" is a litre of milk on Shopping', async ({
	page,
	login,
}) => {
	const user = await login()
	await page.goto('/shopping')
	await page
		.getByPlaceholder(/add an item/i)
		.filter({ visible: true })
		.fill('1 L milk')
	await page.getByRole('button', { name: /add to next shop/i }).click()
	await expect
		.poll(() =>
			prisma.shoppingListItem.findMany({
				where: { list: { householdId: user.householdId } },
				select: { name: true, quantity: true, unit: true },
			}),
		)
		.toEqual([{ name: 'milk', quantity: '1', unit: 'l' }])
	await expect(
		page.getByRole('group', { name: 'milk shopping item' }),
	).toContainText('1 l')
})

test('Shopping list flow: pick from Plan → verify items → add manual → check → clear', async ({
	page,
	login,
}) => {
	test.setTimeout(45_000)
	const user = await login()

	// Pro access (shopping requires Pro)
	await prisma.subscription.create({
		data: {
			userId: user.id,
			tier: 'pro',
			trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		},
	})

	// Set up recipe + meal plan via DB
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Test Recipe',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: [
					{ name: 'chicken breast', amount: '2', unit: 'lbs', order: 0 },
					{ name: 'jasmine rice', amount: '1', unit: 'cup', order: 1 },
					{ name: 'broccoli', amount: '1', unit: 'head', order: 2 },
					{ name: 'spring onions', amount: '1', unit: 'bunch', order: 3 },
				],
			},
			instructions: {
				create: [{ content: 'Cook everything', order: 0 }],
			},
		},
	})

	// The picker folds Meals from before today, so plan this one for today.
	const now = new Date()
	const today = new Date(
		Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
	)
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
						create: {
							order: 0,
							recipeId: recipe.id,
							recipeTitle: recipe.title,
							scaleMultiplier: 1,
						},
					},
				},
			},
		},
	})

	// 1. Navigate to shopping list
	await page.goto('/shopping')
	await expect(
		page.getByRole('heading', { level: 1, name: /^Shopping/ }),
	).toBeVisible()

	// Keep the From Plan add pending long enough for delayed local feedback.
	await page.route('**/shopping*', async (route) => {
		const request = route.request()
		const form =
			request.method() === 'POST'
				? (request.postDataJSON() as Record<string, unknown>)
				: null
		if (form?.intent === 'add-from-plan') {
			await new Promise((resolve) => setTimeout(resolve, 1250))
		}
		await route.continue()
	})

	// 2. Open the From Plan picker, untick one line, and add the rest with
	// local feedback on phone and desktop.
	await page.setViewportSize({ width: 1280, height: 800 })
	await page.getByRole('button', { name: /from plan/i }).click()
	await expect(
		page.getByRole('heading', { name: /add from the plan/i }),
	).toBeVisible()
	for (const name of [/^broccoli/i, /^jasmine rice/i]) {
		const line = page.getByRole('button', { name })
		await expect(line).toHaveAttribute('aria-pressed', 'true')
		await line.click()
		await expect(line).toHaveAttribute('aria-pressed', 'false')
	}
	await expectLocalPendingFeedback({
		page,
		button: page.getByRole('button', { name: /add 2 from 1 meal/i }),
		statusName: 'Adding picked Meals to Shopping',
	})

	// 3. Only the picked lines land on the list.
	await expect(
		page.getByRole('heading', { name: /add from the plan/i }),
	).toBeHidden()
	await expect(page.getByText('chicken breast')).toBeVisible()
	await expect(page.getByText('spring onions')).toBeVisible()
	await expect(page.getByText('jasmine rice')).toBeHidden()
	await expect(page.getByText('broccoli')).toBeHidden()

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		if (viewport.width < 768) {
			await page.getByRole('button', { name: 'Add item' }).click()
		}
		for (const control of [
			page
				.getByText('chicken breast', { exact: true })
				.filter({ visible: true }),
			page.getByPlaceholder(/add an item/i).filter({ visible: true }),
		]) {
			await expect(control).toBeVisible()
			const box = await control.boundingBox()
			expect(box).not.toBeNull()
			expect(box!.x).toBeGreaterThanOrEqual(0)
			expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
		}
		if (viewport.width < 768) {
			// `exact` keeps this off a lingering toast's "Close toast" button.
			await page.getByRole('button', { name: 'Close', exact: true }).click()
			await expect(page.getByRole('dialog')).toHaveCount(0)
		}
	}

	// 4. Add manual item via Quick Add
	await page
		.getByPlaceholder(/add an item/i)
		.filter({ visible: true })
		.fill('Bananas')
	await page.getByRole('button', { name: /add to next shop/i }).click()
	await expect(page.getByText('Bananas')).toBeVisible()

	// 5. Deleting a row takes one tap, with Undo. Foil is added once Bananas
	// is saved, and the page reloads once Foil is, so the menu opens on the
	// saved row rather than the optimistic one it replaces.
	await expect
		.poll(() =>
			prisma.shoppingListItem.count({
				where: { name: 'Bananas', list: { householdId: user.householdId } },
			}),
		)
		.toBe(1)
	await page.reload()
	await page
		.getByPlaceholder(/add an item/i)
		.filter({ visible: true })
		.fill('Foil')
	await page.getByRole('button', { name: /add to next shop/i }).click()
	await expect(page.getByText('Foil', { exact: true })).toBeVisible()

	const foilSaved = {
		name: 'Foil',
		list: { householdId: user.householdId },
	}
	await expect
		.poll(() => prisma.shoppingListItem.count({ where: foilSaved }))
		.toBe(1)
	await page.reload()
	const foil = page.getByRole('group', { name: 'Foil shopping item' })
	await foil.getByRole('button', { name: 'Item actions' }).click()
	await expect(
		page.getByRole('menuitem', { name: 'Edit', exact: true }),
	).toBeVisible()
	// Delete deletes at once, with Undo.
	const deleteFoil = page.getByRole('menuitem', { name: 'Delete', exact: true })
	await deleteFoil.click()
	await expect(foil).toBeHidden()
	await expect
		.poll(() => prisma.shoppingListItem.count({ where: foilSaved }), {
			timeout: 10_000,
		})
		.toBe(0)

	// 6. Check and clear items with local feedback on phone and desktop.
	const clearedNames: string[] = []
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		const checkOff = page.getByRole('button', { name: /^Check off / }).first()
		const label = (await checkOff.getAttribute('aria-label'))!
		clearedNames.push(label.replace(/^Check off /, ''))
		await checkOff.click()
		await expect(page.getByText(/\(1\/\d+\)/)).toBeVisible()

		// Clear checked clears at once; Undo is on offer at the bottom.
		await page.getByRole('button', { name: /clear checked/i }).click()
		await expect(page.getByText(/\(0\/\d+\)/)).toBeVisible()
		await expect(
			page.getByRole('button', { name: /clear checked/i }),
		).toBeHidden()
	}

	// The checked items should be gone, while unchecked items remain.
	await expect(page.getByText('spring onions')).toBeVisible()
	// And saved so, once the Undo toasts have gone.
	await expect
		.poll(
			async () => {
				const names = (
					await prisma.shoppingListItem.findMany({
						where: { list: { householdId: user.householdId } },
						select: { name: true },
					})
				).map((item) => item.name)
				return {
					cleared: clearedNames.filter((name) => names.includes(name)),
					springOnions: names.includes('spring onions'),
				}
			},
			{ timeout: 10_000 },
		)
		.toEqual({ cleared: [], springOnions: true })
})

test('From Plan shows what a Meal already put on Shopping as on the list, and the Meal as done', async ({
	page,
	login,
}) => {
	// The done Meal box keeps keyboard focus when a toggle makes the Meal done,
	// and the words saying so belong to something a keyboard can reach.
	const user = await login()
	await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Chicken traybake',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: [
					{ name: 'chicken thighs', amount: '8', order: 0 },
					{ name: 'broccoli', amount: '1', unit: 'head', order: 1 },
					{ name: 'lemon', amount: '1', order: 2 },
					// Usually on hand, so it never goes on with the rest.
					{ name: 'salt', order: 3 },
				],
			},
		},
	})
	const now = new Date()
	const today = new Date(
		Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
	)
	const meal = await prisma.meal.create({
		data: {
			mealPlan: {
				create: {
					householdId: user.householdId,
					weekStart: getWeekStart(today),
				},
			},
			date: today,
			order: 0,
			recipeItems: {
				create: {
					order: 0,
					recipeId: recipe.id,
					recipeTitle: recipe.title,
					scaleMultiplier: 1,
				},
			},
		},
	})
	const saved = () =>
		prisma.mealShoppingContribution.findMany({
			where: { mealId: meal.id },
			orderBy: { canonicalName: 'asc' },
			select: { canonicalName: true, item: { select: { name: true } } },
		})

	await openShopping(page)
	const fromPlan = page.getByRole('button', { name: /^From Plan/ })
	const picker = page.getByRole('dialog')
	const addButton = picker.getByRole('button', { name: /^Add / })
	const lineButton = (name: string) =>
		picker.getByRole('button', { name: new RegExp(`^${name}`) })

	// Leave broccoli for later and add the rest.
	await fromPlan.click()
	await lineButton('broccoli').click()
	await expect(lineButton('broccoli')).toHaveAttribute('aria-pressed', 'false')
	await addButton.click()
	await expect(picker).toBeHidden()
	await expect.poll(saved).toEqual([
		{ canonicalName: 'chicken', item: { name: 'chicken thighs' } },
		{ canonicalName: 'lemon', item: { name: 'lemon' } },
	])

	// The two added lines are on the list: a muted check, no button. Broccoli
	// is ticked and salt isn't, so the Meal is part picked.
	await fromPlan.click()
	for (const name of ['chicken thighs', 'lemon']) {
		await expect(
			picker.getByText(new RegExp(`^${name} ·`)).locator('..'),
		).toContainText('On Shopping')
		await expect(lineButton(name)).toHaveCount(0)
	}
	await expect(lineButton('broccoli')).toHaveAttribute('aria-pressed', 'true')
	const mealBox = picker.getByRole('button', {
		name: /every line in Chicken traybake/,
	})
	await expect(mealBox).toHaveAttribute('aria-pressed', 'mixed')
	await expect(addButton).toHaveText('Add 1 from 1 Meal')
	await addButton.click()
	await expect(picker).toBeHidden()
	await expect.poll(saved).toEqual([
		{ canonicalName: 'broccoli', item: { name: 'broccoli' } },
		{ canonicalName: 'chicken', item: { name: 'chicken thighs' } },
		{ canonicalName: 'lemon', item: { name: 'lemon' } },
	])

	// With every line on the list but salt, which is usually on hand, the
	// Meal is done and there is nothing to add.
	await fromPlan.click()
	const mealBoxes = picker.getByRole('button', {
		name: /tick .*Chicken traybake/i,
	})
	await expect(picker.getByText('On Shopping', { exact: true })).toHaveCount(3)
	await expect(
		picker.getByText('Everything to buy is on Shopping'),
	).toBeAttached()
	await expect(mealBoxes).toHaveCount(0)
	await expect(addButton).toHaveText('Add to Next shop')
	await expect(addButton).toBeDisabled()

	// The Meal's own button carries the done state for someone tabbing
	// through, who never reaches the hidden text on its own.
	const disclosure = picker.locator('[aria-controls^="plan-picker-"]')
	await expect(disclosure).toHaveAccessibleDescription(
		'Everything to buy is on Shopping',
	)

	// Salt can still be ticked on its own. The Meal box comes back while it
	// is, and the Meal is done again once it isn't.
	await lineButton('salt').click()
	await expect(lineButton('salt')).toHaveAttribute('aria-pressed', 'true')
	await expect(mealBoxes).toHaveAttribute('aria-pressed', 'true')
	await expect(disclosure).toHaveAccessibleDescription('')
	await expect(addButton).toHaveText('Add 1 from 1 Meal')
	await lineButton('salt').click()
	await expect(mealBoxes).toHaveCount(0)
	await expect(addButton).toBeDisabled()

	// Emptying the Meal from its box by keyboard makes it done, and the box
	// goes; focus lands on the Meal's own button rather than the page.
	await lineButton('salt').click()
	await mealBoxes.focus()
	await page.keyboard.press('Enter')
	await expect(mealBoxes).toHaveCount(0)
	await expect(disclosure).toBeFocused()
	await expect(disclosure).toHaveAccessibleDescription(
		'Everything to buy is on Shopping',
	)
	expect(
		await prisma.shoppingListItem.count({
			where: { list: { householdId: user.householdId } },
		}),
	).toBe(3)
	await picker.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(picker).toBeHidden()

	// Lemon moved to Later: From Plan offers it unticked, and ticking it moves
	// the row back to Next shop.
	const lemonRow = { name: 'lemon', list: { householdId: user.householdId } }
	await prisma.shoppingListItem.updateMany({
		where: lemonRow,
		data: { horizon: 'later' },
	})
	await fromPlan.click()
	await expect(lineButton('lemon')).toHaveAttribute('aria-pressed', 'false')
	await expect(lineButton('lemon')).toContainText('On Later')
	await expect(mealBoxes).toHaveAttribute('aria-pressed', 'false')
	await lineButton('lemon').click()
	await addButton.click()
	await expect(picker).toBeHidden()
	await expect(page.getByText('Moved 1 item to Next shop')).toBeVisible()
	await expect
		.poll(async () =>
			(
				await prisma.shoppingListItem.findMany({
					where: { list: { householdId: user.householdId } },
					select: { name: true, horizon: true },
					orderBy: { name: 'asc' },
				})
			).map((row) => [row.name, row.horizon]),
		)
		.toEqual([
			['broccoli', 'next'],
			['chicken thighs', 'next'],
			['lemon', 'next'],
		])
})

test('household Staples can be added together from the quiet Shopping picker', async ({
	page,
	login,
}) => {
	test.setTimeout(30_000)
	const user = await login()
	const { householdId } = user
	await prisma.householdIngredient.createMany({
		data: [
			{
				householdId,
				displayName: 'Milk',
				canonicalKey: 'milk',
				isStaple: true,
			},
			{
				householdId,
				displayName: 'Yogurt',
				canonicalKey: 'yogurt',
				isStaple: true,
			},
			{
				householdId,
				displayName: 'Salt',
				canonicalKey: 'salt',
				isStaple: true,
			},
		],
	})
	await prisma.subscription.create({
		data: {
			userId: user.id,
			tier: 'pro',
			trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		},
	})
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: { create: { name: 'Salt', horizon: 'later' } },
		},
	})

	await page.setViewportSize({ width: 390, height: 844 })
	let choiceRequestCount = 0
	await page.route('**/resources/shopping-staples', async (route) => {
		choiceRequestCount += 1
		await new Promise((resolve) => setTimeout(resolve, 500))
		if (choiceRequestCount === 1) {
			await route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'temporarily unavailable' }),
			})
			return
		}
		await route.continue()
	})

	await page.goto('/shopping')
	// Production hydration is asynchronous and `networkidle` never settles due
	// to live refresh, so retry the first interaction until the popover responds.
	await expect(async () => {
		await page
			.getByRole('button', { name: 'From Staples, reminder available' })
			.click()
		await expect(
			page.getByRole('heading', { name: 'Add from Staples' }),
		).toBeVisible({ timeout: 2000 })
	}).toPass({ timeout: 15_000 })
	await expect(page.getByRole('button', { name: 'From Staples' })).toBeVisible()
	await expect(page.getByRole('status')).toContainText('Loading Staples')
	await expect(page.getByRole('alert')).toContainText('Couldn’t load Staples')
	await page.getByRole('button', { name: 'Try again' }).click()
	await expect(page.getByRole('status')).toContainText('Loading Staples')
	await expect(
		page.getByRole('button', { name: /Salt.*On list/ }),
	).toBeDisabled()
	expect(choiceRequestCount).toBe(2)

	await page.getByRole('button', { name: 'Milk' }).click()
	await page.getByRole('button', { name: 'Yogurt' }).click()
	await page.getByRole('button', { name: 'Add 2 to Next shop' }).click()

	await expect(
		page.getByRole('heading', { name: 'Add from Staples' }),
	).toBeHidden()
	await expect(page.getByText('Milk', { exact: true })).toBeVisible()
	await expect(page.getByText('Yogurt', { exact: true })).toBeVisible()
	await expect
		.poll(() =>
			prisma.shoppingListItem.findMany({
				where: { list: { householdId: user.householdId } },
				orderBy: { name: 'asc' },
				select: { name: true, horizon: true },
			}),
		)
		.toEqual([
			{ name: 'Milk', horizon: 'next' },
			{ name: 'Salt', horizon: 'later' },
			{ name: 'Yogurt', horizon: 'next' },
		])

	// On a phone the picker is a sheet; its Close shuts it.
	const staplesSheet = page.getByRole('dialog', {
		name: 'Add from Staples',
	})
	async function closeStaplesSheet() {
		await staplesSheet
			.getByRole('button', { name: 'Close', exact: true })
			.click()
		await expect(staplesSheet).toBeHidden()
	}

	// The successful choices stay cached, while live Shopping rows continue to
	// drive membership through action revalidation.
	await page.getByRole('button', { name: 'From Staples' }).click()
	await expect(
		page.getByRole('button', { name: /Milk.*On list/ }),
	).toBeDisabled()
	await expect(
		page.getByRole('button', { name: /Yogurt.*On list/ }),
	).toBeDisabled()
	expect(choiceRequestCount).toBe(2)
	await closeStaplesSheet()

	const milkRow = page.getByRole('group', { name: 'Milk shopping item' })
	await milkRow.getByRole('button', { name: /^Check off / }).click()
	await expect(milkRow.getByRole('button', { name: /^Uncheck / })).toBeVisible()
	await page.getByRole('button', { name: 'From Staples' }).click()
	await expect(
		page.getByRole('button', { name: /Milk.*On list/ }),
	).toBeDisabled()
	await closeStaplesSheet()
	await milkRow.getByRole('button', { name: /^Uncheck / }).click()
	await expect(
		milkRow.getByRole('button', { name: /^Check off / }),
	).toBeVisible()

	const yogurtRow = page.getByRole('group', { name: 'Yogurt shopping item' })
	await yogurtRow.getByRole('button', { name: 'Item actions' }).click()
	await page.getByRole('menuitem', { name: 'Move to Later' }).click()
	await expect(yogurtRow).toBeHidden()
	await page.getByRole('button', { name: 'From Staples' }).click()
	await expect(
		page.getByRole('button', { name: /Yogurt.*On list/ }),
	).toBeDisabled()
	expect(choiceRequestCount).toBe(2)
	await closeStaplesSheet()

	await page.getByRole('link', { name: 'Staples' }).click()
	await expect(page).toHaveURL('/staples')
	await page.getByRole('link', { name: 'Shopping', exact: true }).click()
	await expect(page).toHaveURL('/shopping')
	await page.getByRole('button', { name: 'From Staples' }).click()
	await expect(
		page.getByRole('button', { name: /Milk.*On list/ }),
	).toBeDisabled()
	expect(choiceRequestCount).toBe(3)
})

test('Next shop and Later stay usable and search-revealable on phone and desktop', async ({
	page,
	login,
}) => {
	test.setTimeout(30_000)
	const user = await login()
	await prisma.subscription.create({
		data: {
			userId: user.id,
			tier: 'pro',
			trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		},
	})
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: {
				create: [
					{ name: 'Milk', horizon: 'next' },
					{ name: 'Bread', horizon: 'next' },
					{
						name: 'Camping fuel — phone',
						horizon: 'later',
						checked: true,
					},
					{
						name: 'Camping fuel — desktop',
						horizon: 'later',
						checked: true,
					},
					{ name: 'Solar eclipse glasses', horizon: 'later' },
					...Array.from({ length: 11 }, (_, index) => ({
						name: `Later item ${index + 1}`,
						horizon: 'later',
					})),
				],
			},
		},
	})

	for (const [viewport, itemName, activeProgress, laterCount] of [
		[{ width: 390, height: 844 }, 'Camping fuel — phone', '(0/2)', 14],
		[{ width: 1280, height: 800 }, 'Camping fuel — desktop', '(1/3)', 13],
	] as const) {
		await page.setViewportSize(viewport)
		await page.goto('/shopping')
		const pageHeading = page.getByRole('heading', { level: 1 })
		await expect(pageHeading).toContainText('Shopping')
		await expect(pageHeading).toContainText(activeProgress)
		await expect(
			page.getByRole('heading', { name: 'Next shop', exact: true }),
		).toHaveCount(0)
		const laterToggle = page.getByRole('button', { name: /^Later/ })
		await expect(laterToggle).toContainText(`(${laterCount})`)
		await expect(laterToggle).toHaveAttribute('aria-expanded', 'false')
		await expect(page.getByText(itemName, { exact: true })).toHaveCount(0)

		await laterToggle.click()
		await expect(laterToggle).toHaveAttribute('aria-expanded', 'true')
		await expect(page.getByPlaceholder('Add to Later…')).toBeVisible()
		const laterGroup = page.getByRole('group', {
			name: `${itemName} shopping item`,
		})
		await expect(
			laterGroup.getByRole('button', { name: /^Uncheck / }),
		).toBeVisible()
		await laterGroup.getByRole('button', { name: 'Item actions' }).click()
		const moveResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'POST' &&
				response.url().includes('/shopping') &&
				response.request().postData()?.includes('intent=move') === true,
		)
		await page.getByRole('menuitem', { name: 'Move to Next shop' }).click()
		await moveResponse

		const nextSection = page.getByTestId('next-shopping-items')
		const movedGroup = nextSection.getByRole('group', {
			name: `${itemName} shopping item`,
		})
		await expect(movedGroup).toBeVisible({ timeout: 10_000 })
		await expect(
			movedGroup.getByRole('button', { name: /^Uncheck / }),
		).toBeVisible()
		const movedBox = await movedGroup.boundingBox()
		expect(movedBox).not.toBeNull()
		expect(movedBox!.x).toBeGreaterThanOrEqual(0)
		expect(movedBox!.x + movedBox!.width).toBeLessThanOrEqual(viewport.width)

		// A search reveals a collapsed Later match without changing the stored
		// expansion preference; clearing it collapses Later again.
		await page.goto('/shopping')
		const search = page.getByPlaceholder('Search Shopping…')
		await search.fill('Solar eclipse glasses')
		await expect(
			page.getByText('Solar eclipse glasses', { exact: true }),
		).toBeVisible()
		await search.fill('')
		await expect(
			page.getByText('Solar eclipse glasses', { exact: true }),
		).toHaveCount(0)
		await expect(page.getByRole('button', { name: /^Later/ })).toHaveAttribute(
			'aria-expanded',
			'false',
		)
	}
})

test('a comma decimal reads as one number on the Recipe, when scaled, and in the Shopping total', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
	await page.setViewportSize({ width: 1280, height: 800 })

	// Written the way a Romanian cook writes it.
	await page.goto('/recipes/new')
	await page.getByRole('textbox', { name: /title/i }).fill('Country bread')
	await page.getByPlaceholder('Ingredient name').fill('flour')
	await page.getByPlaceholder('Amount').fill('1,5')
	await page.getByPlaceholder('Unit').fill('kg')
	await page.getByPlaceholder('Step 1').fill('Mix and bake.')
	await page.getByRole('button', { name: 'Save', exact: true }).click()
	await expect(page).toHaveURL(/\/recipes\/(?!new$)[a-z0-9]+$/)
	const recipeId = new URL(page.url()).pathname.split('/').at(-1)!
	expect(
		await prisma.ingredient.findMany({
			where: { recipeId },
			select: { amount: true, unit: true, name: true },
		}),
	).toEqual([{ amount: '1,5', unit: 'kg', name: 'flour' }])

	const flourRow = page.getByRole('checkbox', { name: 'flour', exact: true })
	await expect(flourRow).toContainText('1.5 kg')

	const multiplier = page.getByLabel('Scale multiplier')
	await expect(async () => {
		if (!(await multiplier.isVisible())) {
			await page.getByRole('button', { name: 'Scale 1×' }).click()
		}
		await expect(multiplier).toBeVisible({ timeout: 2000 })
	}).toPass({ timeout: 10_000 })
	await multiplier.fill('2')
	await multiplier.press('Enter')
	await expect(page).toHaveURL(new RegExp(`/recipes/${recipeId}\\?scale=2$`))
	await expect(flourRow).toContainText('3 kg')

	// Plan it for today, so the From Plan picker offers it.
	const now = new Date()
	const today = new Date(
		Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
	)
	await prisma.mealPlan.create({
		data: {
			householdId: user.householdId,
			weekStart: getWeekStart(today),
			meals: {
				create: {
					date: today,
					order: 0,
					recipeItems: {
						create: {
							order: 0,
							recipeId,
							recipeTitle: 'Country bread',
							scaleMultiplier: 1,
						},
					},
				},
			},
		},
	})

	await page.goto('/shopping')
	await page
		.getByPlaceholder(/add an item/i)
		.filter({ visible: true })
		.fill('500 g flour')
	await page.getByRole('button', { name: /add to next shop/i }).click()
	const savedFlour = () =>
		prisma.shoppingListItem.findMany({
			where: { list: { householdId: user.householdId } },
			select: {
				name: true,
				quantity: true,
				unit: true,
				mealContributions: { select: { quantity: true, unit: true } },
			},
		})
	await expect
		.poll(savedFlour)
		.toEqual([
			{ name: 'flour', quantity: '500', unit: 'g', mealContributions: [] },
		])
	await page.reload()

	// Flour is on the list without this Meal's amount, so the picker offers
	// it unticked and says why.
	await page.getByRole('button', { name: /from plan/i }).click()
	const flourLine = page.getByRole('button', { name: /^flour/i })
	await expect(flourLine).toHaveAttribute('aria-pressed', 'false')
	await expect(flourLine).toContainText('On Shopping, not this Meal’s amount')
	await flourLine.click()
	await expect(flourLine).toHaveAttribute('aria-pressed', 'true')
	await page.getByRole('button', { name: /add 1 from 1 meal/i }).click()
	await expect.poll(savedFlour).toEqual([
		{
			name: 'flour',
			quantity: '500',
			unit: 'g',
			mealContributions: [{ quantity: '1,5', unit: 'kg' }],
		},
	])
	// 500 g and 1,5 kg make 2 kg, not the 1.5 kg a reader that stops at the
	// comma would show.
	const flourItem = page.getByRole('group', { name: 'flour shopping item' })
	await expect(flourItem).toContainText('2 kg')
	await page.reload()
	await expect(flourItem).toContainText('2 kg')
})

test('the old Shopping address still opens Shopping, and a form posted to it saves nothing', async ({
	page,
	login,
}) => {
	const user = await login()

	// A form posted to the old address is refused rather than redirected, since
	// a redirect drops its body and the page would take that as saved.
	const posted = await page.request.post('/plan/shopping-list', {
		form: { intent: 'add', name: 'oat milk' },
		maxRedirects: 0,
	})
	expect(posted.status()).toBe(405)
	expect(posted.headers()['location']).toBeUndefined()
	expect(
		await prisma.shoppingListItem.count({
			where: { list: { householdId: user.householdId } },
		}),
	).toBe(0)

	await page.goto('/plan/shopping-list?horizon=later')
	await expect(page).toHaveURL('/shopping?horizon=later')
	await expect(
		page.getByRole('heading', { level: 1, name: /^Shopping/ }),
	).toBeVisible()
})

test('the phone add sheet opens empty after each way of closing it, and still adds an item', async ({
	page,
	login,
}) => {
	// Four opens and closes of a sliding sheet.
	test.setTimeout(30_000)
	const user = await login()
	await prisma.shoppingList.create({
		data: { userId: user.id, householdId: user.householdId },
	})
	await page.setViewportSize({ width: 390, height: 844 })
	await openShopping(page)
	const addItem = page.getByRole('button', { name: 'Add item' })
	const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })
	const name = sheet.getByPlaceholder('Add an item…')
	const quantity = sheet.getByPlaceholder('Qty')
	const unit = sheet.getByPlaceholder('Unit')

	await addItem.click()
	// The sheet moves focus to the name a moment after it opens; typing
	// before then would land there.
	await expect(name).toBeFocused()
	await sheet.getByRole('button', { name: '+ Qty & unit' }).click()
	const closeWays: Array<[string, () => Promise<void>]> = [
		[
			'Close',
			() => sheet.getByRole('button', { name: 'Close', exact: true }).click(),
		],
		// The backdrop, above the sheet.
		['the backdrop', () => page.mouse.click(195, 200)],
		['Escape', () => page.keyboard.press('Escape')],
	]
	for (const [way, close] of closeWays) {
		await name.fill('butter')
		await quantity.fill('2')
		await unit.fill('kg')
		await close()
		await expect(sheet, `closed with ${way}`).toBeHidden()
		// Leaving, the sheet showed what was typed; it clears on the next open.
		await addItem.click()
		await expect(name).toBeFocused()
		await expect(name, `reopened after ${way}`).toHaveValue('')
		await expect(quantity, `reopened after ${way}`).toHaveValue('')
		await expect(unit, `reopened after ${way}`).toHaveValue('')
	}

	await name.fill('Butter')
	await quantity.fill('250')
	await unit.fill('g')
	await sheet.getByRole('button', { name: 'Add to Next shop' }).click()
	await expect(
		page.getByRole('group', { name: 'Butter shopping item' }),
	).toBeVisible()
	await expect(name).toHaveValue('')
	await expect
		.poll(() =>
			prisma.shoppingListItem.findMany({
				where: { list: { householdId: user.householdId } },
				select: { name: true, quantity: true, unit: true },
			}),
		)
		.toEqual([{ name: 'Butter', quantity: '250', unit: 'g' }])
})

test('the phone add sheet opens without the last item’s warning, and checks the next add again', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: { create: { name: 'Milk' } },
		},
	})
	await page.setViewportSize({ width: 390, height: 844 })
	await openShopping(page)
	const addItem = page.getByRole('button', { name: 'Add item' })
	const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })
	const name = sheet.getByPlaceholder('Add an item…')
	const warning = sheet.getByText('Milk is already on Shopping')

	await addItem.click()
	await expect(name).toBeFocused()
	await name.fill('Milk')
	await sheet.getByRole('button', { name: 'Add to Next shop' }).click()
	await expect(warning).toBeVisible()
	await sheet.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(sheet).toBeHidden()

	await addItem.click()
	await expect(name).toBeFocused()
	await expect(warning).toBeHidden()
	await name.fill('Milk')
	await sheet.getByRole('button', { name: 'Add to Next shop' }).click()
	await expect(warning).toBeVisible()
	const milkRows = () =>
		prisma.shoppingListItem.count({
			where: { list: { householdId: user.householdId }, name: 'Milk' },
		})
	expect(await milkRows()).toBe(1)

	await sheet.getByRole('button', { name: 'Add anyway' }).click()
	await expect(warning).toBeHidden()
	await expect.poll(milkRows).toBe(2)
})

test.describe('swiping a row', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

	/**
	 * Drags one finger across a locator's middle, from `fromX` to `toX` (as
	 * fractions of its width), over `ms`. Chromium turns these touch events into
	 * pointer events of type "touch".
	 */
	async function swipe(
		page: Page,
		target: Locator,
		{
			fromX,
			toX,
			ms,
			holdMs = 0,
			steps = 12,
		}: {
			fromX: number
			toX: number
			ms: number
			holdMs?: number
			steps?: number
		},
	) {
		const box = (await target.boundingBox())!
		const y = box.y + box.height / 2
		const cdp = await page.context().newCDPSession(page)
		const point = (x: number) => [{ x: box.x + box.width * x, y, id: 1 }]
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: point(fromX),
		})
		for (let i = 1; i <= steps; i++) {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: point(fromX + ((toX - fromX) * i) / steps),
			})
			await page.waitForTimeout(ms / steps)
		}
		if (holdMs) await page.waitForTimeout(holdMs)
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchEnd',
			touchPoints: [],
		})
		await cdp.detach()
	}

	/** Where the row's sliding layer rests (px), once any settle has run. */
	async function restingX(row: Locator) {
		return row.evaluate(async (element) => {
			const layer = element.querySelector<HTMLElement>('.touch-pan-y')!
			await Promise.all(layer.getAnimations().map((a) => a.finished))
			return new DOMMatrix(getComputedStyle(layer).transform).m41
		})
	}

	const row = (page: Page, name: string) =>
		page.getByRole('group', { name: `${name} shopping item` })

	async function seed(user: { id: string; householdId: string }) {
		await prisma.shoppingList.create({
			data: {
				userId: user.id,
				householdId: user.householdId,
				items: {
					create: ['eggs', 'lemons', 'oat milk'].map((name) => ({ name })),
				},
			},
		})
	}

	test('swiping a Shopping row left reveals Later and Delete; Delete removes it at once, with Undo', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user)
		await openShopping(page)

		const eggs = row(page, 'eggs')
		const deleteButton = eggs.getByRole('button', { name: 'Delete' })
		await expect(deleteButton).toBeHidden()

		await swipe(page, eggs, { fromX: 0.8, toX: 0.2, ms: 240 })
		await expect(deleteButton).toBeVisible()
		await expect(eggs.getByRole('button', { name: 'Later' })).toBeVisible()
		// The row sits clear of both actions.
		await expect.poll(() => restingX(eggs)).toBe(-152)
		// The drag did not also check the item off.
		await expect(
			eggs.getByRole('button', { name: 'Check off eggs' }),
		).toBeVisible()

		// Opening another row shuts this one.
		const lemons = row(page, 'lemons')
		await swipe(page, lemons, { fromX: 0.8, toX: 0.2, ms: 240 })
		await expect(lemons.getByRole('button', { name: 'Delete' })).toBeVisible()
		await expect(deleteButton).toBeHidden()

		// Delete goes at once and offers Undo; it is saved once the toast goes.
		await lemons.getByRole('button', { name: 'Delete' }).click()
		await expect(lemons).toBeHidden()
		await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
		await expect
			.poll(
				() =>
					prisma.shoppingListItem.findMany({
						where: { list: { householdId: user.householdId } },
						select: { name: true, checked: true },
						orderBy: { name: 'asc' },
					}),
				{ timeout: 10_000 },
			)
			.toEqual([
				{ name: 'eggs', checked: false },
				{ name: 'oat milk', checked: false },
			])
	})

	test('a short, slow swipe snaps back, and a tap on an open row only shuts it', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user)
		await openShopping(page)

		const oatMilk = row(page, 'oat milk')
		await swipe(page, oatMilk, { fromX: 0.8, toX: 0.7, ms: 600 })
		await expect(oatMilk.getByRole('button', { name: 'Delete' })).toBeHidden()
		await expect.poll(() => restingX(oatMilk)).toBe(0)
		// A quick short drag held still before lifting is not a flick.
		await swipe(page, oatMilk, {
			fromX: 0.8,
			toX: 0.63,
			ms: 0,
			steps: 3,
			holdMs: 400,
		})
		await expect(oatMilk.getByRole('button', { name: 'Delete' })).toBeHidden()
		await expect.poll(() => restingX(oatMilk)).toBe(0)

		await swipe(page, oatMilk, { fromX: 0.8, toX: 0.2, ms: 240 })
		await expect(oatMilk.getByRole('button', { name: 'Delete' })).toBeVisible()
		await oatMilk.getByText('oat milk', { exact: true }).click()
		await expect(oatMilk.getByRole('button', { name: 'Delete' })).toBeHidden()
		await expect(
			oatMilk.getByRole('button', { name: 'Check off oat milk' }),
		).toBeVisible()
		expect(
			await prisma.shoppingListItem.findFirst({
				where: { name: 'oat milk', list: { householdId: user.householdId } },
				select: { checked: true },
			}),
		).toEqual({ checked: false })
	})

	test('a swipe that starts on the row menu button leaves the menu shut', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seed(user)
		await openShopping(page)

		const eggs = row(page, 'eggs')
		await swipe(page, eggs, { fromX: 0.96, toX: 0.4, ms: 240 })
		await expect(eggs.getByRole('button', { name: 'Delete' })).toBeVisible()
		await expect(page.getByRole('menu')).toBeHidden()

		// A tap on the button still opens the menu.
		await eggs.getByText('eggs', { exact: true }).click()
		await expect(eggs.getByRole('button', { name: 'Delete' })).toBeHidden()
		await eggs.getByRole('button', { name: 'Item actions' }).tap()
		await expect(
			page.getByRole('menuitem', { name: 'Edit', exact: true }),
		).toBeVisible()
	})
})

test.describe('tapping a row on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

	const ITEMS = [
		'canned tomatoes',
		'coriander',
		'eggs',
		'lemons',
		'oat milk',
		'ricotta',
		'salmon fillets',
		'spaghetti',
		'washing-up liquid',
		'yogurt',
	]

	async function seedList(user: { id: string; householdId: string }) {
		await prisma.shoppingList.create({
			data: {
				userId: user.id,
				householdId: user.householdId,
				items: {
					create: [
						...ITEMS.map((name) => ({ name })),
						{ name: 'bread', checked: true },
					],
				},
			},
		})
	}

	const row = (page: Page, name: string) =>
		page.getByRole('group', { name: `${name} shopping item` })

	test('a tap near the edge of a Shopping row checks the item off', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedList(user)
		await openShopping(page)

		const oatMilk = row(page, 'oat milk')
		const box = await oatMilk.boundingBox()
		expect(box).not.toBeNull()
		// A one-line row keeps room around its name, not just a thumb's height.
		expect(box!.height).toBeGreaterThanOrEqual(60)
		// Two pixels inside the row's top edge, over the name rather than the box.
		await page.mouse.click(box!.x + box!.width / 2, box!.y + 2)

		await expect(
			oatMilk.getByRole('button', { name: 'Uncheck oat milk' }),
		).toBeVisible()
		await expect
			.poll(async () =>
				prisma.shoppingListItem.findFirst({
					where: { name: 'oat milk', list: { householdId: user.householdId } },
					select: { checked: true },
				}),
			)
			.toEqual({ checked: true })
	})

	test('a row menu near the bottom opens clear of the add button and tab bar', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedList(user)
		await openShopping(page)

		// The row whose menu would open across the add button: the last row that
		// starts above the button's top edge.
		const addButton = page.getByRole('button', { name: 'Add item' })
		const fab = (await addButton.boundingBox())!
		let target = ''
		for (const name of ITEMS) {
			const box = await row(page, name).boundingBox()
			if (box && box.y + box.height <= fab.y) target = name
		}
		expect(target).not.toBe('')

		await row(page, target)
			.getByRole('button', { name: 'Item actions' })
			.click()
		const deleteItem = page.getByRole('menuitem', { name: /^Delete/ })
		await expect(deleteItem).toBeVisible()
		// The whole menu sits above both, so nothing covers any of its items.
		// Measured once it has finished growing in.
		await page
			.getByRole('menu')
			.evaluate((element) =>
				Promise.all(element.getAnimations().map((a) => a.finished)),
			)
		const menu = (await page.getByRole('menu').boundingBox())!
		const tabBar = (await page.locator('[data-bottom-nav]').boundingBox())!
		expect(menu.y + menu.height).toBeLessThanOrEqual(fab.y)
		expect(menu.y + menu.height).toBeLessThanOrEqual(tabBar.y)
		// And its items are thumb-sized on a touch screen.
		expect((await deleteItem.boundingBox())!.height).toBeGreaterThanOrEqual(44)
		await expect(deleteItem).toHaveText('Delete')

		await deleteItem.click()
		await expect(row(page, target)).toBeHidden()
		// Saved once its Undo toast has gone.
		await expect
			.poll(
				() =>
					prisma.shoppingListItem.count({
						where: { name: target, list: { householdId: user.householdId } },
					}),
				{ timeout: 10_000 },
			)
			.toBe(0)
	})

	test('Shopping row and add-sheet controls are thumb-sized', async ({
		page,
		login,
	}) => {
		const user = await login()
		await seedList(user)
		await openShopping(page)

		await expectThumbSized(
			row(page, 'eggs').getByRole('button', { name: 'Item actions' }),
		)
		await expectThumbSized(
			page.getByRole('button', { name: 'Clear checked items from Next shop' }),
		)

		await page.getByRole('button', { name: 'Add item' }).click()
		const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })
		const qtyToggle = sheet.getByRole('button', { name: '+ Qty & unit' })
		await expectThumbSized(qtyToggle)
		await qtyToggle.click()
		await expectThumbSized(sheet.getByRole('button', { name: 'Hide' }))
	})
})

test.describe('controls on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

	async function createRecipe(user: { id: string; householdId: string }) {
		return prisma.recipe.create({
			data: {
				title: 'Miso Soup',
				userId: user.id,
				householdId: user.householdId,
				ingredients: {
					create: { name: 'miso', amount: '2', unit: 'tbsp', order: 0 },
				},
				instructions: { create: { content: 'Whisk.', order: 0 } },
			},
		})
	}

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

	test('Shopping From Staples, From Plan and the item editor Save are thumb-sized', async ({
		page,
		login,
	}) => {
		const user = await login()
		// From Plan shows once something is planned.
		const recipe = await createRecipe(user)
		const today = browserToday()
		await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart: getWeekStart(today),
				meals: {
					create: {
						date: today,
						order: 0,
						recipeItems: {
							create: {
								recipeId: recipe.id,
								recipeTitle: recipe.title,
								order: 0,
							},
						},
					},
				},
			},
		})
		await prisma.shoppingList.create({
			data: {
				userId: user.id,
				householdId: user.householdId,
				items: { create: { name: 'Foil' } },
			},
		})

		await openShopping(page)
		await expectThumbTall(page.getByRole('button', { name: /^From Staples/ }))
		await expectThumbTall(page.getByRole('button', { name: /^From Plan/ }))

		const foil = page.getByRole('group', { name: 'Foil shopping item' })
		await foil.getByRole('button', { name: 'Item actions' }).tap()
		await page.getByRole('menuitem', { name: 'Edit', exact: true }).tap()
		await expectThumbTall(
			page
				.getByRole('dialog', { name: 'Edit item' })
				.getByRole('button', { name: 'Save' }),
		)
	})

	test('From Plan turns the week with thumb-sized chevrons', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		const today = browserToday()
		const thisWeek = getWeekStart(today)
		const nextWeek = new Date(thisWeek.getTime() + 7 * 24 * 60 * 60 * 1000)
		for (const weekStart of [thisWeek, nextWeek]) {
			await prisma.mealPlan.create({
				data: {
					householdId: user.householdId,
					weekStart,
					meals: {
						create: {
							date: weekStart,
							order: 0,
							recipeItems: {
								create: {
									recipeId: recipe.id,
									recipeTitle: recipe.title,
									order: 0,
								},
							},
						},
					},
				},
			})
		}

		await openShopping(page)
		const next = page.getByRole('button', { name: 'Next week' })
		await tapUntil(page.getByRole('button', { name: /^From Plan/ }), () =>
			expect(next).toBeVisible({ timeout: 2000 }),
		)
		const previous = page.getByRole('button', { name: 'Previous week' })
		// Measure once the sheet has finished sliding in: mid-slide its transform
		// leaves the chevrons a fraction of a pixel short of 44.
		const sheet = page.getByRole('dialog', { name: 'Add from the Plan' })
		await sheet.evaluate((element) =>
			Promise.all(element.getAnimations().map((a) => a.finished)),
		)
		for (const [control, icon] of [
			[previous, /#chevron-left$/],
			[next, /#chevron-right$/],
		] as const) {
			await expectThumbSized(control)
			await expect(control.locator('use')).toHaveAttribute('href', icon)
		}
		await expect(previous).toBeDisabled()
		// The sheet's primary action spans it, inside its 20px side padding.
		const add = sheet.getByRole('button', { name: /^Add / })
		await expect(add).toBeVisible()
		const sheetBox = (await sheet.boundingBox())!
		expect((await add.boundingBox())!.width).toBeCloseTo(sheetBox.width - 40, 0)
		await next.tap()
		await expect(next).toBeDisabled()
		await expect(previous).toBeEnabled()
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
			milk
				.getByRole('button', { name: 'Check off Milk' })
				.locator('div')
				.first(),
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
})
