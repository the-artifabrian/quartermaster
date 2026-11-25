import { type Locator } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { SHELL_UA } from '#tests/native-shell.ts'
import {
	expect,
	expectThumbSized,
	expectThumbTall,
	hydrated,
	test,
} from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

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

	await page.getByRole('button', { name: 'Save', exact: true }).click()
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
	// Hydrated first, so nothing moves the page after the scroll below.
	await hydrated(handle)
	// Mid-screen, clear of the header and the tab bar.
	await handle.evaluate((element) =>
		element.scrollIntoView({ block: 'center' }),
	)
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
	await expectThumbSized(page.getByRole('combobox', { name: 'Sort Recipes' }))
	await expectThumbSized(
		page.getByRole('button', { name: 'Show favorites only' }),
	)

	await page.goto('/settings/profile')
	await expectThumbSized(
		page.getByRole('button', { name: /System|Light|Dark/ }),
	)
})

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

test('recipe form buttons, remove and classification chips are thumb-sized', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createRecipe(user)

	await page.goto(`/recipes/${recipe.id}/edit`)
	await expectThumbTall(
		page.getByRole('button', { name: 'Heading', exact: true }),
	)
	await expectThumbTall(
		page.getByRole('button', { name: 'Ingredient', exact: true }),
	)
	await expectThumbTall(page.getByRole('button', { name: 'Add step' }))
	await expectThumbSized(
		page.getByRole('button', { name: 'Remove ingredient' }).first(),
	)

	await page.getByText('Classification', { exact: true }).click()
	await expectThumbTall(
		page
			.getByRole('group', { name: 'Season' })
			.getByRole('button', { name: 'Year-round' }),
	)
	await expectThumbTall(
		page
			.getByRole('group', { name: 'Course' })
			.getByRole('button', { name: 'Breakfast' }),
	)
	await expectThumbTall(page.getByRole('button', { name: 'Add cuisine' }))
})

test.describe('in the iOS app', () => {
	test.use({ userAgent: SHELL_UA })

	test('a Recipe’s ingredient summary row and Link Recipe take 44px taps', async ({
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

		const linkRecipe = page.getByRole('button', { name: 'Link Recipe' })
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
})
