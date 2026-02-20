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
	await page.getByRole('spinbutton', { name: /servings/i }).fill('4')

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

	// Create a couple recipes via DB for speed
	await prisma.recipe.create({
		data: {
			title: 'Spicy Thai Curry',
			userId: user.id,
			servings: 4,
			prepTime: 10,
			cookTime: 25,
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
			servings: 2,
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

	// Clear search
	await page.getByPlaceholder(/search/i).fill('')
	await page.waitForTimeout(500)
	await expect(page.getByText('Simple Green Salad')).toBeVisible()
})
