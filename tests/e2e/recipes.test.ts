import { type Locator } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('Recipe CRUD flow: create → list → detail → edit → delete', async ({
	page,
	login,
}) => {
	await login()

	// 1. Create recipe
	await page.goto('/recipes/new')
	await expect(page).toHaveURL(/\/recipes\/new/)

	// Fill basic details
	await page.getByRole('textbox', { name: /title/i }).fill('E2E Test Pasta')
	await page
		.getByRole('textbox', { name: /description/i })
		.fill('A simple test recipe')
	await expect(
		page.getByRole('spinbutton', { name: /^servings$/i }),
	).toHaveCount(0)
	await page
		.getByRole('spinbutton', { name: /amount this recipe makes/i })
		.fill('4')
	await page
		.getByRole('combobox', { name: /what this recipe makes/i })
		.fill('servings')

	// Fill ingredient (first row)
	await page.getByPlaceholder('Ingredient name').fill('spaghetti')
	await page.getByPlaceholder('Amt').fill('1')
	await page.getByPlaceholder('Unit').fill('lb')

	// Fill instruction (first row)
	await page.getByPlaceholder('Step 1').fill('Boil water and cook pasta')

	// Submit
	await page.getByRole('button', { name: /create recipe/i }).click()

	// 2. Verify redirected to recipe detail
	await expect(page).toHaveURL(/\/recipes\/[a-z0-9]+$/)
	await expect(
		page.getByRole('heading', { name: 'E2E Test Pasta' }),
	).toBeVisible()
	// Use .first() to avoid strict mode issues with dev-mode JSON viewer duplicates
	await expect(page.getByText('A simple test recipe').first()).toBeVisible()
	await expect(page.getByText('spaghetti').first()).toBeVisible()
	await expect(
		page.getByText('Boil water and cook pasta').first(),
	).toBeVisible()

	// 3. Verify in recipe list
	await page.goto('/recipes')
	await expect(page.getByText('E2E Test Pasta')).toBeVisible()

	// 4. Edit recipe - click on recipe card (it's a link)
	await page.getByText('E2E Test Pasta').click()
	await expect(page).toHaveURL(/\/recipes\/[a-z0-9]+$/)
	await page.getByRole('link', { name: /edit/i }).click()
	await expect(page).toHaveURL(/\/recipes\/[a-z0-9]+\/edit/)

	await page.getByRole('textbox', { name: /title/i }).fill('E2E Updated Pasta')
	await page.getByRole('button', { name: /save changes/i }).click()

	// Verify update
	await expect(page).toHaveURL(/\/recipes\/[a-z0-9]+$/)
	await expect(
		page.getByRole('heading', { name: 'E2E Updated Pasta' }),
	).toBeVisible()

	// 5. Delete recipe
	await page.getByRole('link', { name: /edit/i }).click()
	await page.getByRole('button', { name: /delete recipe/i }).click()
	// Double-check confirmation
	await page.getByRole('button', { name: /are you sure/i }).click()

	// Should redirect to recipes list
	await expect(page).toHaveURL(/\/recipes/)
	await expect(page.getByText('E2E Updated Pasta')).not.toBeVisible()
})

test('Recipe search and filter', async ({ page, login }) => {
	const user = await login()

	// Recipes are household-scoped, so DB-seeded recipes need a household
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})

	// Create a couple recipes via DB for speed
	await prisma.recipe.create({
		data: {
			title: 'Spicy Thai Curry',
			userId: user.id,
			householdId: household.id,
			activeTime: 10,
			totalTime: 35,
			yieldAmount: 4,
			yieldLabel: 'servings',
			ingredients: {
				create: [{ name: 'curry paste', amount: '2', unit: 'tbsp', order: 0 }],
			},
			instructions: {
				create: [{ content: 'Cook curry', order: 0 }],
			},
		},
	})
	await prisma.recipe.create({
		data: {
			title: 'Simple Green Salad',
			userId: user.id,
			householdId: household.id,
			ingredients: {
				create: [{ name: 'lettuce', amount: '1', unit: 'head', order: 0 }],
			},
			instructions: {
				create: [{ content: 'Toss salad', order: 0 }],
			},
		},
	})

	await page.goto('/recipes')
	await expect(page.getByText('Spicy Thai Curry')).toBeVisible()
	await expect(page.getByText('Simple Green Salad')).toBeVisible()

	// Search
	await page.getByPlaceholder(/search/i).fill('curry')
	// Wait for search to update (URL param based)
	await page.waitForTimeout(500)
	await expect(page.getByText('Spicy Thai Curry')).toBeVisible()
	await expect(page.getByText('Simple Green Salad')).not.toBeVisible()

	// Multi-word search where the words aren't adjacent in the title
	await page.getByPlaceholder(/search/i).fill('spicy curry')
	await page.waitForTimeout(500)
	await expect(page.getByText('Spicy Thai Curry')).toBeVisible()
	await expect(page.getByText('Simple Green Salad')).not.toBeVisible()

	// Clear search
	await page.getByPlaceholder(/search/i).fill('')
	await page.waitForTimeout(500)
	await expect(page.getByText('Simple Green Salad')).toBeVisible()
})

test('custom Recipe yield labels fit phone and desktop detail layouts', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Metadata layout household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const yieldLabel =
		'extraordinaryceremonialbraidedloaveswithacustomhouseholdname'
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Metadata layout loaf',
			activeTime: 25,
			totalTime: 180,
			yieldAmount: 2.5,
			yieldLabel,
			userId: user.id,
			householdId: household.id,
			ingredients: { create: { name: 'flour', order: 0 } },
			instructions: { create: { content: 'Knead.', order: 0 } },
		},
	})

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 768, height: 900 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		await page.goto(`/recipes/${recipe.id}`)
		const yieldText = page.getByText(`Makes 2.5 ${yieldLabel}`)
		await expect(yieldText).toBeVisible()
		const box = await yieldText.boundingBox()
		expect(box).not.toBeNull()
		expect(box!.x).toBeGreaterThanOrEqual(0)
		expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
	}
})

test('manual Recipe scaling stays multiplier-first and shows known yield as context', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Manual scale household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const known = await prisma.recipe.create({
		data: {
			title: 'Twelve parcels',
			yieldAmount: 12,
			yieldLabel: 'pieces',
			userId: user.id,
			householdId: household.id,
		},
	})
	const unknown = await prisma.recipe.create({
		data: {
			title: 'Unknown family batch',
			yieldAmount: null,
			yieldLabel: null,
			userId: user.id,
			householdId: household.id,
		},
	})
	async function openScaleEditor(trigger: Locator) {
		const multiplier = page.getByLabel('Scale multiplier')
		await expect(async () => {
			if (!(await multiplier.isVisible())) await trigger.click()
			await expect(multiplier).toBeVisible({ timeout: 2000 })
		}).toPass({ timeout: 10_000 })
		return multiplier
	}

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 768, height: 900 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)

		await page.goto(`/recipes/${known.id}`)
		const scaleTrigger = page.getByRole('button', { name: 'Scale 1×' })
		await expect(scaleTrigger).toBeVisible()
		await expect(page.getByLabel('Scale multiplier')).toHaveCount(0)
		await expect(page.getByText('Makes 12 pieces')).toBeVisible()
		await expect(page.getByLabel(/Target pieces/)).toHaveCount(0)
		await expect(page.getByText(/You have \d+\/\d+ ingredients/)).toHaveCount(0)
		await expect(page.getByRole('button', { name: 'Metric' })).toBeVisible()
		const controlBox = await scaleTrigger.boundingBox()
		expect(controlBox).not.toBeNull()
		expect(controlBox!.x).toBeGreaterThanOrEqual(0)
		expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(
			viewport.width,
		)

		const multiplier = await openScaleEditor(scaleTrigger)
		await expect(multiplier).toHaveValue('1')
		await multiplier.fill('1.5')
		await multiplier.press('Enter')
		await expect(page).toHaveURL(
			new RegExp(`/recipes/${known.id}\\?scale=1.5$`),
		)
		await expect(page.getByText('Makes 18 pieces')).toBeVisible()
		await expect(page.getByText('original: 12')).toBeVisible()
		await page.getByRole('button', { name: 'Original 1×' }).click()
		await expect(page.getByRole('button', { name: 'Scale 1×' })).toBeVisible()
		await expect(page.getByText('original: 12')).toHaveCount(0)

		await page.goto(`/recipes/${unknown.id}`)
		const unknownTrigger = page.getByRole('button', { name: 'Scale 1×' })
		await expect(unknownTrigger).toBeVisible()
		const unknownMultiplier = await openScaleEditor(unknownTrigger)
		await expect(unknownMultiplier).toHaveValue('1')
		await expect(page.getByLabel('Target servings')).toHaveCount(0)
		const multiplierBox = await unknownMultiplier.boundingBox()
		expect(multiplierBox).not.toBeNull()
		expect(multiplierBox!.x + multiplierBox!.width).toBeLessThanOrEqual(
			viewport.width,
		)
	}

	await page.goto(`/recipes/${unknown.id}?servings=12`)
	await expect(page.getByRole('button', { name: 'Scale 1×' })).toBeVisible()
	const legacyMultiplier = await openScaleEditor(
		page.getByRole('button', { name: 'Scale 1×' }),
	)
	await expect(legacyMultiplier).toHaveValue('1')

	await legacyMultiplier.fill('1.5')
	await legacyMultiplier.press('Enter')
	await expect(page).toHaveURL(
		new RegExp(`/recipes/${unknown.id}\\?scale=1.5$`),
	)
})

test('phone Recipes restore Ingredients after its heading passes', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Mid-cook household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Long mid-cook Recipe',
			userId: user.id,
			householdId: household.id,
			ingredients: {
				create: Array.from({ length: 12 }, (_, index) => ({
					name: `ingredient ${index + 1}`,
					amount: String(index + 1),
					unit: 'g',
					order: index,
				})),
			},
			instructions: {
				create: Array.from({ length: 12 }, (_, index) => ({
					content: `Complete cooking step ${index + 1}.`,
					order: index,
				})),
			},
		},
	})

	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`/recipes/${recipe.id}`)
	const floatingIngredients = page.getByRole('button', {
		name: 'Ingredients · 0/12',
	})
	await expect(floatingIngredients).toHaveCount(0)

	await page
		.getByRole('heading', { name: 'Instructions' })
		.scrollIntoViewIfNeeded()
	await expect(floatingIngredients).toBeVisible()
	await floatingIngredients.click()
	await expect(page.getByRole('dialog', { name: 'Ingredients' })).toBeVisible()
})
