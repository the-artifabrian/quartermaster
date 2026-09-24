import { readFile } from 'node:fs/promises'
import { getWeekStart } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

// "Salsa verde" trips none of the name heuristics (the parser's "For the …",
// trailing colon, all caps; Shopping's exact list of words like "Garnish"), so
// only the restored flag keeps it a heading.
test('a Recipe restored from its export keeps its heading out of checks and Shopping', async ({
	page,
	login,
}) => {
	test.setTimeout(30_000)
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Recovery household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	// Adding to Shopping, from the Recipe or the Plan, needs Pro.
	await prisma.subscription.create({
		data: {
			userId: user.id,
			tier: 'pro',
			trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		},
	})
	const original = await prisma.recipe.create({
		data: {
			title: 'Roast chicken',
			userId: user.id,
			householdId: household.id,
			ingredients: {
				create: [
					{ name: 'Salsa verde', isHeading: true, order: 0 },
					{ name: 'parsley', amount: '1', unit: 'bunch', order: 1 },
					{ name: 'capers', amount: '2', unit: 'tbsp', order: 2 },
				],
			},
			instructions: { create: { content: 'Roast and dress.', order: 0 } },
		},
	})

	await page.goto('/settings/profile')
	const downloading = page.waitForEvent('download')
	await page.getByRole('link', { name: 'Export Recipes' }).click()
	const download = await downloading
	const exportFile = await readFile(await download.path())

	// The Recipe is lost, then restored from that file.
	await prisma.recipe.delete({ where: { id: original.id } })
	await page.goto('/settings/profile/import')
	await page.getByLabel('Select export file').setInputFiles({
		name: download.suggestedFilename(),
		mimeType: 'application/json',
		buffer: exportFile,
	})
	await page.getByRole('button', { name: 'Import', exact: true }).click()
	await expect(page.getByRole('link', { name: 'View recipes' })).toBeVisible()

	const restored = await prisma.recipe.findFirstOrThrow({
		where: { householdId: household.id, title: 'Roast chicken' },
		select: {
			id: true,
			ingredients: {
				select: { name: true, isHeading: true },
				orderBy: { order: 'asc' },
			},
		},
	})
	expect(restored.ingredients).toEqual([
		{ name: 'Salsa verde', isHeading: true },
		{ name: 'parsley', isHeading: false },
		{ name: 'capers', isHeading: false },
	])

	// Detail shows it as a section heading: no check, no add-to-Shopping.
	await page.goto(`/recipes/${restored.id}`)
	await expect(page.getByText('Salsa verde', { exact: true })).toBeVisible()
	await expect(page.getByRole('checkbox', { name: 'Salsa verde' })).toHaveCount(
		0,
	)
	await expect(page.getByRole('checkbox', { name: 'parsley' })).toBeVisible()
	await expect(page.getByRole('checkbox', { name: 'capers' })).toBeVisible()
	await expect(
		page.getByRole('button', { name: 'Add to shopping list' }),
	).toHaveCount(2)

	// The picker folds Meals from before today, so plan this one for today.
	const now = new Date()
	const today = new Date(
		Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
	)
	await prisma.mealPlan.create({
		data: {
			householdId: household.id,
			weekStart: getWeekStart(today),
			meals: {
				create: {
					date: today,
					order: 0,
					label: 'dinner',
					recipeItems: {
						create: {
							order: 0,
							recipeId: restored.id,
							recipeTitle: 'Roast chicken',
							scaleMultiplier: 1,
						},
					},
				},
			},
		},
	})

	await page.goto('/shopping')
	await page.getByRole('button', { name: /from plan/i }).click()
	await expect(page.getByRole('button', { name: /^parsley/ })).toBeVisible()
	await expect(page.getByRole('button', { name: /^capers/ })).toBeVisible()
	await expect(page.getByRole('button', { name: /salsa verde/i })).toHaveCount(
		0,
	)
	await page.getByRole('button', { name: 'Add 2 from 1 Meal' }).click()
	await expect(page.getByText('capers', { exact: true })).toBeVisible()

	const shoppingNames = await prisma.shoppingListItem.findMany({
		where: { list: { householdId: household.id } },
		select: { name: true },
		orderBy: { name: 'asc' },
	})
	expect(shoppingNames).toEqual([{ name: 'capers' }, { name: 'parsley' }])
})
