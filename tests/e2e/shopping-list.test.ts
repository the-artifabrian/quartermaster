import { type Locator, type Page } from '@playwright/test'
import { getCurrentWeekStart } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

async function expectLocalPendingFeedback({
	page,
	button,
	statusName,
}: {
	page: Page
	button: Locator
	statusName: string
}) {
	const widthBefore = (await button.boundingBox())?.width
	expect(widthBefore).toBeDefined()

	const submission = button.click()
	await expect(button).toBeDisabled()
	const status = page.getByRole('status')
	await expect(status).toBeVisible()
	await expect(status).toContainText(statusName)
	expect((await button.boundingBox())?.width).toBe(widthBefore)
	await expect(
		page.getByRole('progressbar', { includeHidden: true }),
	).toHaveCount(0)

	await submission
	await expect(status).toBeHidden()
}

test('Shopping list flow: generate → verify items → add manual → check → clear', async ({
	page,
	login,
}) => {
	test.setTimeout(30_000)
	const user = await login()

	// Create household + Pro access (shopping requires Pro)
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	await prisma.subscription.create({
		data: {
			userId: user.id,
			tier: 'pro',
			trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		},
	})

	// Set up recipe + meal plan via DB
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Test Recipe',
			userId: user.id,
			householdId: household.id,
			ingredients: {
				create: [
					{ name: 'chicken breast', amount: '2', unit: 'lbs', order: 0 },
					{ name: 'jasmine rice', amount: '1', unit: 'cup', order: 1 },
					{ name: 'broccoli', amount: '1', unit: 'head', order: 2 },
				],
			},
			instructions: {
				create: [{ content: 'Cook everything', order: 0 }],
			},
		},
	})

	const weekStart = getCurrentWeekStart()
	await prisma.mealPlan.create({
		data: {
			householdId: household.id,
			weekStart,
			meals: {
				create: {
					date: weekStart,
					order: 0,
					label: 'dinner',
					recipeItems: {
						create: {
							order: 0,
							recipeId: recipe.id,
							recipeTitle: recipe.title,
							scaleMultiplier: 1,
						},
					},
				},
			},
		},
	})

	// 1. Navigate to shopping list
	await page.goto('/shopping')
	await expect(
		page.getByRole('heading', { name: /shopping list/i }),
	).toBeVisible()

	// Keep both audited actions pending long enough for delayed local feedback.
	await page.route('**/shopping*', async (route) => {
		const request = route.request()
		const form =
			request.method() === 'POST'
				? (request.postDataJSON() as Record<string, unknown>)
				: null
		if (form?.intent === 'generate' || form?.intent === 'clear-checked') {
			await new Promise((resolve) => setTimeout(resolve, 1250))
		}
		await route.continue()
	})

	// 2. Generate from the meal plan with local feedback on phone and desktop.
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		await expectLocalPendingFeedback({
			page,
			button: page.getByRole('button', {
				name: /generate shopping list from meal plan/i,
			}),
			statusName: 'Generating shopping list',
		})
	}

	// 3. Verify generated items appear
	await expect(page.getByText('chicken breast')).toBeVisible()
	await expect(page.getByText('jasmine rice')).toBeVisible()
	await expect(page.getByText('broccoli')).toBeVisible()

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		if (viewport.width < 768) {
			await page.getByRole('button', { name: 'Add item' }).click()
		}
		for (const control of [
			page
				.getByText('chicken breast', { exact: true })
				.filter({ visible: true }),
			page.getByPlaceholder(/add an item/i).filter({ visible: true }),
		]) {
			await expect(control).toBeVisible()
			const box = await control.boundingBox()
			expect(box).not.toBeNull()
			expect(box!.x).toBeGreaterThanOrEqual(0)
			expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
		}
		if (viewport.width < 768) {
			await page.getByRole('button', { name: 'Close' }).click()
		}
	}

	// 4. Add manual item via Quick Add
	await page
		.getByPlaceholder(/add an item/i)
		.filter({ visible: true })
		.fill('Bananas')
	await page.getByRole('button', { name: /add to next shop/i }).click()
	await expect(page.getByText('Bananas')).toBeVisible()

	// 5. Check and clear items with local feedback on phone and desktop.
	page.on('dialog', (dialog) => void dialog.accept())
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		await page
			.getByRole('button', { name: /check off item/i })
			.first()
			.click()
		await expect(page.getByText(/\(1\/\d+\)/)).toBeVisible()

		await expectLocalPendingFeedback({
			page,
			button: page.getByRole('button', { name: /clear checked/i }),
			statusName: 'Clearing checked items',
		})
	}

	// The checked items should be gone, while unchecked items remain.
	await expect(page.getByText('jasmine rice')).toBeVisible()
})

test('household Staples can be added together from the quiet Shopping picker', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Staples Picker Household',
			staplesCutoverAt: new Date(),
			members: { create: { userId: user.id, role: 'owner' } },
			householdIngredients: {
				create: [
					{ displayName: 'Milk', canonicalKey: 'milk', isStaple: true },
					{ displayName: 'Yogurt', canonicalKey: 'yogurt', isStaple: true },
					{ displayName: 'Salt', canonicalKey: 'salt', isStaple: true },
				],
			},
		},
	})
	await prisma.subscription.create({
		data: {
			userId: user.id,
			tier: 'pro',
			trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		},
	})
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: household.id,
			items: { create: { name: 'Salt', horizon: 'later' } },
		},
	})

	await page.goto('/shopping')
	await page
		.getByRole('button', { name: 'From Staples, reminder available' })
		.click()
	await expect(page.getByRole('button', { name: 'From Staples' })).toBeVisible()
	await expect(
		page.getByRole('button', { name: /Salt.*On list/ }),
	).toBeDisabled()

	await page.getByRole('button', { name: 'Milk' }).click()
	await page.getByRole('button', { name: 'Yogurt' }).click()
	await page.getByRole('button', { name: 'Add 2 to Next shop' }).click()

	await expect(
		page.getByRole('heading', { name: 'What do you need this trip?' }),
	).toBeHidden()
	await expect(page.getByText('Milk', { exact: true })).toBeVisible()
	await expect(page.getByText('Yogurt', { exact: true })).toBeVisible()
	await expect
		.poll(() =>
			prisma.shoppingListItem.findMany({
				where: { list: { householdId: household.id } },
				orderBy: { name: 'asc' },
				select: { name: true, horizon: true },
			}),
		)
		.toEqual([
			{ name: 'Milk', horizon: 'next' },
			{ name: 'Salt', horizon: 'later' },
			{ name: 'Yogurt', horizon: 'next' },
		])
})

test('Next shop and Later stay usable and search-revealable on phone and desktop', async ({
	page,
	login,
}) => {
	test.setTimeout(30_000)
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Shopping Horizons Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	await prisma.subscription.create({
		data: {
			userId: user.id,
			tier: 'pro',
			trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		},
	})
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: household.id,
			items: {
				create: [
					{ name: 'Milk', horizon: 'next' },
					{ name: 'Bread', horizon: 'next' },
					{
						name: 'Camping fuel — phone',
						horizon: 'later',
						checked: true,
					},
					{
						name: 'Camping fuel — desktop',
						horizon: 'later',
						checked: true,
					},
					{ name: 'Solar eclipse glasses', horizon: 'later' },
					...Array.from({ length: 11 }, (_, index) => ({
						name: `Later item ${index + 1}`,
						horizon: 'later',
					})),
				],
			},
		},
	})

	for (const [viewport, itemName, activeProgress, laterCount] of [
		[{ width: 390, height: 844 }, 'Camping fuel — phone', '(0/2)', 14],
		[{ width: 1280, height: 800 }, 'Camping fuel — desktop', '(1/3)', 13],
	] as const) {
		await page.setViewportSize(viewport)
		await page.goto('/shopping')
		const pageHeading = page.getByRole('heading', { level: 1 })
		await expect(pageHeading).toContainText('Shopping List')
		await expect(pageHeading).toContainText(activeProgress)
		await expect(
			page.getByRole('heading', { name: 'Next shop', exact: true }),
		).toHaveCount(0)
		const laterToggle = page.getByRole('button', { name: /^Later/ })
		await expect(laterToggle).toContainText(`(${laterCount})`)
		await expect(laterToggle).toHaveAttribute('aria-expanded', 'false')
		await expect(page.getByText(itemName, { exact: true })).toHaveCount(0)

		await laterToggle.click()
		await expect(laterToggle).toHaveAttribute('aria-expanded', 'true')
		await expect(page.getByPlaceholder('Add for later...')).toBeVisible()
		const laterGroup = page.getByRole('group', {
			name: `${itemName} shopping item`,
		})
		await expect(
			laterGroup.getByRole('button', { name: 'Uncheck item' }),
		).toBeVisible()
		await laterGroup.getByRole('button', { name: 'Item actions' }).click()
		const moveResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'POST' &&
				response.url().includes('/shopping') &&
				response.request().postData()?.includes('intent=move') === true,
		)
		await page.getByRole('button', { name: 'Move to Next shop' }).click()
		await moveResponse

		const nextSection = page.getByTestId('next-shopping-items')
		const movedGroup = nextSection.getByRole('group', {
			name: `${itemName} shopping item`,
		})
		await expect(movedGroup).toBeVisible({ timeout: 10_000 })
		await expect(
			movedGroup.getByRole('button', { name: 'Uncheck item' }),
		).toBeVisible()
		const movedBox = await movedGroup.boundingBox()
		expect(movedBox).not.toBeNull()
		expect(movedBox!.x).toBeGreaterThanOrEqual(0)
		expect(movedBox!.x + movedBox!.width).toBeLessThanOrEqual(viewport.width)

		// A search reveals a collapsed Later match without changing the stored
		// expansion preference; clearing it collapses Later again.
		await page.goto('/shopping')
		const search = page.getByPlaceholder('Search shopping list...')
		await search.fill('Solar eclipse glasses')
		await expect(
			page.getByText('Solar eclipse glasses', { exact: true }),
		).toBeVisible()
		await search.fill('')
		await expect(
			page.getByText('Solar eclipse glasses', { exact: true }),
		).toHaveCount(0)
		await expect(page.getByRole('button', { name: /^Later/ })).toHaveAttribute(
			'aria-expanded',
			'false',
		)
	}
})
