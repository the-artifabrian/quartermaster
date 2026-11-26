import { type Locator } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

// Titles are in the serif; the names people read in rows are in the sans,
// upright, at weight 500.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const SANS = 'Schibsted Grotesk normal 500'
const SERIF = 'Newsreader normal 500'

function face(locator: Locator) {
	return locator.evaluate((el) => {
		const style = getComputedStyle(el)
		const family = style.fontFamily.split(',')[0]!.replace(/['"]/g, '')
		return `${family} ${style.fontStyle} ${style.fontWeight}`
	})
}

async function seed(user: { id: string; householdId: string }) {
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Lemon pasta',
			userId: user.id,
			householdId: user.householdId,
		},
		select: { id: true, title: true },
	})
	await prisma.menu.create({
		data: {
			title: 'Mezze night',
			titleKey: 'mezze night',
			householdId: user.householdId,
		},
	})
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: { create: { name: 'lemons' } },
		},
	})
	await prisma.mealPlan.create({
		data: {
			householdId: user.householdId,
			weekStart: new Date('2026-10-19'),
			meals: {
				create: [
					{
						date: new Date('2026-10-21'),
						order: 0,
						recipeItems: {
							create: {
								recipeId: recipe.id,
								recipeTitle: recipe.title,
								order: 0,
							},
						},
					},
					{
						date: new Date('2026-10-21'),
						order: 1,
						genericText: 'Leftovers',
					},
				],
			},
		},
	})
}

test('Shopping keeps its title in the serif and its items in the sans', async ({
	page,
	login,
}) => {
	await seed(await login())
	await page.goto('/shopping')
	expect(await face(page.getByRole('heading', { level: 1 }))).toBe(SERIF)
	expect(await face(page.getByText('lemons', { exact: true }))).toBe(SANS)
})

test('the Recipes list keeps its title in the serif and its rows in the sans', async ({
	page,
	login,
}) => {
	await seed(await login())
	await page.goto('/recipes')
	expect(
		await face(page.getByRole('heading', { level: 1, name: 'Recipes' })),
	).toBe(SERIF)
	expect(await face(page.getByRole('heading', { name: 'Lemon pasta' }))).toBe(
		SANS,
	)
})

test('the Menus list sets its rows in the sans', async ({ page, login }) => {
	await seed(await login())
	await page.goto('/recipes/menus')
	expect(await face(page.getByRole('heading', { name: 'Mezze night' }))).toBe(
		SANS,
	)
})

test('Plan keeps its title and day heading in the serif, its dishes in the sans, and a typed Meal upright and muted', async ({
	page,
	login,
}) => {
	await seed(await login())
	await page.goto('/plan?weekStart=2026-10-19&day=2026-10-21')
	const day = page.getByTestId('mobile-plan')
	expect(await face(page.getByRole('heading', { level: 1 }))).toBe(SERIF)
	expect(await face(day.getByRole('heading', { level: 2 }).first())).toBe(SERIF)
	expect(await face(day.getByText('Lemon pasta', { exact: true }))).toBe(SANS)
	// A typed Meal is muted at the running weight, so it stays apart from a
	// Recipe's name.
	const typed = day.getByText('Leftovers', { exact: true })
	expect(await face(typed)).toBe('Schibsted Grotesk normal 400')
	await expect(typed).toHaveCSS('color', 'rgb(105, 102, 94)')
})
