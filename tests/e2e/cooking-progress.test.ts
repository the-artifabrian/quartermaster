import { type Locator } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

/** React has hydrated an element once it has attached its props to it. */
async function hydrated(target: Locator) {
	await expect
		.poll(() =>
			target.evaluate((element) =>
				Object.keys(element).some((key) => key.startsWith('__reactProps')),
			),
		)
		.toBe(true)
}

for (const width of [390, 1280]) {
	test(`cooking checks resume, stay with their Recipe, and reset at ${width}px`, async ({
		page,
		login,
	}) => {
		const user = await login()
		const sauce = await prisma.recipe.create({
			data: {
				title: 'Lemon sauce',
				userId: user.id,
				householdId: user.householdId,
				ingredients: { create: { name: 'lemon', amount: '1', order: 0 } },
				instructions: { create: { content: 'Squeeze the lemon.', order: 0 } },
			},
		})
		const pasta = await prisma.recipe.create({
			data: {
				title: 'Walnut pasta',
				userId: user.id,
				householdId: user.householdId,
				ingredients: {
					create: [
						{ name: 'pasta', amount: '200', unit: 'g', order: 0 },
						{ name: 'Lemon sauce', linkedRecipeId: sauce.id, order: 1 },
					],
				},
				instructions: {
					create: {
						content: 'Boil for 10 minutes, then add sauce.',
						order: 0,
					},
				},
			},
			include: { ingredients: true, instructions: true },
		})
		const mealPlan = await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart: new Date('2026-09-07'),
				meals: {
					create: {
						date: new Date('2026-09-07'),
						order: 0,
						recipeItems: {
							create: {
								recipeId: pasta.id,
								recipeTitle: pasta.title,
								order: 0,
								cooked: true,
								scaleMultiplier: 2,
							},
						},
					},
				},
			},
			include: { meals: { include: { recipeItems: true } } },
		})
		const shopping = await prisma.shoppingList.create({
			data: {
				userId: user.id,
				householdId: user.householdId,
				items: {
					create: {
						name: 'pasta',
						quantity: '400',
						unit: 'g',
						checked: true,
					},
				},
			},
			include: { items: true },
		})
		await page.setViewportSize({ width, height: 844 })
		await page.goto(`/recipes/${pasta.id}?scale=2`)
		const ingredient = page.getByRole('checkbox', {
			name: 'pasta',
			exact: true,
		})
		const step = page
			.getByRole('checkbox')
			.filter({ hasText: 'Boil for 10 minutes' })
		const more = page.getByRole('button', { name: 'More actions' })
		const reset = page.getByRole('menuitem', { name: 'Reset cooking checks' })
		await more.click()
		await expect(reset).toHaveCount(0)
		await page.keyboard.press('Escape')
		await ingredient.click()
		await step.press('Space')
		await page.reload()
		await expect(ingredient).toBeChecked()
		await expect(step).toBeChecked()
		await expect(page.getByRole('button', { name: 'Scale 2×' })).toBeVisible()
		await page.getByRole('link', { name: 'Lemon sauce', exact: true }).click()
		await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0)
		await page.getByRole('checkbox', { name: 'lemon', exact: true }).click()
		await page.goBack()
		await expect(ingredient).toBeChecked()
		await expect(step).toBeChecked()
		await more.click()
		await reset.focus()
		await page.keyboard.press('Enter')
		await expect(ingredient).not.toBeChecked()
		await expect(step).not.toBeChecked()
		await expect(more).toBeFocused()
		await page.reload()
		await expect(ingredient).not.toBeChecked()
		await expect(step).not.toBeChecked()
		await more.click()
		await expect(reset).toHaveCount(0)
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('cooking-duration-cue')).toBeVisible()
		await page.getByRole('link', { name: 'Lemon sauce', exact: true }).click()
		await expect(
			page.getByRole('checkbox', { name: 'lemon', exact: true }),
		).toBeChecked()
		// Direct cooking checks/reset must not write Recipe, Plan or Shopping.
		expect(
			await prisma.recipe.findUnique({
				where: { id: pasta.id },
				include: { ingredients: true, instructions: true },
			}),
		).toEqual(pasta)
		expect(
			await prisma.mealPlan.findUnique({
				where: { id: mealPlan.id },
				include: { meals: { include: { recipeItems: true } } },
			}),
		).toEqual(mealPlan)
		expect(
			await prisma.shoppingList.findUnique({
				where: { id: shopping.id },
				include: { items: true },
			}),
		).toEqual(shopping)
	})
}

test('cooking checks isolate accounts and household changes in the same browser', async ({
	page,
	login,
	insertNewUser,
}) => {
	const first = await login()
	const second = await insertNewUser()
	await prisma.householdMember.create({
		data: { householdId: first.householdId, userId: second.id, role: 'member' },
	})
	// A second Household on purpose: the test moves `first` into it.
	const otherHousehold = await prisma.household.create({
		data: { name: 'Moved cooking household' },
	})
	try {
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Shared rice',
				userId: first.id,
				householdId: first.householdId,
				ingredients: { create: { name: 'rice', order: 0 } },
				instructions: { create: { content: 'Boil the rice.', order: 0 } },
			},
			include: { ingredients: true, instructions: true },
		})
		const ingredient = page.getByRole('checkbox', { name: 'rice', exact: true })
		const step = page
			.getByRole('checkbox')
			.filter({ hasText: 'Boil the rice.' })
		await page.goto(`/recipes/${recipe.id}`)
		await ingredient.click()
		await page.context().clearCookies()
		await login({ id: second.id })
		await page.reload()
		await expect(ingredient).not.toBeChecked()
		await step.click()
		await page.context().clearCookies()
		await login({ id: first.id })
		await page.reload()
		await expect(ingredient).toBeChecked()
		await expect(step).not.toBeChecked()
		await prisma.householdMember.update({
			where: {
				householdId_userId: {
					householdId: first.householdId,
					userId: first.id,
				},
			},
			data: { householdId: otherHousehold.id },
		})
		await prisma.recipe.update({
			where: { id: recipe.id },
			data: { householdId: otherHousehold.id },
		})
		await page.reload()
		await expect(ingredient).not.toBeChecked()
		await expect(step).not.toBeChecked()
	} finally {
		await prisma.household.delete({ where: { id: otherHousehold.id } })
	}
})

test('edited cooking content cannot inherit checks after reload', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Roast vegetables',
			userId: user.id,
			householdId: user.householdId,
			ingredients: { create: { name: 'carrot', amount: '1', order: 0 } },
			instructions: { create: { content: 'Boil for 10 minutes.', order: 0 } },
		},
		include: { ingredients: true, instructions: true },
	})
	await page.goto(`/recipes/${recipe.id}`)
	await page.getByRole('checkbox', { name: 'carrot' }).click()
	await page
		.getByRole('checkbox')
		.filter({ hasText: 'Boil for 10 minutes.' })
		.click()
	await prisma.instruction.update({
		where: { id: recipe.instructions[0]!.id },
		data: { content: 'Roast for 30 minutes.' },
	})
	await page.reload()
	await expect(page.getByRole('checkbox', { name: 'carrot' })).toBeChecked()
	await expect(
		page.getByRole('checkbox').filter({ hasText: 'Roast for 30 minutes.' }),
	).not.toBeChecked()
	await prisma.ingredient.update({
		where: { id: recipe.ingredients[0]!.id },
		data: { amount: '2' },
	})
	await page.reload()
	await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0)
})

test('editing a step mid-cook keeps the other checks and every row id', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Garlic spaghetti',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: [
					{ name: 'spaghetti', amount: '200', unit: 'g', order: 0 },
					{ name: 'garlic', amount: '3', unit: 'cloves', order: 1 },
					{ name: 'olive oil', amount: '3', unit: 'tbsp', order: 2 },
				],
			},
			instructions: {
				create: [
					{ content: 'Boil the spaghetti.', order: 0 },
					{ content: 'Fry the garlic in the oil.', order: 1 },
					{ content: 'Toss together.', order: 2 },
				],
			},
		},
		include: {
			ingredients: { orderBy: { order: 'asc' } },
			instructions: { orderBy: { order: 'asc' } },
		},
	})
	const ingredient = (name: string) =>
		page.getByRole('checkbox', { name, exact: true })
	const step = (text: string) =>
		page.getByRole('checkbox').filter({ hasText: text })

	await page.goto(`/recipes/${recipe.id}`)
	await hydrated(ingredient('spaghetti'))
	await ingredient('spaghetti').click()
	await ingredient('garlic').click()
	await step('Boil the spaghetti.').click()

	const edit = page.getByRole('link', { name: 'Edit Recipe' })
	await hydrated(edit)
	await edit.click()
	await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
	const save = page.locator('[data-nav-save]')
	await hydrated(save)
	await page
		.getByRole('textbox', { name: 'Step 3' })
		.fill('Toss together and serve.')
	await save.click()

	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	await expect(step('Toss together and serve.')).toBeVisible()
	await expect(ingredient('spaghetti')).toBeChecked()
	await expect(ingredient('garlic')).toBeChecked()
	await expect(ingredient('olive oil')).not.toBeChecked()
	await expect(step('Boil the spaghetti.')).toBeChecked()
	await expect(step('Toss together and serve.')).not.toBeChecked()

	const saved = await prisma.recipe.findUniqueOrThrow({
		where: { id: recipe.id },
		select: {
			ingredients: { orderBy: { order: 'asc' }, select: { id: true } },
			instructions: {
				orderBy: { order: 'asc' },
				select: { id: true, content: true },
			},
		},
	})
	expect(saved.ingredients.map((row) => row.id)).toEqual(
		recipe.ingredients.map((row) => row.id),
	)
	expect(saved.instructions).toEqual([
		{ id: recipe.instructions[0]!.id, content: 'Boil the spaghetti.' },
		{ id: recipe.instructions[1]!.id, content: 'Fry the garlic in the oil.' },
		{ id: recipe.instructions[2]!.id, content: 'Toss together and serve.' },
	])

	// A double tap on the heart ends where the second tap left it.
	const heart = page.locator(
		'form:has(input[name="intent"][value="toggleFavorite"]) button',
	)
	await hydrated(heart)
	await expect(heart).toHaveAccessibleName('Add to favorites')
	// The second tap can cancel the first in the browser after the server has
	// it, so count both ways a tap's request ends.
	let taps = 0
	const countTap = (request: { method(): string }) => {
		if (request.method() === 'POST') taps++
	}
	page.on('requestfinished', countTap)
	page.on('requestfailed', countTap)
	await heart.click()
	await heart.click()
	await expect(heart).toHaveAccessibleName('Add to favorites')
	await expect.poll(() => taps).toBe(2)
	await expect
		.poll(async () => {
			const { isFavorite } = await prisma.recipe.findUniqueOrThrow({
				where: { id: recipe.id },
				select: { isFavorite: true },
			})
			return isFavorite
		})
		.toBe(false)
	await page.reload()
	await expect(heart).toHaveAccessibleName('Add to favorites')
})
