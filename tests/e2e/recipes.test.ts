import fs from 'node:fs/promises'
import path from 'node:path'
import { type Locator } from '@playwright/test'
import sharp from 'sharp'
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
	await page.getByText('Details', { exact: true }).click()
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
	await page.getByRole('button', { name: 'Save', exact: true }).click()

	// 2. Verify redirected to recipe detail ("new" would match an id pattern)
	await expect(page).toHaveURL(/\/recipes\/(?!new$)[a-z0-9]+$/)
	const recipeId = new URL(page.url()).pathname.split('/').at(-1)!
	await expect(
		page.getByRole('heading', { name: 'E2E Test Pasta' }),
	).toBeVisible()
	await expect(page.getByText('Makes 4 servings')).toBeVisible()
	expect(
		await prisma.recipe.findUnique({
			where: { id: recipeId },
			select: { yieldAmount: true, yieldLabel: true },
		}),
	).toEqual({ yieldAmount: 4, yieldLabel: 'servings' })
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
	await page.getByRole('button', { name: 'Save', exact: true }).click()

	// Verify update
	await expect(page).toHaveURL(/\/recipes\/[a-z0-9]+$/)
	await expect(
		page.getByRole('heading', { name: 'E2E Updated Pasta' }),
	).toBeVisible()

	// 5. Delete recipe
	await page.getByRole('link', { name: /edit/i }).click()
	await page.getByRole('button', { name: /delete recipe/i }).click()
	// The confirm sheet asks, with Cancel first in line.
	const confirm = page.getByRole('dialog', { name: 'Delete this Recipe?' })
	await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
	await confirm.getByRole('button', { name: 'Delete Recipe' }).click()

	// Lands on the Recipes list, not back on /recipes/:id or its edit form
	await expect(page).toHaveURL('/recipes')
	await expect(
		page.getByRole('heading', { name: /^Recipes( \(|$)/ }),
	).toBeVisible()
	await expect(page.getByText('E2E Updated Pasta')).toHaveCount(0)
	expect(await prisma.recipe.findUnique({ where: { id: recipeId } })).toBeNull()
})

/**
 * A 4 MB JPEG that decodes as 64×48 pixels: the bytes are comment segments,
 * so the browser and the server's image route have almost nothing to decode.
 */
async function bulkyPhoto() {
	const jpeg = await sharp({
		create: { width: 64, height: 48, channels: 3, background: '#c86b3c' },
	})
		.jpeg()
		.toBuffer()
	const comment = Buffer.alloc(65_535 + 2, 0x20)
	comment.writeUInt16BE(0xfffe, 0)
	comment.writeUInt16BE(65_535, 2)
	const comments = Array.from({ length: 64 }, () => comment)
	// Comments go right after the start-of-image marker.
	return Buffer.concat([jpeg.subarray(0, 2), ...comments, jpeg.subarray(2)])
}

test('a phone photo over 3 MB is resized in the browser and saved', async ({
	page,
	login,
}) => {
	await login()
	const photo = await bulkyPhoto()
	expect(photo.byteLength).toBeGreaterThan(4 * 1024 * 1024)

	await page.goto('/recipes/new')
	await page.getByRole('textbox', { name: /title/i }).fill('Photo Pasta')
	await page.getByPlaceholder('Ingredient name').fill('spaghetti')
	await page.getByPlaceholder('Step 1').fill('Boil water and cook pasta')
	await page.getByText('Photo', { exact: true }).click()
	await page.locator('input[type="file"][name="image"]').setInputFiles({
		name: 'IMG_0001.JPG',
		mimeType: 'image/jpeg',
		buffer: photo,
	})
	const preview = page.getByRole('img', { name: 'Recipe preview' })
	await expect(preview).toBeVisible()
	// Visible is not loaded: the preview must decode the picked photo.
	await expect
		.poll(() =>
			preview.evaluate((element) => (element as HTMLImageElement).naturalWidth),
		)
		.toBeGreaterThan(0)
	await page.getByRole('button', { name: 'Save', exact: true }).click()

	await expect(page).toHaveURL(/\/recipes\/(?!new$)[a-z0-9]+$/)
	const recipeId = new URL(page.url()).pathname.split('/').at(-1)!
	await expect(page.getByRole('img', { name: 'Photo Pasta' })).toBeVisible()
	const { objectKey } = await prisma.recipeImage.findUniqueOrThrow({
		where: { recipeId },
		select: { objectKey: true },
	})
	expect(objectKey).toMatch(/\.jpg$/)
	const stored = await fs.stat(
		path.join(process.cwd(), 'tests/fixtures/uploaded', objectKey),
	)
	expect(stored.size).toBeLessThan(3 * 1024 * 1024)
})

const NOT_A_PHOTO = {
	name: 'pasta.jpg',
	mimeType: 'image/jpeg',
	// Text with a photo's name and type: only its bytes give it away.
	buffer: Buffer.from('Boil the pasta for 9 minutes.'),
}
const REFUSED = 'We can’t use that file. Choose a JPG, PNG or WebP.'

test('a file that isn’t a photo is refused, and the Recipe then saves without it', async ({
	page,
	login,
}) => {
	const { householdId } = await login()

	await page.goto('/recipes/new')
	await page.getByRole('textbox', { name: /title/i }).fill('Notes Pasta')
	await page.getByPlaceholder('Ingredient name').fill('spaghetti')
	await page.getByPlaceholder('Step 1').fill('Boil water and cook pasta')
	await page.getByText('Photo', { exact: true }).click()
	const photoInput = page.locator('input[type="file"][name="image"]')
	await photoInput.setInputFiles(NOT_A_PHOTO)
	await page.getByRole('button', { name: 'Save', exact: true }).click()

	await expect(page.getByText(REFUSED)).toBeVisible()
	await expect(page).toHaveURL(/\/recipes\/new$/)
	await expect(page.getByRole('textbox', { name: /title/i })).toHaveValue(
		'Notes Pasta',
	)
	expect(
		await prisma.recipe.count({ where: { householdId, title: 'Notes Pasta' } }),
	).toBe(0)
	// The refused file is off the input and out of the preview.
	await expect
		.poll(() =>
			photoInput.evaluate((input: HTMLInputElement) => input.files?.length),
		)
		.toBe(0)
	await expect(page.getByRole('img', { name: 'Recipe preview' })).toHaveCount(0)

	// Save again without picking another photo.
	await page.getByRole('button', { name: 'Save', exact: true }).click()
	await expect(page).toHaveURL(/\/recipes\/(?!new$)[a-z0-9]+$/)
	const recipeId = new URL(page.url()).pathname.split('/').at(-1)!
	expect(
		await prisma.recipe.findMany({
			where: { householdId, title: 'Notes Pasta' },
			select: { id: true, image: { select: { objectKey: true } } },
		}),
	).toEqual([{ id: recipeId, image: null }])
})

test('editing with a file that isn’t a photo keeps the old photo, and the edit then saves', async ({
	page,
	login,
}) => {
	const { id: userId, householdId } = await login()
	const objectKey = 'users/fixture-user/recipes/fixture-recipe/images/0.png'
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Photo Soup',
			userId,
			householdId,
			ingredients: { create: { name: 'leeks', order: 0 } },
			instructions: { create: { content: 'Simmer.', order: 0 } },
			image: { create: { objectKey } },
		},
		select: { id: true },
	})

	await page.goto(`/recipes/${recipe.id}/edit`)
	await page.getByRole('textbox', { name: /title/i }).fill('Leek Soup')
	await page.getByText('Photo', { exact: true }).click()
	const photoInput = page.locator('input[type="file"][name="image"]')
	await photoInput.setInputFiles(NOT_A_PHOTO)
	await page.getByRole('button', { name: 'Save', exact: true }).click()

	await expect(page.getByText(REFUSED)).toBeVisible()
	await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
	await expect
		.poll(() =>
			photoInput.evaluate((input: HTMLInputElement) => input.files?.length),
		)
		.toBe(0)
	// The preview is the saved photo again.
	await expect(
		page.getByRole('img', { name: 'Recipe preview' }),
	).toHaveAttribute(
		'src',
		new RegExp(encodeURIComponent(objectKey).replaceAll('.', '\\.')),
	)

	await page.getByRole('button', { name: 'Save', exact: true }).click()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	expect(
		await prisma.recipe.findUniqueOrThrow({
			where: { id: recipe.id },
			select: { title: true, image: { select: { objectKey: true } } },
		}),
	).toEqual({ title: 'Leek Soup', image: { objectKey } })
})

test('a Pro user can extract with AI from text and from an image', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.subscription.create({
		data: { userId: user.id, tier: 'pro' },
	})

	await page.goto('/recipes/import')
	await page.getByRole('tab', { name: 'From text' }).click()
	await expect(page.getByLabel('Recipe text')).toBeVisible()
	await expect(page.getByRole('button', { name: 'Read with AI' })).toBeVisible()
	await page.getByRole('tab', { name: 'From image' }).click()
	await expect(page.getByLabel('Upload screenshots (up to 5)')).toBeVisible()
	await expect(page.getByRole('button', { name: 'Read with AI' })).toBeVisible()
})

test('Recipe search and filter', async ({ page, login }) => {
	test.setTimeout(30_000)
	const user = await login()

	// Create a couple recipes via DB for speed
	await prisma.recipe.create({
		data: {
			title: 'Spicy Thai Curry',
			userId: user.id,
			householdId: user.householdId,
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
			householdId: user.householdId,
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
				householdId: user.householdId,
			},
			{
				title: 'Ciorbă',
				userId: user.id,
				householdId: user.householdId,
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
	// Like a signup, the fixture's Household starts with the default Seasons
	// and Courses.
	const user = await login()
	const classifiedRecipe = await prisma.recipe.create({
		data: {
			title: 'Levantine supper',
			userId: user.id,
			householdId: user.householdId,
			ingredients: { create: { name: 'chickpeas', order: 0 } },
			instructions: { create: { content: 'Combine.', order: 0 } },
		},
	})
	await prisma.recipe.create({
		data: {
			title: 'Plain pasta',
			userId: user.id,
			householdId: user.householdId,
			ingredients: { create: { name: 'pasta', order: 0 } },
			instructions: { create: { content: 'Boil.', order: 0 } },
		},
	})

	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`/recipes/${classifiedRecipe.id}/edit`)
	await page.getByText('Classification', { exact: true }).click()
	const cuisineGroup = page.getByRole('group', { name: 'Cuisine' })
	await cuisineGroup.getByRole('button', { name: 'Add cuisine' }).click()
	const cuisineInput = cuisineGroup.getByRole('textbox', {
		name: 'Add cuisine',
	})
	await cuisineInput.fill('  Levantine  ')
	await cuisineInput.press('Enter')
	await expect(
		cuisineGroup.getByRole('button', { name: 'Levantine' }),
	).toHaveAttribute('aria-pressed', 'true')
	await page.getByRole('button', { name: 'Save', exact: true }).click()
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
			householdId: user.householdId,
			ingredients: { create: { name: 'flour', order: 0 } },
			instructions: { create: { content: 'Knead.', order: 0 } },
		},
	})

	async function expectYieldFits(yieldText: Locator, viewportWidth: number) {
		await expect(yieldText).toBeVisible()
		const box = await yieldText.boundingBox()
		expect(box).not.toBeNull()
		expect(box!.x).toBeGreaterThanOrEqual(0)
		expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth)
		// A clipped, ellipsized or line-clamped label keeps its box on screen,
		// so also check that the box the text is laid out in shows all of it.
		// Inline elements report 0 for every size, so this climbs to a block.
		const size = await yieldText.evaluate((element) => {
			let box: Element = element
			while (getComputedStyle(box).display === 'inline' && box.parentElement) {
				box = box.parentElement
			}
			return {
				scrollWidth: box.scrollWidth,
				clientWidth: box.clientWidth,
				scrollHeight: box.scrollHeight,
				clientHeight: box.clientHeight,
			}
		})
		expect(size.clientWidth).toBeGreaterThan(0)
		expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth)
		expect(size.clientHeight).toBeGreaterThan(0)
		expect(size.scrollHeight).toBeLessThanOrEqual(size.clientHeight)
	}

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 768, height: 900 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		await page.goto(`/recipes/${recipe.id}`)
		await expectYieldFits(
			page.getByText(`Makes 2.5 ${yieldLabel}`),
			viewport.width,
		)
	}

	// Scaling adds the original amount to the same line, its longest form.
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`/recipes/${recipe.id}?scale=1.5`)
	await expect(page.getByText('original: 2.5')).toBeVisible()
	await expectYieldFits(page.getByText(`Makes 3.75 ${yieldLabel}`), 390)
})

test('long Recipe times read in hours and days on the card, detail and edit form', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Overnight focaccia',
			activeTime: 30,
			totalTime: 1140,
			userId: user.id,
			householdId: user.householdId,
			ingredients: { create: { name: 'flour', order: 0 } },
			instructions: { create: { content: 'Proof overnight.', order: 0 } },
		},
	})
	const card = page.getByRole('link', { name: /Overnight focaccia/ })

	// The Recipe card shows the time on phone and desktop in different rows.
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		await page.goto('/recipes')
		await expect(
			card.getByText('19 hr', { exact: true }).filter({ visible: true }),
		).toHaveCount(1)
		await expect(card.getByText(/1140/)).toHaveCount(0)
	}

	await page.goto(`/recipes/${recipe.id}`)
	await expect(page.getByText('Total: 19 hr')).toBeVisible()
	await expect(page.getByText('Active: 30 min')).toBeVisible()

	await page.goto(`/recipes/${recipe.id}/edit`)
	await page.getByText('Details', { exact: true }).click()
	const totalTime = page.getByRole('spinbutton', { name: 'Total time (min)' })
	await expect(totalTime).toHaveValue('1140')
	await expect(page.getByText('= 19 hr')).toBeVisible()
	// Under an hour the minutes already read plainly, so there is no hint.
	await expect(
		page.getByRole('spinbutton', { name: 'Active time (min)' }),
	).toHaveValue('30')
	await expect(page.getByText(/^= /)).toHaveCount(1)

	await expect(totalTime).toHaveAttribute('aria-describedby', /\S/)
	const hintId = await totalTime.getAttribute('aria-describedby')
	await expect(page.locator(`[id="${hintId}"]`)).toHaveText('= 19 hr')
	// Conform listens for input only after hydration, so retry the typing.
	await expect(async () => {
		await totalTime.fill('1560')
		await expect(page.getByText('= 1 day 2 hr')).toBeVisible({ timeout: 2000 })
	}).toPass({ timeout: 15_000 })
	await page.getByRole('button', { name: 'Save', exact: true }).click()

	await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}$`))
	await expect(page.getByText('Total: 1 day 2 hr')).toBeVisible()
	expect(
		await prisma.recipe.findUnique({
			where: { id: recipe.id },
			select: { activeTime: true, totalTime: true },
		}),
	).toEqual({ activeTime: 30, totalTime: 1560 })
})

test('manual Recipe scaling stays multiplier-first and shows known yield as context', async ({
	page,
	login,
}) => {
	const user = await login()
	const known = await prisma.recipe.create({
		data: {
			title: 'Twelve parcels',
			yieldAmount: 12,
			yieldLabel: 'pieces',
			userId: user.id,
			householdId: user.householdId,
		},
	})
	const unknown = await prisma.recipe.create({
		data: {
			title: 'Unknown family batch',
			yieldAmount: null,
			yieldLabel: null,
			userId: user.id,
			householdId: user.householdId,
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
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Long mid-cook Recipe',
			userId: user.id,
			householdId: user.householdId,
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

test('going back to phone Recipes lands on the old position without scrolling there', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.recipe.createMany({
		data: Array.from({ length: 30 }, (_, index) => ({
			title: `Weeknight Recipe ${index + 1}`,
			userId: user.id,
			householdId: user.householdId,
		})),
	})

	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/recipes')
	await expect(page.getByText('Weeknight Recipe 30')).toBeVisible()
	// Scrolls before hydration go unrecorded, so scroll again until one is.
	await expect(async () => {
		await page.evaluate(() => window.scrollTo(0, 0))
		await page.evaluate(() => window.scrollTo(0, 1200))
		await expect
			.poll(
				() => page.evaluate(() => sessionStorage.getItem('scroll:/recipes')),
				{ timeout: 500 },
			)
			.toBe('1200')
	}).toPass()
	// The first Recipe card fully on screen and clear of the pinned search
	// row by more than a row's scroll margin, so clicking it scrolls nothing.
	const href = await page.evaluate(
		() =>
			[...document.querySelectorAll<HTMLAnchorElement>('a[href^="/recipes/"]')]
				.find((link) => {
					const box = link.getBoundingClientRect()
					const bar =
						(document
							.querySelector('[data-recipes-tools]')
							?.getBoundingClientRect().bottom ?? 0) + 16
					return (
						link.textContent?.includes('Weeknight Recipe') &&
						box.height > 0 &&
						box.top >= bar &&
						box.left >= 0 &&
						box.bottom <= window.innerHeight &&
						box.right <= window.innerWidth &&
						link.contains(
							document.elementFromPoint(
								box.left + box.width / 2,
								box.top + box.height / 2,
							),
						)
					)
				})
				?.getAttribute('href') ?? null,
	)
	expect(href).not.toBeNull()
	await page.locator(`a[href="${href}"]`).click()
	expect(
		await page.evaluate(() => sessionStorage.getItem('scroll:/recipes')),
	).toBe('1200')
	await expect(page).toHaveURL(href!)
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)

	// Every scroll position on the way back is either the top of the Recipe
	// or the saved spot: a smooth restore passes through the ones between.
	await page.evaluate(() => {
		const seen: number[] = []
		;(window as unknown as { seenScrolls: number[] }).seenScrolls = seen
		window.addEventListener('scroll', () => seen.push(window.scrollY))
	})
	await page.goBack()
	await expect(page).toHaveURL(/\/recipes$/)
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200)
	const seen = await page.evaluate(
		() => (window as unknown as { seenScrolls: number[] }).seenScrolls,
	)
	expect(seen.length).toBeGreaterThan(0)
	expect(seen.filter((y) => y !== 0 && y !== 1200)).toEqual([])
})

test('Recipe instructions show passive cooking cues and ignore stored timers', async ({
	page,
	login,
}) => {
	const user = await login()
	const instruction = 'Preheat to 400°F, bake for 12 minutes, then rest 5 min.'
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Glanceable Roast',
			userId: user.id,
			householdId: user.householdId,
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
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Clipboard Soup',
			description: 'Not part of the clean copy.',
			rawText: 'Internal import data.',
			notes: 'Private cooking notes.',
			userId: user.id,
			householdId: user.householdId,
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
		announcements.getByText('Couldn’t copy the Recipe', { exact: true }),
	).toBeVisible()
})

test('a scaled Recipe counts its loaves, eggs and pinches in the plural, and back to one', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Banana bread',
			yieldAmount: 1,
			yieldLabel: 'loaf',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: [
					{ name: 'egg', amount: '1', order: 0 },
					{ name: 'salt', amount: '1', unit: 'pinch', order: 1 },
					{ name: 'plain flour', amount: '190', unit: 'g', order: 2 },
					{ name: 'garlic', amount: '2', unit: 'cloves', order: 3 },
					{ name: 'lime', amount: '1', notes: 'cut into wedges', order: 4 },
				],
			},
		},
	})
	const row = (name: string) =>
		page.getByRole('checkbox', { name, exact: true })

	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`/recipes/${recipe.id}`)
	await expect(page.getByText('Makes 1 loaf')).toBeVisible()
	await expect(row('egg')).toHaveText('1 egg')

	const trigger = page.getByRole('button', { name: 'Scale 1×' })
	const multiplier = page.getByLabel('Scale multiplier')
	await expect(async () => {
		if (!(await multiplier.isVisible())) await trigger.click()
		await expect(multiplier).toBeVisible({ timeout: 2000 })
	}).toPass({ timeout: 10_000 })
	await multiplier.fill('2')
	await multiplier.press('Enter')
	await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}\\?scale=2$`))

	await expect(page.getByText('Makes 2 loaves')).toBeVisible()
	await expect(row('egg')).toHaveText('2 eggs')
	await expect(row('salt')).toHaveText('2 pinches salt')
	await expect(row('plain flour')).toHaveText('380 g plain flour')
	await expect(row('garlic')).toHaveText('4 cloves garlic')
	await expect(row('lime')).toHaveText('2 limes, cut into wedges')

	// Halved, the two cloves are one again.
	await page.goto(`/recipes/${recipe.id}?scale=0.5`)
	await expect(page.getByText('Makes 0.5 loaf')).toBeVisible()
	await expect(row('garlic')).toHaveText('1 clove garlic')
	await expect(row('egg')).toHaveText('1/2 egg')
})

async function box(locator: Locator) {
	await expect(locator).toBeVisible()
	const rect = (await locator.boundingBox())!
	return {
		left: Math.round(rect.x),
		right: Math.round(rect.x + rect.width),
		top: Math.round(rect.y),
		bottom: Math.round(rect.y + rect.height),
	}
}

/** Within a pixel: glyph boxes land on half pixels. */
function expectNear(actual: number, expected: number) {
	expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1)
}

test.describe('on a phone', () => {
	// On a phone every row lines up on the page's edges: what leads a row (a
	// cooked circle, a checkbox, a step number, a small label, the first icon)
	// starts on the content edge, and the dots, trash and cart glyphs that end a
	// row end on it. 44px tap areas reach into the gutter instead of pushing the
	// glyphs in.
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

	test('a Recipe page starts its buttons, headings, amounts and steps on the content edge, and ends its glyphs on the other', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Weeknight Curry',
				userId: user.id,
				householdId: user.householdId,
				ingredients: {
					create: [
						{ name: 'chicken thighs', amount: '600', unit: 'g', order: 0 },
						{ name: 'yogurt', amount: '150', unit: 'ml', order: 1 },
					],
				},
				instructions: {
					create: [
						{ content: 'Marinate the chicken.', order: 0 },
						{ content: 'Simmer until done.', order: 1 },
					],
				},
			},
		})

		await page.goto(`/recipes/${recipe.id}`)
		const title = await box(
			page.getByRole('heading', { name: 'Weeknight Curry', level: 1 }),
		)
		const left = title.left

		expectNear(
			(await box(page.getByRole('button', { name: 'Add to Plan' }))).left,
			left,
		)
		expectNear(
			(await box(page.getByRole('heading', { name: 'Ingredients' }).first()))
				.left,
			left,
		)
		expectNear(
			(await box(page.getByRole('heading', { name: 'Instructions' }))).left,
			left,
		)

		// No check box: the amount column and the step numbers start on the
		// edge.
		const ingredient = page.getByRole('checkbox', { name: 'chicken thighs' })
		expectNear(
			(await box(ingredient.locator('[data-ingredient-amount]'))).left,
			left,
		)
		const step = page.getByRole('checkbox').filter({ hasText: 'Marinate' })
		expectNear((await box(step.locator('[data-step-number]'))).left, left)

		// The bar's last glyph ends on the content edge, as the cart's does.
		const right = (await box(page.getByRole('main'))).right - left
		expectNear(
			(
				await box(
					page
						.locator('[data-nav-bar]')
						.getByRole('button', { name: 'More actions' })
						.locator('svg'),
				)
			).right,
			right,
		)

		// The cart glyph ends on the content edge, under the Metric toggle's end.
		const metric = await box(page.getByRole('button', { name: 'Metric' }))
		const cart = await box(
			ingredient
				.getByRole('button', { name: 'Add to Shopping' })
				.locator('svg'),
		)
		expectNear(cart.right, metric.right)
	})
})
