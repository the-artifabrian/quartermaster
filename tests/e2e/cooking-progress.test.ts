import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

for (const width of [390, 1280]) {
	test(`cooking checks resume, stay with their Recipe, and reset at ${width}px`, async ({
		page,
		login,
	}) => {
		const user = await login()
		const household = await prisma.household.create({
			data: {
				name: 'Cooking checks household',
				staplesCutoverAt: new Date(),
				members: { create: { userId: user.id, role: 'owner' } },
			},
		})
		try {
			const sauce = await prisma.recipe.create({
				data: {
					title: 'Lemon sauce',
					userId: user.id,
					householdId: household.id,
					ingredients: { create: { name: 'lemon', amount: '1', order: 0 } },
					instructions: { create: { content: 'Squeeze the lemon.', order: 0 } },
				},
			})
			const pasta = await prisma.recipe.create({
				data: {
					title: 'Walnut pasta',
					userId: user.id,
					householdId: household.id,
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
					householdId: household.id,
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
					householdId: household.id,
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
		} finally {
			await prisma.household.delete({ where: { id: household.id } })
		}
	})
}

test('cooking checks isolate accounts and household changes in the same browser', async ({
	page,
	login,
	insertNewUser,
}) => {
	const first = await login()
	const second = await insertNewUser()
	const household = await prisma.household.create({
		data: {
			name: 'Shared cooking household',
			staplesCutoverAt: new Date(),
			members: {
				create: [
					{ userId: first.id, role: 'owner' },
					{ userId: second.id, role: 'member' },
				],
			},
		},
	})
	const otherHousehold = await prisma.household.create({
		data: { name: 'Moved cooking household', staplesCutoverAt: new Date() },
	})
	try {
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Shared rice',
				userId: first.id,
				householdId: household.id,
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
				householdId_userId: { householdId: household.id, userId: first.id },
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
		await prisma.household.deleteMany({
			where: { id: { in: [household.id, otherHousehold.id] } },
		})
	}
})

test('edited cooking content cannot inherit checks after reload', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Edited cooking household',
			staplesCutoverAt: new Date(),
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	try {
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Roast vegetables',
				userId: user.id,
				householdId: household.id,
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
	} finally {
		await prisma.household.delete({ where: { id: household.id } })
	}
})
