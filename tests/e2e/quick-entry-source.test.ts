import { expect } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { test } from '#tests/playwright-utils.ts'

const chickpeaLine =
	'2 cans chickpeas, drained and rinsed thoroughly under cold running water (reserve the liquid for another recipe; if using dried chickpeas instead, soak them overnight and simmer until completely tender before measuring the equivalent cooked weight)'
const rawText = `Ingredients\n${chickpeaLine}\n1 lemon\nInstructions\nToss the chickpeas with lemon juice and serve.`

test('Quick Entry retains failed input, blocks pending repeats, and keeps saved source readable but collapsed', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Disposable Quick Entry check',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	try {
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto('/recipes/quick')
		await page
			.getByRole('textbox', { name: 'Recipe Text', exact: true })
			.fill(rawText)
		await page.getByRole('button', { name: 'Save Recipe', exact: true }).click()
		await expect(
			page.getByText('Title is required', { exact: true }),
		).toBeVisible()
		await expect(
			page.getByRole('textbox', { name: 'Recipe Text', exact: true }),
		).toHaveValue(rawText)
		const failureTitle = `Capture failure ${user.id}`
		await page
			.getByRole('textbox', { name: 'Title', exact: true })
			.fill(failureTitle)
		// Fail only this synthetic user's creates. This exercises the actual action's catch.
		await prisma.$executeRawUnsafe(
			`CREATE TRIGGER quick_entry_test_failure BEFORE INSERT ON Recipe WHEN NEW.userId = '${user.id}' BEGIN SELECT RAISE(ABORT, 'Disposable save failure'); END`,
		)
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		let saves = 0
		await page.route('**/recipes/quick.data', async (route) => {
			if (route.request().method() === 'POST') {
				saves++
				await gate
			}
			await route.continue()
		})
		await page.getByRole('button', { name: 'Save Recipe', exact: true }).click()
		await expect(
			page.getByRole('button', { name: 'Save Recipe', exact: true }),
		).toBeDisabled()
		await page
			.locator('form')
			.evaluate((form) => (form as HTMLFormElement).requestSubmit())
		release()
		await expect(
			page.getByText('We could not confirm the save.', { exact: false }),
		).toBeVisible()
		expect(saves).toBe(1)
		await expect(
			page.getByRole('textbox', { name: 'Title', exact: true }),
		).toHaveValue(failureTitle)
		await expect(
			page.getByRole('textbox', { name: 'Recipe Text', exact: true }),
		).toHaveValue(rawText)
		await prisma.$executeRawUnsafe('DROP TRIGGER quick_entry_test_failure')
		await page
			.getByRole('textbox', { name: 'Title', exact: true })
			.fill('Chickpea lunch')
		await page.getByRole('button', { name: 'Save Recipe', exact: true }).click()
		await expect(page).toHaveURL(/\/recipes\/(?!quick$)[a-z0-9]+$/)
		await page.reload()
		await expect(
			page.getByRole('heading', { name: 'Chickpea lunch', exact: true }),
		).toBeVisible()
		const source = page
			.locator('details')
			.filter({ has: page.locator('summary', { hasText: 'Original input' }) })
		await expect(source).not.toHaveAttribute('open', '')
		await expect(source.locator('pre')).toBeHidden()
		await source.locator('summary').click()
		await expect(source.locator('pre')).toHaveText(
			`Chickpea lunch\n\n${rawText}`,
		)
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true)
		const saved = await prisma.recipe.findFirstOrThrow({
			where: { householdId: household.id },
			include: { ingredients: true },
		})
		expect(saved.ingredients).toHaveLength(2)
		expect(
			saved.ingredients.find((i) => i.name === 'chickpeas')?.notes,
		).toContain('equivalent cooked weight')
		await page.setViewportSize({ width: 1280, height: 900 })
		await expect(source.locator('pre')).toBeVisible()
	} finally {
		await prisma.$executeRawUnsafe(
			'DROP TRIGGER IF EXISTS quick_entry_test_failure',
		)
		await prisma.household.delete({ where: { id: household.id } })
	}
})
