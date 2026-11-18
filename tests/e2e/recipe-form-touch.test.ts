import { type Locator } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 } })

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
		page.getByRole('button', { name: 'Reorder ingredient' }),
	)

	// The handle only answers keys once the page has hydrated.
	await expect(async () => {
		await handle.focus()
		await page.keyboard.press('Space')
		await expect(handle).toHaveAttribute('aria-pressed', 'true', {
			timeout: 500,
		})
	}).toPass()
	// dnd-kit measures the other steps just after the pickup, and an arrow
	// before then has nowhere to go. A drop counts once the steps' live region
	// says step 2 is over another step; it can only move up one place.
	const movedOver = page
		.locator('[id^="DndLiveRegion"]')
		// Over another step, not over its own starting place.
		.filter({ hasText: /item (\S+) was moved over droppable area (?!\1\.)/ })
	await expect(async () => {
		await page.keyboard.press('ArrowUp')
		await expect(movedOver).toHaveCount(1, { timeout: 500 })
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
	await page.getByRole('textbox', { name: 'Ingredient name' }).fill('butter')
	await page.getByRole('textbox', { name: 'Amount' }).fill('50')
	const unit = page.getByRole('textbox', { name: 'Unit' })
	await unit.fill('g')
	await expect(unit).toHaveValue('g')
	await expect(page.getByRole('textbox', { name: 'Notes' })).toBeVisible()
	await expect(page.getByRole('textbox', { name: 'Step 1' })).toBeVisible()
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
