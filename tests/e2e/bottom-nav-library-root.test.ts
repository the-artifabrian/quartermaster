import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 } })

function tab(page: Page, name: 'Recipes' | 'Shopping') {
	return page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name, exact: true })
}

function librarySwitch(page: Page, name: 'Recipes' | 'Menus') {
	return page
		.getByRole('navigation', { name: 'Library' })
		.getByRole('link', { name, exact: true })
}

test('a re-tap on Recipes pops to the library the page was opened from', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: { title: 'Hummus', userId: user.id, householdId: user.householdId },
		select: { id: true },
	})
	const menu = await prisma.menu.create({
		data: {
			title: 'Mezze night',
			titleKey: 'mezze night',
			householdId: user.householdId,
			sections: {
				create: {
					items: {
						create: {
							kind: 'recipe',
							recipeId: recipe.id,
							recipeTitle: 'Hummus',
							order: 0,
						},
					},
				},
			},
		},
		select: { id: true },
	})

	// Menus list → Menu → its Recipe: the tab pops back to Menus.
	await page.goto('/recipes')
	await librarySwitch(page, 'Menus').click()
	await expect(page).toHaveURL('/recipes/menus')
	await page.getByRole('link', { name: /Mezze night/ }).click()
	await expect(page).toHaveURL(`/recipes/menus/${menu.id}`)
	await page.getByRole('link', { name: /Hummus/ }).click()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	await expect(tab(page, 'Recipes')).toHaveAttribute('href', '/recipes/menus')
	await tab(page, 'Recipes').click()
	await expect(page).toHaveURL('/recipes/menus')
	await expect(page.getByRole('heading', { name: /My Menus/ })).toBeVisible()

	// Leaving for another tab and coming back restores the page and keeps
	// its Menus root.
	await page.getByRole('link', { name: /Mezze night/ }).click()
	// The Menu card on the list names its Recipes too, so wait for the Menu
	// page before looking for the Recipe link.
	await expect(page).toHaveURL(`/recipes/menus/${menu.id}`)
	await page.getByRole('link', { name: /Hummus/ }).click()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	await tab(page, 'Shopping').click()
	await expect(page).toHaveURL('/shopping')
	await tab(page, 'Recipes').click()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	await tab(page, 'Recipes').click()
	await expect(page).toHaveURL('/recipes/menus')

	// The same Recipe opened from the Recipes list pops back to Recipes.
	await librarySwitch(page, 'Recipes').click()
	await expect(page).toHaveURL('/recipes')
	await page.getByRole('link', { name: 'Hummus recipe' }).click()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	await tab(page, 'Recipes').click()
	await expect(page).toHaveURL('/recipes')
	await expect(page.getByRole('heading', { name: /My Recipes/ })).toBeVisible()
})
