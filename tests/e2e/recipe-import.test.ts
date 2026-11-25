import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import {
	expect,
	expectThumbTall,
	tapUntil,
	test,
} from '#tests/playwright-utils.ts'

const original = `Chickpea lunch
Ingredients
2 cans chickpeas, drained and rinsed thoroughly under cold running water (reserve the liquid for another recipe; if using dried chickpeas instead, soak them overnight and simmer until completely tender before measuring the equivalent cooked weight)
1 lemon
Instructions
Toss the chickpeas with lemon juice and serve.`

// The notice's params leave the address as soon as the Recipe opens.
const savedRecipeUrl = /\/recipes\/(?!import)[a-z0-9]+$/

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
	await page.getByRole('tab', { name: 'From text', exact: true }).click()
	await page.getByLabel('Recipe text', { exact: true }).fill(original)
	await page
		.getByRole('button', { name: 'Read as written', exact: true })
		.click()

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

	await notice.getByRole('button', { name: 'Undo', exact: true }).click()
	await page
		.getByRole('dialog', { name: 'Undo this import?' })
		.getByRole('button', { name: 'Delete Recipe' })
		.click()
	await expect(page).toHaveURL(/\/recipes\/import$/)
	await expect(page.getByText('Removed Chickpea lunch')).toBeVisible()
	expect(
		await prisma.recipe.findMany({
			where: { userId: user.id },
			select: { id: true },
		}),
	).toEqual([{ id: older.id }])
})

test('the notice shows once: not on the Recipe it links to, after Back, or on a reload; Back skips the import', async ({
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
	await page.goto('/recipes')
	await page.goto('/recipes/import')
	await page.getByRole('tab', { name: 'From text', exact: true }).click()
	await page.getByLabel('Recipe text', { exact: true }).fill(original)
	await page
		.getByRole('button', { name: 'Read as written', exact: true })
		.click()
	const notice = page.getByRole('region', { name: 'Saved to your Recipes' })
	await expect(notice).toBeVisible()
	const saved = await prisma.recipe.findFirstOrThrow({
		where: { userId: user.id, id: { not: older.id } },
		select: { id: true },
	})
	await expect(page).toHaveURL(`/recipes/${saved.id}`)

	// Same title, so only the address tells the two Recipes apart.
	await notice.getByRole('link', { name: 'Open it' }).click()
	await expect(page).toHaveURL(`/recipes/${older.id}`)
	await expect(
		page.getByRole('heading', { name: 'Chickpea lunch', level: 1 }),
	).toBeVisible()
	await expect(notice).toHaveCount(0)
	await page.goBack()
	await expect(page).toHaveURL(`/recipes/${saved.id}`)
	await expect(
		page.getByRole('heading', { name: 'Chickpea lunch', level: 1 }),
	).toBeVisible()
	await expect(notice).toHaveCount(0)

	await page.reload()
	await expect(
		page.getByRole('heading', { name: 'Chickpea lunch', level: 1 }),
	).toBeVisible()
	await expect(notice).toHaveCount(0)

	// The import replaced its own history entry: Back skips the form.
	await page.goBack()
	await expect(page).toHaveURL(/\/recipes$/)
	await page.goForward()
	await expect(page).toHaveURL(`/recipes/${saved.id}`)
	await expect(
		page.getByRole('heading', { name: 'Chickpea lunch', level: 1 }),
	).toBeVisible()
	await expect(notice).toHaveCount(0)
})

test('an import missing its steps saves, says so, and Edit adds them; the notice can be dismissed', async ({
	page,
	login,
}) => {
	const user = await login()
	await page.goto('/recipes/import')
	await page.getByRole('tab', { name: 'From text', exact: true }).click()
	await page
		.getByLabel('Recipe text', { exact: true })
		.fill('Lemon\nIngredients\n1 lemon')
	await page
		.getByRole('button', { name: 'Read as written', exact: true })
		.click()

	await expect(page).toHaveURL(savedRecipeUrl)
	const notice = page.getByRole('region', { name: 'Saved to your Recipes' })
	await expect(notice).toContainText(
		'We couldn’t find the instructions. Add them with Edit.',
	)
	await notice.getByRole('link', { name: 'Edit', exact: true }).click()
	await expect(page).toHaveURL(/\/recipes\/[a-z0-9]+\/edit$/)
	await page.getByPlaceholder('Step 1').fill('Squeeze the lemon.')
	await page.getByRole('button', { name: 'Save', exact: true }).click()
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
	await page.getByRole('tab', { name: 'From text', exact: true }).click()
	await page
		.getByLabel('Recipe text', { exact: true })
		.fill('Toast\nIngredients\n1 slice bread')
	await page
		.getByRole('button', { name: 'Read as written', exact: true })
		.click()
	await expect(page).toHaveURL(savedRecipeUrl)
	await expect(notice).toContainText('We couldn’t find the instructions.')
	await notice.getByRole('button', { name: 'Dismiss' }).click()
	await expect(notice).toHaveCount(0)
	await page.reload()
	await expect(
		page.getByRole('heading', { name: 'Toast', level: 1 }),
	).toBeVisible()
	await expect(notice).toHaveCount(0)
})

test('a clean import just opens the Recipe: no notice, one saved haptic', async ({
	page,
	login,
}) => {
	// The iOS app's haptic handler, recording what the page posts to it.
	await page.addInitScript(() => {
		const messages: string[] = []
		Object.assign(window, {
			__haptics: messages,
			webkit: {
				messageHandlers: {
					haptic: { postMessage: (kind: string) => messages.push(kind) },
				},
			},
		})
	})
	const user = await login()
	await page.goto('/recipes/import')
	await page.getByRole('tab', { name: 'From text', exact: true }).click()
	await page
		.getByLabel('Recipe text', { exact: true })
		.fill('Toast\nIngredients\n1 slice bread\nInstructions\nToast it.')
	await page
		.getByRole('button', { name: 'Read as written', exact: true })
		.click()

	await expect(page).toHaveURL(savedRecipeUrl)
	await expect(
		page.getByRole('heading', { name: 'Toast', level: 1 }),
	).toBeVisible()
	await expect(
		page.getByRole('region', { name: 'Saved to your Recipes' }),
	).toHaveCount(0)
	// The From Text tab ticked as it was picked; the save lands once.
	await expect
		.poll(() =>
			page.evaluate(
				() => (window as unknown as { __haptics: string[] }).__haptics,
			),
		)
		.toEqual(['selection', 'success'])
	expect(
		await prisma.recipe.findFirstOrThrow({
			where: { userId: user.id },
			include: { ingredients: true, instructions: true },
		}),
	).toMatchObject({
		title: 'Toast',
		ingredients: [
			expect.objectContaining({
				amount: '1',
				name: expect.stringContaining('bread'),
			}),
		],
		instructions: [expect.objectContaining({ content: 'Toast it.' })],
	})
})

test('an import that had to shorten its title still shows the notice', async ({
	page,
	login,
}) => {
	await login()
	const title = `Slow roasted tomato soup ${'with basil '.repeat(10)}`.trim()
	expect(title.length).toBeGreaterThan(100)
	await page.goto('/recipes/import')
	await page.getByRole('tab', { name: 'From text', exact: true }).click()
	await page
		.getByLabel('Recipe text', { exact: true })
		.fill(`${title}\nIngredients\n4 tomatoes\nInstructions\nRoast them.`)
	await page
		.getByRole('button', { name: 'Read as written', exact: true })
		.click()

	await expect(page).toHaveURL(savedRecipeUrl)
	await expect(
		page.getByRole('region', { name: 'Saved to your Recipes' }),
	).toContainText('We shortened the title to fit.')
})

test('text with neither ingredients nor steps saves nothing and keeps what was pasted', async ({
	page,
	login,
}) => {
	const user = await login()
	await page.goto('/recipes/import')
	await page.getByRole('tab', { name: 'From text', exact: true }).click()
	const text = 'Family notes\nServe with whatever greens are left.'
	await page.getByLabel('Recipe text', { exact: true }).fill(text)
	await page
		.getByRole('button', { name: 'Read as written', exact: true })
		.click()
	await expect(page.getByText(/Couldn’t find a Recipe/)).toBeVisible()
	await expect(page.getByLabel('Recipe text', { exact: true })).toHaveValue(
		text,
	)
	expect(await prisma.recipe.count({ where: { userId: user.id } })).toBe(0)
})

test('a Pro user out of AI imports for the day is told so and nothing is saved', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
	await prisma.usageEvent.createMany({
		data: Array.from({ length: 10 }, () => ({
			type: 'recipe_extract_llm_call',
			userId: user.id,
		})),
	})
	await page.goto('/recipes/import')
	await expect(async () => {
		await page.getByRole('tab', { name: 'From text', exact: true }).click()
		await expect(page.getByLabel('Recipe text', { exact: true })).toBeVisible({
			timeout: 2000,
		})
	}).toPass({ timeout: 10_000 })
	await page.getByLabel('Recipe text', { exact: true }).fill(original)
	await page.getByRole('button', { name: 'Read with AI' }).click()

	await expect(
		page.getByText("You've used today's 10 AI imports. Try again tomorrow."),
	).toBeVisible()
	await expect(page.getByLabel('Recipe text', { exact: true })).toHaveValue(
		original,
	)
	expect(await prisma.recipe.count({ where: { userId: user.id } })).toBe(0)
	expect(await prisma.usageEvent.count({ where: { userId: user.id } })).toBe(10)
})

async function importTab(page: Page, name: string) {
	return page
		.getByRole('tablist', { name: 'Import from' })
		.getByRole('tab', { name, exact: true })
}

/** Whether the sage pill now sits under `tab`. */
async function pillUnder(pill: Locator, tab: Locator) {
	const [p, t] = await Promise.all([pill.boundingBox(), tab.boundingBox()])
	const center = p!.x + p!.width / 2
	return center > t!.x && center < t!.x + t!.width
}

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

	test('Import switches between URL and pasted text with a segmented control', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/recipes/import')
		const tablist = page.getByRole('tablist', { name: 'Import from' })
		const pill = tablist.locator('[data-slot="segmented-pill"]')
		const fromUrl = await importTab(page, 'From link')
		const fromText = await importTab(page, 'From text')
		const fromImage = await importTab(page, 'From image')
		await expect(fromUrl).toHaveAttribute('aria-selected', 'true')
		await expect(fromText).toHaveAttribute('aria-selected', 'false')
		await expectThumbTall(fromText)
		expect(await pillUnder(pill, fromUrl)).toBe(true)
		await expect(
			page.getByRole('tabpanel', { name: 'From link' }),
		).toContainText('Recipe link')

		await tapUntil(fromText, () =>
			expect(page.getByLabel('Recipe text')).toBeVisible({ timeout: 2000 }),
		)
		await expect(fromText).toHaveAttribute('aria-selected', 'true')
		await expect(fromUrl).toHaveAttribute('aria-selected', 'false')
		await expect(page.getByLabel('Recipe link')).toHaveCount(0)
		await expect(
			page.getByRole('tabpanel', { name: 'From text' }),
		).toContainText('Recipe text')
		await expect.poll(() => pillUnder(pill, fromText)).toBe(true)

		await fromUrl.tap()
		await expect(page.getByLabel('Recipe link')).toBeVisible()
		await expect(fromUrl).toHaveAttribute('aria-selected', 'true')
		await expect.poll(() => pillUnder(pill, fromUrl)).toBe(true)

		// From the keyboard: Left/Right and Home/End move a row of tabs; Up/Down
		// leave it alone.
		await fromUrl.focus()
		await page.keyboard.press('ArrowRight')
		await expect(fromText).toHaveAttribute('aria-selected', 'true')
		await expect(fromText).toBeFocused()
		await expect(page.getByLabel('Recipe text')).toBeVisible()
		await page.keyboard.press('ArrowDown')
		await expect(fromText).toHaveAttribute('aria-selected', 'true')
		await page.keyboard.press('End')
		await expect(fromImage).toHaveAttribute('aria-selected', 'true')
		await expect(fromImage).toBeFocused()
		await page.keyboard.press('Home')
		await expect(fromUrl).toHaveAttribute('aria-selected', 'true')
		await expect.poll(() => pillUnder(pill, fromUrl)).toBe(true)
	})
})
