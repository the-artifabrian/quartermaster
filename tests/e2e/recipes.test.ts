import { type Locator } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { DEFAULT_RECIPE_METADATA_VALUE_CREATE } from '#app/utils/recipe-metadata.ts'
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
	await page.getByPlaceholder('Amount').fill('1')
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

test('legacy Pantry generation is gone while AI import and provenance remain', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.subscription.create({
		data: { userId: user.id, tier: 'pro' },
	})
	const household = await prisma.household.create({
		data: {
			name: 'Generator removal household',
			members: { create: { userId: user.id, role: 'owner' } },
			inventoryItems: {
				create: { name: 'archived chickpeas', userId: user.id },
			},
		},
	})

	await page.setViewportSize({ width: 1280, height: 800 })
	await page.goto('/recipes')
	await expect(page.getByRole('link', { name: /Generate Recipe/ })).toHaveCount(
		0,
	)
	await expect(page.getByText('Generate from Pantry')).toHaveCount(0)
	const openNewRecipeMenu = async () => {
		const importItem = page.getByRole('menuitem', { name: 'Import' })
		await expect(async () => {
			if (!(await importItem.isVisible())) {
				await page.getByRole('button', { name: 'New Recipe' }).click()
			}
			await expect(importItem).toBeVisible({ timeout: 2000 })
		}).toPass({ timeout: 10_000 })
	}

	await openNewRecipeMenu()
	await expect(
		page.getByRole('menuitem', { name: /Generate Recipe/ }),
	).toHaveCount(0)
	await page.keyboard.press('Escape')

	await prisma.recipe.create({
		data: {
			title: 'Historical AI Recipe',
			isAiGenerated: true,
			userId: user.id,
			householdId: household.id,
		},
	})
	await page.reload()
	const historicalCard = page.getByRole('link', {
		name: /Historical AI Recipe/,
	})
	await expect(historicalCard).toBeVisible()
	await expect(
		historicalCard.getByRole('img', { name: 'AI Generated' }),
	).toBeVisible()

	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/recipes')
	await openNewRecipeMenu()
	await expect(
		page.getByRole('menuitem', { name: /Generate Recipe/ }),
	).toHaveCount(0)

	await page.goto('/recipes/import')
	await expect(
		page.getByRole('heading', { name: 'Import Recipe' }),
	).toBeVisible()
	await page.getByRole('button', { name: 'From Text' }).click()
	await expect(page.getByLabel('Recipe text')).toBeVisible()
	await expect(
		page.getByRole('button', { name: 'Extract with AI' }),
	).toBeVisible()
	await page.getByRole('button', { name: 'From Image' }).click()
	await expect(page.getByLabel('Upload screenshots (up to 5)')).toBeVisible()
	await expect(
		page.getByRole('button', { name: 'Extract with AI' }),
	).toBeVisible()

	const removedRoute = await page.goto('/recipes/generate')
	expect(removedRoute?.status()).toBe(404)
})

test('Recipe search and filter', async ({ page, login }) => {
	test.setTimeout(30_000)
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
	await prisma.recipe.createMany({
		data: [
			{
				title: 'Chicken Curry',
				userId: user.id,
				householdId: household.id,
			},
			{
				title: 'Ciorbă',
				userId: user.id,
				householdId: household.id,
			},
		],
	})

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 900 },
	]) {
		await page.setViewportSize(viewport)
		await page.goto('/recipes')
		await expect(page.getByText('Spicy Thai Curry')).toBeVisible()
		await expect(page.getByText('Simple Green Salad')).toBeVisible()

		const search = page.getByRole('searchbox', {
			name: 'Search by name or ingredient',
		})
		async function searchFor(value: string) {
			await expect(async () => {
				await search.fill(value)
				await expect
					.poll(() => new URL(page.url()).searchParams.get('search'), {
						timeout: 1500,
					})
					.toBe(value || null)
			}).toPass({ timeout: 10_000 })
		}

		await searchFor('curry')
		await expect(page.getByText('Spicy Thai Curry')).toBeVisible()
		await expect(page.getByText('Simple Green Salad')).not.toBeVisible()

		// Existing non-adjacent title-word behavior remains intact.
		await searchFor('spicy curry')
		await expect(page.getByText('Spicy Thai Curry')).toBeVisible()
		await expect(page.getByText('Simple Green Salad')).not.toBeVisible()

		await searchFor('chikcen curry')
		await expect(page.getByText('Chicken Curry')).toBeVisible()
		await expect(page.getByText('Spicy Thai Curry')).not.toBeVisible()

		await searchFor('ciorba')
		await expect(page.getByText('Ciorbă')).toBeVisible()
		await expect(page.getByText('Chicken Curry')).not.toBeVisible()

		await searchFor('')
		await expect(page.getByText('Simple Green Salad')).toBeVisible()
	}
})

test('Recipe classification edits and filters fit phone and desktop layouts', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Classification layout household',
			members: { create: { userId: user.id, role: 'owner' } },
			recipeMetadataValues: {
				create: DEFAULT_RECIPE_METADATA_VALUE_CREATE,
			},
		},
	})
	const classifiedRecipe = await prisma.recipe.create({
		data: {
			title: 'Levantine supper',
			userId: user.id,
			householdId: household.id,
			ingredients: { create: { name: 'chickpeas', order: 0 } },
			instructions: { create: { content: 'Combine.', order: 0 } },
		},
	})
	await prisma.recipe.create({
		data: {
			title: 'Plain pasta',
			userId: user.id,
			householdId: household.id,
			ingredients: { create: { name: 'pasta', order: 0 } },
			instructions: { create: { content: 'Boil.', order: 0 } },
		},
	})

	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`/recipes/${classifiedRecipe.id}/edit`)
	await page.getByText('Classification', { exact: true }).click()
	const cuisineGroup = page.getByRole('group', { name: 'Cuisine' })
	await cuisineGroup.getByLabel('Add cuisine').fill('  Levantine  ')
	await cuisineGroup.getByRole('button', { name: 'Add' }).click()
	await expect(
		cuisineGroup.getByRole('button', { name: 'Levantine' }),
	).toHaveAttribute('aria-pressed', 'true')
	await page.getByRole('button', { name: 'Save Changes' }).click()
	await expect(page).toHaveURL(new RegExp(`/recipes/${classifiedRecipe.id}$`))

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		await page.goto(`/recipes/${classifiedRecipe.id}/edit`)
		await page.getByText('Classification', { exact: true }).click()
		const selectedCuisine = page.getByRole('button', {
			name: 'Levantine',
			exact: true,
		})
		await expect(selectedCuisine).toHaveAttribute('aria-pressed', 'true')
		const classificationBox = await selectedCuisine.boundingBox()
		expect(classificationBox).not.toBeNull()
		expect(classificationBox!.x).toBeGreaterThanOrEqual(0)
		expect(classificationBox!.x + classificationBox!.width).toBeLessThanOrEqual(
			viewport.width,
		)

		await page.goto('/recipes')
		if (viewport.width < 768) {
			await page.getByRole('button', { name: 'Toggle filters' }).click()
		}
		await page.getByRole('button', { name: /^Cuisine/ }).click()
		await page.getByRole('menuitemcheckbox', { name: 'Levantine' }).click()
		await page.keyboard.press('Escape')
		await expect(page).toHaveURL(/cuisine=levantine/)
		await expect(page.getByText('Levantine supper')).toBeVisible()
		await expect(page.getByText('Plain pasta')).not.toBeVisible()
	}
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
	const finalInstruction = page
		.getByRole('checkbox')
		.filter({ hasText: 'Complete cooking step 12.' })
	await page.evaluate(() => {
		document.documentElement.style.scrollBehavior = 'auto'
		window.scrollTo(0, document.documentElement.scrollHeight)
	})
	const [finalInstructionBox, floatingIngredientsBox] = await Promise.all([
		finalInstruction.boundingBox(),
		floatingIngredients.boundingBox(),
	])
	expect(finalInstructionBox).not.toBeNull()
	expect(floatingIngredientsBox).not.toBeNull()
	expect(
		finalInstructionBox!.y + finalInstructionBox!.height,
	).toBeLessThanOrEqual(floatingIngredientsBox!.y)
	await floatingIngredients.click()
	await expect(page.getByRole('dialog', { name: 'Ingredients' })).toBeVisible()
})

test('Recipe instructions show passive cooking cues and ignore stored timers', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Cooking cues household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const instruction = 'Preheat to 400°F, bake for 12 minutes, then rest 5 min.'
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Glanceable Roast',
			userId: user.id,
			householdId: household.id,
			ingredients: {
				create: { name: 'cauliflower', amount: '1', unit: 'head', order: 0 },
			},
			instructions: {
				create: [
					{ content: instruction, order: 0 },
					{ content: 'Cook until done, then serve.', order: 1 },
				],
			},
		},
	})

	await page.addInitScript(() => {
		localStorage.setItem(
			'qm-timers',
			JSON.stringify([
				{
					id: 'expired',
					label: 'Old timer',
					durationSeconds: 1,
					endTime: Date.now() - 1_000,
					remainingMs: 0,
					status: 'running',
					alarmStartedAt: null,
				},
			]),
		)
		Object.defineProperty(window, 'AudioContext', {
			configurable: true,
			value: class {
				constructor() {
					localStorage.setItem('qm-test-alarm', 'audio')
					throw new Error('Alarm attempted')
				}
			},
		})
		Object.defineProperty(navigator, 'vibrate', {
			configurable: true,
			value: () => {
				localStorage.setItem('qm-test-alarm', 'vibrate')
				return true
			},
		})
		Object.defineProperty(window, 'Notification', {
			configurable: true,
			value: {
				permission: 'default',
				requestPermission: () => {
					localStorage.setItem('qm-test-notification-request', 'requested')
					return Promise.resolve('denied')
				},
			},
		})
	})

	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`/recipes/${recipe.id}`)

	const step = page
		.getByRole('checkbox')
		.filter({ hasText: 'bake for 12 minutes, then rest 5 min.' })
	const durationCues = step.getByTestId('cooking-duration-cue')
	const temperatureCue = step.getByRole('button', {
		name: '400°F, converts to 205°C',
	})
	await expect(durationCues).toHaveText(['for 12 minutes', '5 min'])
	await expect(durationCues.first()).toHaveCSS('font-weight', '600')
	await expect(durationCues.first()).toHaveCSS(
		'text-decoration-line',
		'underline',
	)
	await expect(temperatureCue).toHaveAttribute('role', 'button')
	await expect(temperatureCue).toHaveAttribute(
		'aria-label',
		'400°F, converts to 205°C',
	)
	await expect(temperatureCue).toHaveCSS('font-weight', '600')
	await expect(temperatureCue).toHaveCSS('text-decoration-line', 'underline')
	await expect(step.getByRole('button', { name: /timer/i })).toHaveCount(0)

	const renderedInstruction = await step.evaluate((row) => {
		const paragraph = row.querySelector('p')
		if (!paragraph) throw new Error('Instruction text is missing')
		const copy = paragraph.cloneNode(true) as HTMLElement
		copy
			.querySelectorAll('[role="tooltip"]')
			.forEach((tooltip) => tooltip.remove())
		return copy.textContent
	})
	expect(renderedInstruction).toBe(instruction)

	await temperatureCue.click()
	await expect(step.getByRole('tooltip')).toHaveText('205°C')
	await temperatureCue.press('Escape')
	await expect(step.getByRole('tooltip')).not.toBeVisible()
	await temperatureCue.focus()
	await temperatureCue.press('Enter')
	await expect(step.getByRole('tooltip')).toBeVisible()
	await temperatureCue.press('Escape')

	await step.click({ position: { x: 8, y: 8 } })
	await expect(step).toHaveAttribute('aria-checked', 'true')
	await expect(durationCues.first()).toHaveCSS(
		'text-decoration-line',
		/line-through/,
	)
	await expect(temperatureCue).toHaveCSS('text-decoration-line', /line-through/)

	const ordinaryStep = page
		.getByRole('checkbox')
		.filter({ hasText: 'Cook until done, then serve.' })
	await expect(ordinaryStep.getByTestId('cooking-duration-cue')).toHaveCount(0)
	await expect(ordinaryStep.getByRole('button')).toHaveCount(0)
	await expect(page.getByRole('button', { name: /^Timer:/i })).toHaveCount(0)
	expect(
		await page.evaluate(() => localStorage.getItem('qm-test-alarm')),
	).toBeNull()
	expect(
		await page.evaluate(() =>
			localStorage.getItem('qm-test-notification-request'),
		),
	).toBeNull()

	await page.setViewportSize({ width: 1024, height: 800 })
	await expect(durationCues.first()).toHaveCSS('font-weight', '600')
	await expect(temperatureCue).toHaveCSS('font-weight', '600')
})

test('Recipe detail copies clean scaled text and reports clipboard results', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Recipe copy household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Clipboard Soup',
			description: 'Not part of the clean copy.',
			rawText: 'Internal import data.',
			notes: 'Private cooking notes.',
			userId: user.id,
			householdId: household.id,
			ingredients: {
				create: [
					{ name: 'For the soup', isHeading: true, order: 0 },
					{
						name: 'tomatoes',
						amount: '1/2',
						unit: 'cup',
						notes: 'drained',
						order: 1,
					},
					{ name: 'salt', order: 2 },
				],
			},
			instructions: {
				create: [
					{ content: 'Simmer gently.', order: 0 },
					{ content: 'Serve warm.', order: 1 },
				],
			},
		},
	})

	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.goto(`/recipes/${recipe.id}?scale=1.5`)
	await page.getByRole('checkbox', { name: 'tomatoes' }).click()
	await page.getByRole('checkbox').filter({ hasText: 'Simmer gently.' }).click()
	await page.getByRole('button', { name: 'Copy Recipe' }).click()

	const announcements = page.getByRole('region', { name: /Notifications/ })
	await expect(announcements.getByText('Copied', { exact: true })).toBeVisible()
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe(`Clipboard Soup

Ingredients
- 3/4 cup tomatoes
- salt

Instructions
1. Simmer gently.
2. Serve warm.`)

	await page.evaluate(() => {
		Object.defineProperty(navigator.clipboard, 'writeText', {
			configurable: true,
			value: () => Promise.reject(new Error('Clipboard unavailable')),
		})
	})
	await page.getByRole('button', { name: 'Copy Recipe' }).click()
	await expect(
		announcements.getByText('Unable to copy recipe', { exact: true }),
	).toBeVisible()
})
