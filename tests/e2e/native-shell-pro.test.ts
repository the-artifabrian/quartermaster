import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { SAFARI_UA, SHELL_UA } from '#tests/native-shell.ts'
import { expect, test } from '#tests/playwright-utils.ts'

// Pro is a reference implementation of a Stripe subscription, and Apple
// rejects apps that point at buying outside the App Store (ADR 0001). The
// iOS app shows none of Pro: a free user sees its features absent rather
// than locked, and a Pro user keeps them.

async function createRecipe(user: { id: string; householdId: string }) {
	return prisma.recipe.create({
		data: {
			title: 'Lemon rice',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: { name: 'rice', amount: '200', unit: 'g', order: 0 },
			},
			instructions: { create: { content: 'Cook the rice.', order: 0 } },
		},
	})
}

// Opens the Recipe's overflow menu, retrying until the page has hydrated.
async function openMoreActions(page: Page) {
	const print = page.getByRole('menuitem', { name: 'Print recipe' })
	await expect(async () => {
		if (!(await print.isVisible())) {
			await page.getByRole('button', { name: 'More actions' }).click()
		}
		await expect(print).toBeVisible({ timeout: 2000 })
	}).toPass({ timeout: 10_000 })
}

const importTabs = ['From URL', 'From Text', 'From Image']

test.describe('in the iOS app', () => {
	test.use({ userAgent: SHELL_UA })

	test('a free user sees no Pro surface', async ({ page, login }) => {
		const user = await login()
		const recipe = await createRecipe(user)

		const upgrade = await page.goto('/upgrade')
		expect(upgrade?.status()).toBe(404)
		await expect(
			page.getByRole('heading', { name: 'Page not found' }),
		).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Upgrade your kitchen' }),
		).toHaveCount(0)

		await page.goto('/settings/profile')
		await expect(page.getByText('Tier', { exact: true })).toBeVisible()
		await expect(page.getByText('Free', { exact: true })).toBeVisible()
		await expect(page.locator('a[href="/upgrade"]')).toHaveCount(0)
		await expect(page.getByText(/subscri|stripe|billing/i)).toHaveCount(0)

		// Parsing pasted text is free; extracting with AI is Pro.
		await page.goto('/recipes/import')
		await expect(
			page.getByText('Import a recipe from a URL or paste text.'),
		).toBeVisible()
		await expect(page.getByLabel('Recipe URL')).toBeVisible()
		await expect(
			page.getByRole('button', { name: 'From Image', exact: true }),
		).toHaveCount(0)
		await expect(async () => {
			await page.getByRole('button', { name: 'From Text', exact: true }).click()
			await expect(page.getByLabel('Recipe text')).toBeVisible({
				timeout: 2000,
			})
		}).toPass({ timeout: 10_000 })
		await expect(
			page.getByRole('button', { name: 'Parse Recipe', exact: true }),
		).toBeVisible()
		await expect(page.getByText('Extract with AI')).toHaveCount(0)
		await expect(page.getByText(/\bPro\b/)).toHaveCount(0)
		await expect(page.locator('a[href="/upgrade"]')).toHaveCount(0)
		await expect(page.getByLabel(/Upload screenshots/)).toHaveCount(0)
		await page
			.getByLabel('Recipe text')
			.fill('Garlic toast\nIngredients\n2 slices bread\n1 clove garlic')
		await page
			.getByRole('button', { name: 'Parse Recipe', exact: true })
			.click()
		await expect(
			page.getByRole('heading', { name: 'Garlic toast', exact: true }),
		).toBeVisible()

		await page.goto(`/recipes/${recipe.id}`)
		await openMoreActions(page)
		await expect(
			page.getByRole('menuitem', { name: /Suggest description/ }),
		).toHaveCount(0)
		await page.keyboard.press('Escape')

		await page.goto('/shopping')
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
		await expect(page.getByRole('button', { name: 'Voice input' })).toHaveCount(
			0,
		)

		// The Pro-only resources answer the iOS app with a plain 403 rather than
		// a redirect to the upgrade page.
		for (const path of ['/resources/transcribe', '/resources/enhance-recipe']) {
			const response = await page.request.post(path, {
				headers: { 'User-Agent': SHELL_UA },
				form: { recipeId: recipe.id },
				maxRedirects: 0,
			})
			expect(response.status(), path).toBe(403)
			expect(response.headers()['location'], path).toBeUndefined()
		}
		expect(await prisma.usageEvent.count({ where: { userId: user.id } })).toBe(
			0,
		)
	})

	test('a Pro user keeps voice, enhance, and text and image import', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
		const recipe = await createRecipe(user)

		await page.goto('/recipes/import')
		for (const tab of importTabs) {
			await expect(
				page.getByRole('button', { name: tab, exact: true }),
			).toBeVisible()
		}
		await expect(async () => {
			await page.getByRole('button', { name: 'From Text', exact: true }).click()
			await expect(page.getByLabel('Recipe text')).toBeVisible({
				timeout: 2000,
			})
		}).toPass({ timeout: 10_000 })
		await expect(
			page.getByRole('button', { name: 'Extract with AI' }),
		).toBeVisible()
		await page.getByRole('button', { name: 'From Image', exact: true }).click()
		await expect(page.getByLabel(/Upload screenshots/)).toBeVisible()
		await expect(
			page.getByRole('button', { name: 'Extract with AI' }),
		).toBeVisible()

		await page.goto(`/recipes/${recipe.id}`)
		await openMoreActions(page)
		await expect(
			page.getByRole('menuitem', { name: 'Suggest description & times' }),
		).toBeVisible()
		await page.keyboard.press('Escape')

		await page.goto('/shopping')
		await expect(
			page.getByRole('button', { name: 'Voice input' }),
		).toBeVisible()

		await page.goto('/settings/profile')
		await expect(page.getByText('Pro', { exact: true })).toBeVisible()
		await expect(page.locator('a[href="/upgrade"]')).toHaveCount(0)
	})

	test('a Pro user whose Pro lapses sees enhance fail in place', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
		const recipe = await createRecipe(user)

		await page.goto(`/recipes/${recipe.id}`)
		await openMoreActions(page)
		await prisma.subscription.delete({ where: { userId: user.id } })
		await page
			.getByRole('menuitem', { name: 'Suggest description & times' })
			.click()

		await expect(
			page.getByText('Recipe enhancement is not available.'),
		).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Lemon rice', level: 1 }),
		).toBeVisible()
		await expect(page.getByText(/Forbidden/)).toHaveCount(0)
		expect(await prisma.usageEvent.count({ where: { userId: user.id } })).toBe(
			0,
		)
	})

	test('a trial about to end names the features, not Pro, and offers no upgrade', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'free',
				trialEndsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
			},
		})

		await page.goto('/recipes')

		await expect(
			page.getByText('Voice input and AI import end in 2 days', {
				exact: true,
			}),
		).toBeVisible()
		await expect(page.getByText(/\bPro\b|Subscribe/)).toHaveCount(0)
		await expect(page.getByRole('button', { name: 'Upgrade' })).toHaveCount(0)
	})

	test('the logged-out pages say nothing about the trial or Pro', async ({
		page,
	}) => {
		for (const path of ['/', '/signup']) {
			await page.goto(path)
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
			await expect(
				page.getByText(/14 days|credit card|free plan|upgrade|subscribe/i),
				path,
			).toHaveCount(0)
			await expect(page.getByText(/\bPro\b/), path).toHaveCount(0)
		}
	})
})

test.describe('in a browser', () => {
	test.use({ userAgent: SAFARI_UA })

	test('a free user still sees the upgrade page, its link, and every import tab', async ({
		page,
		login,
	}) => {
		const user = await login()
		await createRecipe(user)

		const upgrade = await page.goto('/upgrade')
		expect(upgrade?.status()).toBe(200)
		await expect(
			page.getByRole('heading', { name: 'Upgrade your kitchen' }),
		).toBeVisible()

		await page.goto('/settings/profile')
		await expect(
			page.getByRole('link', { name: /Subscription/ }),
		).toHaveAttribute('href', '/upgrade')

		await page.goto('/recipes/import')
		for (const tab of importTabs) {
			await expect(
				page.getByRole('button', { name: tab, exact: true }),
			).toBeVisible()
		}

		const response = await page.request.post('/resources/transcribe', {
			headers: { 'User-Agent': SAFARI_UA },
			maxRedirects: 0,
		})
		expect(response.status()).toBe(302)
		expect(response.headers()['location']).toBe('/upgrade')

		await page.context().clearCookies()
		for (const path of ['/', '/signup']) {
			await page.goto(path)
			await expect(
				page.getByText('Free for 14 days. No credit card needed.'),
				path,
			).toBeVisible()
		}
	})
})
