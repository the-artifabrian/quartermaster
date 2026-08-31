import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

/**
 * Release 1A critical path (#102): the Recipes / Menus switch, a five-Recipe
 * two-section Menu with a note card and Shopping line, reorder and
 * cross-section move, save, reopen, edit, missing-Recipe behavior, and full
 * JSON recovery. Recipes are seeded directly so this never depends on the
 * Recipe form (its Playwright test is a known pre-existing failure).
 */
test('Menu critical path: build, reorder, save, reopen, missing recipe, recover', async ({
	page,
	login,
}) => {
	// One long deliberate path — the default per-test budget is too tight.
	test.setTimeout(60_000)
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })

	const titles = [
		'Hummus',
		'Pita Bread',
		'Chicken Kofta',
		'Tomato Sumac Salad',
		'Orange Cake',
	]
	const recipes: Record<string, { id: string }> = {}
	for (const title of titles) {
		recipes[title] = await prisma.recipe.create({
			data: {
				title,
				userId: user.id,
				householdId: household.id,
				...(title === 'Hummus' && {
					yieldAmount: 4,
					yieldLabel: 'bowls',
					ingredients: {
						create: { name: 'chickpeas', amount: '400', unit: 'g', order: 0 },
					},
				}),
			},
			select: { id: true },
		})
	}

	// Desktop and phone picker variants both render (CSS decides), so target
	// whichever is actually visible at this viewport. Closed popovers can
	// linger in the DOM, so picker internals also take the last visible match.
	const visibleButton = (name: string | RegExp) =>
		page.getByRole('button', { name }).filter({ visible: true })
	const pickerSearch = () =>
		page.getByPlaceholder('Search recipes...').filter({ visible: true }).last()
	const pickerOption = (name: string) => visibleButton(name).last()

	// 1. The Recipes / Menus library switch
	await page.goto('/recipes')
	await page
		.getByRole('navigation', { name: 'Library' })
		.getByRole('link', { name: 'Menus' })
		.click()
	await expect(page).toHaveURL('/recipes/menus')
	await expect(page.getByText('No menus yet')).toBeVisible()

	// 2. Create the menu (metadata-only create, then the builder via Edit)
	await page.getByRole('link', { name: 'New Menu' }).first().click()
	await page.getByLabel('Title').fill('Levantine Terrace Dinner')
	await page.getByRole('button', { name: 'Create Menu' }).click()
	await expect(
		page.getByRole('heading', { name: 'Levantine Terrace Dinner' }),
	).toBeVisible()

	await page.getByRole('link', { name: 'Edit' }).click()
	await expect(page.getByRole('heading', { name: 'Edit Menu' })).toBeVisible()

	// React hydration lands asynchronously and `networkidle` never settles
	// here — poll the first picker open until the popover actually responds.
	await expect(async () => {
		await visibleButton('Add recipe').first().click()
		await expect(pickerSearch()).toBeVisible({ timeout: 2000 })
	}).toPass({ timeout: 15_000 })

	// 3. Five recipes: four into the unnamed section…
	for (const [index, title] of titles.slice(0, 4).entries()) {
		if (index > 0) await visibleButton('Add recipe').click()
		await pickerSearch().fill(title)
		await pickerOption(title).click()
		await expect(
			page.getByRole('button', { name: `Remove ${title} from menu` }),
		).toBeVisible()
	}
	// Every Recipe edits the same multiplier; known yield remains explanatory.
	await page.getByLabel('Scale multiplier for Hummus').fill('1.5')
	await page.getByLabel('Scale multiplier for Pita Bread').fill('2.5')

	// …then a Dessert section with the fifth (every section has a name input
	// now — the new section's is the last one)
	await page.getByRole('button', { name: 'Add section' }).click()
	await page.getByLabel('Section name').last().fill('Dessert')
	const sections = page.locator('fieldset > ul > li')
	await visibleButton('Add recipe').nth(1).click()
	await pickerSearch().fill('Orange Cake')
	await pickerOption('Orange Cake').click()
	await expect(
		page.getByRole('button', { name: 'Remove Orange Cake from menu' }),
	).toBeVisible()

	// 4. A note card with one ordinary Shopping line
	await visibleButton('Add note').first().click()
	await page
		.getByLabel('Note text')
		.fill('Drinks: lemonade with mint — mix just before serving')
	await page.getByRole('button', { name: 'Add shopping line' }).click()
	await page.getByLabel('Shopping line 1 name').fill('mint')
	await page.getByLabel('Shopping line 1 quantity').fill('2')
	await page.getByLabel('Shopping line 1 unit').fill('bunches')

	// 5. Reorder within the section and move across sections explicitly
	await page.getByRole('button', { name: /^Move note .* up$/ }).click()
	await page
		.getByRole('button', { name: 'Move Tomato Sumac Salad to another section' })
		.click()
	await page.getByRole('menuitem', { name: 'Dessert' }).click()
	await page.getByRole('button', { name: 'Move Hummus down' }).first().click()

	// 6. One explicit atomic save
	await page.getByRole('button', { name: 'Save Changes' }).click()
	await expect(page).toHaveURL(/\/recipes\/menus\/[a-z0-9]+$/)

	// Detail shows the saved order: unnamed section first, then Dessert
	const detailSections = page.locator('section')
	const firstCards = detailSections.nth(0).locator('> ul > li')
	await expect(firstCards).toHaveCount(4)
	await expect(firstCards.nth(0)).toContainText('Pita Bread')
	await expect(firstCards.nth(0)).toContainText('2.5×')
	await expect(firstCards.nth(1)).toContainText('Hummus')
	await expect(firstCards.nth(1)).toContainText('1.5× · makes 6 bowls')
	await expect(firstCards.nth(2)).toContainText('Chicken Kofta')
	await expect(firstCards.nth(3)).toContainText('Drinks: lemonade with mint')
	await expect(firstCards.nth(3)).toContainText('mint')
	await expect(firstCards.nth(3)).toContainText('2 bunches')
	await expect(page.getByRole('heading', { name: 'Dessert' })).toBeVisible()
	const dessertCards = detailSections.nth(1).locator('> ul > li')
	await expect(dessertCards.nth(0)).toContainText('Orange Cake')
	await expect(dessertCards.nth(1)).toContainText('Tomato Sumac Salad')

	// 7. Reopen the builder — everything round-trips
	await page.getByRole('link', { name: 'Edit' }).click()
	await expect(page.getByLabel('Note text')).toHaveValue(
		'Drinks: lemonade with mint — mix just before serving',
	)
	await expect(page.getByLabel('Shopping line 1 name')).toHaveValue('mint')
	await expect(page.getByLabel('Shopping line 1 quantity')).toHaveValue('2')
	await expect(page.getByLabel('Shopping line 1 unit')).toHaveValue('bunches')
	await expect(page.getByLabel('Section name').first()).toHaveValue('')
	await expect(page.getByLabel('Section name').last()).toHaveValue('Dessert')
	await expect(sections.nth(1)).toContainText('Orange Cake')
	await expect(page.getByLabel('Scale multiplier for Hummus')).toHaveValue(
		'1.5',
	)
	await expect(page.getByText('Makes 6 bowls')).toBeVisible()
	await expect(page.getByLabel('Scale multiplier for Pita Bread')).toHaveValue(
		'2.5',
	)

	// The compact quantity controls stay inside both phone and desktop layouts.
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		for (const control of [
			page.getByLabel('Scale multiplier for Hummus'),
			page.getByLabel('Scale multiplier for Pita Bread'),
		]) {
			const box = await control.boundingBox()
			expect(box).not.toBeNull()
			expect(box!.x).toBeGreaterThanOrEqual(0)
			expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
		}
	}

	// 8. A deleted Recipe stays as a clearly missing card
	await prisma.recipe.delete({ where: { id: recipes['Chicken Kofta']!.id } })
	await page.goBack()
	await page.reload()
	await expect(page.getByText('Chicken Kofta')).toBeVisible()
	await expect(
		page.getByText('No longer in your recipe library', { exact: false }),
	).toBeVisible()

	// 9. Recovery: export, lose the menu, import the file, get it all back
	const exportResponse = await page.request.get('/resources/export-all-data')
	expect(exportResponse.ok()).toBeTruthy()
	const exportBody = await exportResponse.text()

	await prisma.menu.deleteMany({ where: { householdId: household.id } })

	await page.goto('/settings/profile/import')
	await page.locator('input[type="file"]').setInputFiles({
		name: 'quartermaster-export.json',
		mimeType: 'application/json',
		buffer: Buffer.from(exportBody),
	})
	await expect(page.getByRole('heading', { name: 'Full Export' })).toBeVisible()
	await page.getByRole('button', { name: 'Import', exact: true }).click()
	await expect(page.getByText('Import Complete')).toBeVisible()

	await page.goto('/recipes/menus')
	await page.getByRole('link', { name: /Levantine Terrace Dinner/ }).click()

	// Structure, ordering, the note Shopping line, and the missing card all
	// survived the round trip; live references reconnect to the household's
	// existing recipes.
	const restoredCards = page.locator('section').nth(0).locator('> ul > li')
	await expect(restoredCards).toHaveCount(4)
	await expect(restoredCards.nth(0)).toContainText('Pita Bread')
	await expect(restoredCards.nth(0)).toContainText('2.5×')
	await expect(restoredCards.nth(1)).toContainText('Hummus')
	await expect(restoredCards.nth(1)).toContainText('6 bowls')
	await expect(restoredCards.nth(2)).toContainText('Chicken Kofta')
	await expect(restoredCards.nth(2)).toContainText(
		'No longer in your recipe library',
	)
	await expect(restoredCards.nth(3)).toContainText('2 bunches')
	await expect(page.getByRole('heading', { name: 'Dessert' })).toBeVisible()
	await expect(page.getByRole('link', { name: /Pita Bread/ })).toHaveAttribute(
		'href',
		`/recipes/${recipes['Pita Bread']!.id}`,
	)

	// The restored multiplier snapshots into Meal unchanged, drives the same
	// multiplier-first UI in Plan, and scales Shopping demand.
	const restoredMenu = await prisma.menu.findFirstOrThrow({
		where: {
			householdId: household.id,
			title: 'Levantine Terrace Dinner',
		},
	})
	const restoredHummusItem = await prisma.menuItem.findFirstOrThrow({
		where: {
			section: { menuId: restoredMenu.id },
			recipeId: recipes.Hummus!.id,
		},
	})
	expect(restoredHummusItem.scaleMultiplier).toBe(1.5)

	await page.getByRole('button', { name: 'Add to Plan' }).click()
	await page.getByRole('button', { name: 'Add to Plan' }).click()
	await expect(page).toHaveURL(/\/plan\?weekStart=/)
	const visibleMultiplierControls = page
		.getByLabel('Scale multiplier')
		.filter({ visible: true })
	await expect(visibleMultiplierControls.first()).toBeVisible()
	const visibleMultipliers = await visibleMultiplierControls.all()
	expect(
		await Promise.all(
			visibleMultipliers.map((control) => control.inputValue()),
		),
	).toEqual(expect.arrayContaining(['1.5', '2.5']))

	await visibleButton('Meal actions').click()
	await page.getByRole('menuitem', { name: 'Add to Shopping List' }).click()
	await expect
		.poll(async () => {
			return await prisma.mealShoppingContribution.findFirst({
				where: {
					meal: { sourceMenuId: restoredMenu.id },
					canonicalName: 'chickpea',
				},
				select: { quantity: true, unit: true },
			})
		})
		.toEqual({ quantity: '600', unit: 'g' })
})
