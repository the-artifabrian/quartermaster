import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

const original = `Chickpea lunch
Ingredients
2 cans chickpeas, drained and rinsed thoroughly under cold running water (reserve the liquid for another recipe; if using dried chickpeas instead, soak them overnight and simmer until completely tender before measuring the equivalent cooked weight)
1 lemon
Instructions
Toss the chickpeas with lemon juice and serve.`

const savedRecipeUrl = /\/recipes\/(?!import)[a-z0-9]+\?imported=text$/

test('pasted text saves at once and opens with a notice; Undo deletes it and returns to Import', async ({
	page,
	login,
}) => {
	const user = await login()
	const older = await prisma.recipe.create({
		data: {
			title: 'Chickpea lunch',
			userId: user.id,
			householdId: user.householdId,
		},
		select: { id: true },
	})
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/recipes')
	await page.goto('/recipes/import')
	await page.getByRole('button', { name: 'From Text', exact: true }).click()
	await page.getByLabel('Recipe text', { exact: true }).fill(original)
	await page.getByRole('button', { name: 'Parse Recipe', exact: true }).click()

	await expect(page).toHaveURL(savedRecipeUrl)
	await expect(
		page.getByRole('heading', { name: 'Chickpea lunch', level: 1 }),
	).toBeVisible()
	const notice = page.getByRole('region', { name: 'Saved to your Recipes' })
	await expect(notice).toContainText('From your text')
	await expect(notice).not.toContainText('couldn’t find')
	await expect(notice.getByRole('link', { name: 'Open it' })).toHaveAttribute(
		'href',
		`/recipes/${older.id}`,
	)
	const recipes = await prisma.recipe.findMany({
		where: { userId: user.id, id: { not: older.id } },
		include: { ingredients: { orderBy: { order: 'asc' } }, instructions: true },
	})
	expect(recipes).toHaveLength(1)
	expect(recipes[0]).toMatchObject({
		rawText: original,
		ingredients: [
			expect.objectContaining({ amount: '2', unit: 'cans', name: 'chickpeas' }),
			expect.objectContaining({ amount: '1', name: 'lemon' }),
		],
		instructions: [
			expect.objectContaining({
				content: 'Toss the chickpeas with lemon juice and serve.',
			}),
		],
	})

	// The import replaced its own history entry: Back skips the form.
	await page.goBack()
	await expect(page).toHaveURL(/\/recipes$/)
	await page.goForward()
	await expect(page).toHaveURL(savedRecipeUrl)

	await notice.getByRole('button', { name: 'Undo', exact: true }).click()
	await notice.getByRole('button', { name: 'Delete?', exact: true }).click()
	await expect(page).toHaveURL(/\/recipes\/import$/)
	await expect(page.getByText('Removed Chickpea lunch')).toBeVisible()
	expect(
		await prisma.recipe.findMany({
			where: { userId: user.id },
			select: { id: true },
		}),
	).toEqual([{ id: older.id }])
})

test('an import missing its steps saves, says so, and Edit adds them; the notice can be dismissed', async ({
	page,
	login,
}) => {
	const user = await login()
	await page.goto('/recipes/import')
	await page.getByRole('button', { name: 'From Text', exact: true }).click()
	await page
		.getByLabel('Recipe text', { exact: true })
		.fill('Lemon\nIngredients\n1 lemon')
	await page.getByRole('button', { name: 'Parse Recipe', exact: true }).click()

	await expect(page).toHaveURL(savedRecipeUrl)
	const notice = page.getByRole('region', { name: 'Saved to your Recipes' })
	await expect(notice).toContainText(
		'We couldn’t find the instructions. Add them with Edit.',
	)
	await notice.getByRole('link', { name: 'Edit', exact: true }).click()
	await expect(page).toHaveURL(/\/recipes\/[a-z0-9]+\/edit$/)
	await page.getByPlaceholder('Step 1').fill('Squeeze the lemon.')
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
	await expect(page).toHaveURL(/\/recipes\/(?!import)[a-z0-9]+$/)
	await expect(notice).toHaveCount(0)
	await expect(page.getByText('Squeeze the lemon.')).toBeVisible()
	expect(
		await prisma.recipe.findFirst({
			where: { userId: user.id },
			include: { instructions: true },
		}),
	).toMatchObject({
		title: 'Lemon',
		instructions: [expect.objectContaining({ content: 'Squeeze the lemon.' })],
	})

	await page.goto('/recipes/import')
	await page.getByRole('button', { name: 'From Text', exact: true }).click()
	await page
		.getByLabel('Recipe text', { exact: true })
		.fill('Toast\nIngredients\n1 slice bread\nInstructions\nToast it.')
	await page.getByRole('button', { name: 'Parse Recipe', exact: true }).click()
	await expect(page).toHaveURL(savedRecipeUrl)
	await notice.getByRole('button', { name: 'Dismiss' }).click()
	await expect(notice).toHaveCount(0)
	await expect(page).toHaveURL(/\/recipes\/(?!import)[a-z0-9]+$/)
	await page.reload()
	await expect(
		page.getByRole('heading', { name: 'Toast', level: 1 }),
	).toBeVisible()
	await expect(notice).toHaveCount(0)
})

test('text with neither ingredients nor steps saves nothing and keeps what was pasted', async ({
	page,
	login,
}) => {
	const user = await login()
	await page.goto('/recipes/import')
	await page.getByRole('button', { name: 'From Text', exact: true }).click()
	const text = 'Family notes\nServe with whatever greens are left.'
	await page.getByLabel('Recipe text', { exact: true }).fill(text)
	await page.getByRole('button', { name: 'Parse Recipe', exact: true }).click()
	await expect(page.getByText(/Could not find a recipe/)).toBeVisible()
	await expect(page.getByLabel('Recipe text', { exact: true })).toHaveValue(
		text,
	)
	expect(await prisma.recipe.count({ where: { userId: user.id } })).toBe(0)
})
