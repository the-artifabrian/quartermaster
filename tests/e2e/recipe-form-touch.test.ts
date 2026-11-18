import { type Locator } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function expectThumbSized(control: Locator) {
	await expect(control).toBeVisible()
	const box = await control.boundingBox()
	expect(box).not.toBeNull()
	expect(box!.width).toBeGreaterThanOrEqual(44)
	expect(box!.height).toBeGreaterThanOrEqual(44)
}

test('recipe steps reorder from the keyboard through a named, thumb-sized handle', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Pancakes',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: { name: 'flour', amount: '200', unit: 'g', order: 0 },
			},
			instructions: {
				create: [
					{ content: 'Whisk the batter.', order: 0 },
					{ content: 'Heat the pan.', order: 1 },
				],
			},
		},
	})

	await page.goto(`/recipes/${recipe.id}/edit`)
	const handle = page.getByRole('button', { name: 'Reorder step 2' })
	await expectThumbSized(handle)
	await expectThumbSized(
		page.getByRole('button', { name: 'Reorder ingredient 1' }),
	)

	// Tab reaches the handle: from the step before's text, it is next.
	await page.getByRole('textbox', { name: 'Step 1' }).focus()
	await page.keyboard.press('Tab')
	await page.keyboard.press('Tab')
	await expect(handle).toBeFocused()

	// The handle only answers keys once the page has hydrated.
	const liveRegion = page.locator('[aria-live]')
	await expect(async () => {
		await handle.focus()
		await page.keyboard.press('Space')
		await expect(
			// Picked up, and over its own place.
			liveRegion.filter({ hasText: 'Step 2 is at position 2 of 2.' }),
		).toHaveCount(1, { timeout: 500 })
	}).toPass()
	// dnd-kit measures the other steps just after the pickup, and an arrow
	// before then has nowhere to go: press until the step has moved.
	await expect(async () => {
		await page.keyboard.press('ArrowUp')
		await expect(
			liveRegion.filter({ hasText: 'Step 2 is at position 1 of 2.' }),
		).toHaveCount(1, { timeout: 500 })
	}).toPass()
	await page.keyboard.press('Space')
	await expect(page.getByRole('textbox', { name: 'Step 1' })).toHaveValue(
		'Heat the pan.',
	)

	await page.getByRole('button', { name: 'Save Changes' }).click()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	const steps = await prisma.instruction.findMany({
		where: { recipeId: recipe.id },
		orderBy: { order: 'asc' },
		select: { content: true },
	})
	expect(steps.map((step) => step.content)).toEqual([
		'Heat the pan.',
		'Whisk the batter.',
	])
})

test('a new ingredient’s fields keep their names once typed in', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/recipes/new')
	// By attribute: an accessible name would also come from the placeholder.
	const field = (label: string) => page.locator(`[aria-label="${label}"]`)
	await field('Ingredient 1 name').fill('butter')
	await field('Ingredient 1 amount').fill('50')
	const unit = field('Ingredient 1 unit')
	await unit.fill('g')
	await expect(unit).toHaveValue('g')
	await expect(unit).toHaveAttribute('autocapitalize', 'none')
	await expect(unit).toHaveAttribute('autocorrect', 'off')
	await expect(field('Ingredient 1 notes')).toBeVisible()
	await expect(field('Step 1')).toBeVisible()
	await expect(field('Ingredient 1 name')).toHaveValue('butter')
})

test('a swipe that starts on a drag handle scrolls the form; a hold picks the row up', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Long Stew',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: { name: 'beans', amount: '1', unit: 'can', order: 0 },
			},
			instructions: {
				create: Array.from({ length: 8 }, (_, index) => ({
					content: `Step text ${index + 1}.`,
					order: index,
				})),
			},
		},
	})
	await page.goto(`/recipes/${recipe.id}/edit`)
	const handle = page.getByRole('button', { name: 'Reorder step 2' })
	// Mid-screen, clear of the header and the tab bar.
	await handle.evaluate((element) =>
		element.scrollIntoView({ block: 'center' }),
	)
	await expect
		.poll(() =>
			handle.evaluate((element) =>
				Object.keys(element).some((key) => key.startsWith('__reactProps')),
			),
		)
		.toBe(true)
	const box = (await handle.boundingBox())!
	const x = box.x + box.width / 2
	const y = box.y + box.height / 2
	const cdp = await page.context().newCDPSession(page)
	const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', dy: number) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: type === 'touchEnd' ? [] : [{ x, y: y + dy, id: 1 }],
		})

	const before = await page.evaluate(() => window.scrollY)
	await touch('touchStart', 0)
	for (const dy of [-20, -60, -100, -140, -180]) await touch('touchMove', dy)
	await touch('touchEnd', 0)
	await expect
		.poll(() => page.evaluate(() => window.scrollY))
		.toBeGreaterThan(before)
	await expect(page.getByRole('textbox', { name: 'Step 2' })).toHaveValue(
		'Step text 2.',
	)

	// Held still for a moment, the same handle picks the step up. First let
	// the swipe's coasting scroll stop, so the handle stays where it's aimed.
	await expect
		.poll(async () => {
			const start = await page.evaluate(() => window.scrollY)
			await page.waitForTimeout(100)
			return (await page.evaluate(() => window.scrollY)) - start
		})
		.toBe(0)
	await handle.evaluate((element) =>
		element.scrollIntoView({ block: 'center' }),
	)
	const held = (await handle.boundingBox())!
	const hx = held.x + held.width / 2
	const hy = held.y + held.height / 2
	const at = (dy: number) => [{ x: hx, y: hy + dy, id: 1 }]
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: at(0),
	})
	await page.waitForTimeout(400)
	for (const dy of [-10, -40, -80, -120, -160]) {
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: at(dy),
		})
		await page.waitForTimeout(30)
	}
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	})
	await cdp.detach()
	await expect(page.getByRole('textbox', { name: 'Step 1' })).toHaveValue(
		'Step text 2.',
	)
})

test('Recipes filters and Settings controls are thumb-sized on a phone', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/recipes')
	await page
		.getByRole('button', { name: /filter/i })
		.first()
		.click()
	await expectThumbSized(page.getByRole('combobox', { name: 'Sort recipes' }))
	await expectThumbSized(
		page.getByRole('button', { name: 'Show favorites only' }),
	)

	await page.goto('/settings/profile')
	await expectThumbSized(
		page.getByRole('button', { name: /System|Light|Dark/ }),
	)
})
