import fs from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { getPasswordHash } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'

test('share a dinner, sign in, save, edit, cook and plan an independent Menu on mobile', async ({
	page,
	browser,
}) => {
	test.setTimeout(90_000)
	const password = 'Menu-sharing-263!'
	const users = await Promise.all(
		['source', 'recipient'].map(async (name) =>
			prisma.user.create({
				data: {
					...createUser(),
					name: `Menu ${name}`,
					password: { create: { hash: await getPasswordHash(password) } },
				},
			}),
		),
	)
	const homes = await Promise.all(
		users.map((user) =>
			prisma.household.create({
				data: {
					name: `${user.name} household`,
					members: { create: { userId: user.id, role: 'owner' } },
				},
			}),
		),
	)
	const [source, recipient] = users
	const [sourceHome, recipientHome] = homes
	try {
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Lemon chickpeas',
				userId: source!.id,
				householdId: sourceHome!.id,
				yieldAmount: 4,
				yieldLabel: 'bowls',
				activeTime: 10,
				totalTime: 25,
				image: {
					create: {
						objectKey: 'notes/0.png',
						altText: 'Shared Recipe image fixture',
					},
				},
				ingredients: {
					create: [
						{ name: 'chickpeas', amount: '400', unit: 'g', order: 0 },
						{ name: 'lemon', amount: '1/2', order: 1 },
					],
				},
				instructions: {
					create: [
						{ content: 'Warm the chickpeas.', order: 0 },
						{ content: 'Finish with lemon.', order: 1 },
					],
				},
			},
		})
		const salad = await prisma.recipe.create({
			data: {
				title: 'Tomato and cucumber salad',
				userId: source!.id,
				householdId: sourceHome!.id,
				ingredients: {
					create: [
						{ name: 'tomatoes', amount: '4', order: 0 },
						{ name: 'cucumber', amount: '1', order: 1 },
					],
				},
				instructions: {
					create: {
						content: 'Chop and dress with olive oil and salt.',
						order: 0,
					},
				},
			},
		})
		const menu = await prisma.menu.create({
			data: {
				title: 'Terrace dinner',
				titleKey: 'terrace dinner',
				description: 'A relaxed dinner for friends.',
				defaultGuestCount: 6,
				householdId: sourceHome!.id,
				sections: {
					create: [
						{
							name: 'Dinner',
							order: 0,
							items: {
								create: [
									{
										kind: 'recipe',
										recipeId: recipe.id,
										recipeTitle: recipe.title,
										scaleMultiplier: 1.5,
										note: 'Serve warm with flatbread.',
										order: 0,
									},
									{
										kind: 'recipe',
										recipeId: salad.id,
										recipeTitle: salad.title,
										scaleMultiplier: 1,
										order: 1,
									},
									{
										kind: 'note',
										note: 'Lemonade with mint — mix just before serving',
										order: 2,
										shoppingLines: {
											create: { name: 'mint', quantity: '2', unit: 'bunches' },
										},
									},
								],
							},
						},
						{
							name: 'For later',
							order: 1,
							items: {
								create: {
									kind: 'recipe',
									recipeId: recipe.id,
									recipeTitle: recipe.title,
									scaleMultiplier: 0.5,
									note: 'Keep a small bowl aside.',
									order: 0,
								},
							},
						},
					],
				},
			},
		})
		const publicPath = `/share/menus/${menu.id}`
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto(publicPath)
		await expect(page.getByRole('heading', { name: menu.title })).toBeVisible()
		await expect(page.getByText('Usually for 6 guests')).toBeVisible()
		await expect(page.getByText('mint', { exact: true })).toBeVisible()
		await expect(
			page.getByRole('link', { name: /Lemon chickpeas/ }).first(),
		).toContainText('1.5× · makes 6 bowls')
		await page
			.getByRole('link', { name: /Lemon chickpeas/ })
			.first()
			.click()
		await expect(page.getByRole('button', { name: 'Scale 1.5×' })).toBeVisible()
		await expect(
			page.getByRole('checkbox', { name: 'chickpeas', exact: true }),
		).toContainText('600 g chickpeas')
		await expect(page.getByText('Serve warm with flatbread.')).toBeVisible()
		await expect(
			page.getByRole('img', { name: 'Shared Recipe image fixture' }),
		).toBeVisible()
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true)
		await page.getByRole('link', { name: 'Back to Menu' }).click()
		await page.getByRole('link', { name: 'Save to my Menus' }).click()
		await page
			.getByRole('textbox', { name: 'Username' })
			.fill(recipient!.username)
		await page.getByLabel('Password', { exact: true }).fill(password)
		await page.getByRole('button', { name: 'Log in', exact: true }).click()
		await expect(page).toHaveURL(publicPath)
		await page.getByRole('button', { name: 'Save to my Menus' }).click()
		await expect(page).toHaveURL(/\/recipes\/menus\/[^/]+$/)
		const savedPath = new URL(page.url()).pathname
		const saved = await prisma.menu.findFirstOrThrow({
			where: { householdId: recipientHome!.id },
		})
		expect(
			await prisma.recipe.count({ where: { householdId: recipientHome!.id } }),
		).toBe(2)
		expect(
			await prisma.meal.count({
				where: { mealPlan: { householdId: recipientHome!.id } },
			}),
		).toBe(0)
		expect(
			await prisma.shoppingListItem.count({
				where: { list: { householdId: recipientHome!.id } },
			}),
		).toBe(0)
		await page.bringToFront()
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
		await page.getByRole('button', { name: 'Share', exact: true }).click()
		await expect(page.getByText('Public link copied')).toBeVisible()
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
			`http://localhost:3000/share/menus/${saved.id}`,
		)
		await page.getByRole('link', { name: 'Edit', exact: true }).click()
		await page.getByLabel('Title', { exact: true }).fill('My terrace dinner')
		await page
			.getByRole('button', { name: 'Save Changes', exact: true })
			.click()
		await expect(
			page.getByRole('heading', { name: 'My terrace dinner' }),
		).toBeVisible()
		await page
			.getByRole('link', { name: /Lemon chickpeas/ })
			.first()
			.click()
		await expect(
			page.getByRole('checkbox', { name: 'chickpeas', exact: true }),
		).toContainText('600 g chickpeas')
		await page.getByRole('checkbox', { name: 'chickpeas', exact: true }).click()
		await expect(
			page.getByRole('checkbox', { name: 'chickpeas', exact: true }),
		).toBeChecked()
		await page.getByRole('checkbox', { name: /Warm the chickpeas/ }).click()
		await page.goto(savedPath)
		await page.getByRole('button', { name: 'Add to Plan', exact: true }).click()
		await page.getByRole('button', { name: 'Add to Plan', exact: true }).click()
		await expect(page).toHaveURL(/\/plan/)
		expect(
			await prisma.meal.count({
				where: { mealPlan: { householdId: recipientHome!.id } },
			}),
		).toBe(1)
		expect(
			await prisma.shoppingListItem.count({
				where: { list: { householdId: recipientHome!.id } },
			}),
		).toBe(0)
		await page.goto(publicPath)
		await page.getByRole('link', { name: 'Open my Menu' }).click()
		await expect(page).toHaveURL(savedPath)
		await expect(
			page.getByRole('heading', { name: 'My terrace dinner' }),
		).toBeVisible()
		await prisma.menu.delete({ where: { id: menu.id } })
		await prisma.recipe.deleteMany({ where: { householdId: sourceHome!.id } })
		await page.reload()
		await page
			.getByRole('link', { name: /Lemon chickpeas/ })
			.first()
			.click()
		const image = page.getByRole('img', { name: 'Shared Recipe image fixture' })
		await expect(image).toBeVisible()
		expect(
			await image.evaluate(
				(element) => (element as HTMLImageElement).naturalWidth,
			),
		).toBeGreaterThan(0)
		const anonymous = await browser.newContext()
		const anonPage = await anonymous.newPage()
		expect((await anonPage.goto(publicPath))!.status()).toBe(404)
		await anonPage.goto(savedPath)
		await expect(anonPage).toHaveURL(/\/login\?/)
		await anonymous.close()
	} finally {
		for (const user of users)
			await fs.rm(`tests/fixtures/uploaded/users/${user.id}`, {
				recursive: true,
				force: true,
			})
		await prisma.household.deleteMany({
			where: { id: { in: homes.map((h) => h.id) } },
		})
		await prisma.user.deleteMany({
			where: { id: { in: users.map((u) => u.id) } },
		})
	}
})
