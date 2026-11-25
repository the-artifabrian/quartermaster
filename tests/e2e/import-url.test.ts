import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
	E2E_MISSING_URL,
	E2E_PHOTO_RECIPE_URL,
	E2E_RECIPE_URL,
} from '#tests/mocks/recipe-pages.ts'
import { expect, hydrated, test } from '#tests/playwright-utils.ts'

const sharedUrl = `${E2E_RECIPE_URL}?utm_source=share`

function importPage(url: string) {
	return `/recipes/import?url=${encodeURIComponent(url)}`
}

function countFetches(page: Page) {
	const count = { fetches: 0 }
	page.on('request', (request) => {
		if (
			request.method() === 'POST' &&
			/\/recipes\/import/.test(request.url()) &&
			new URLSearchParams(request.postData() ?? '').get('intent') === 'fetch'
		)
			count.fetches++
	})
	return count
}

async function importSharedLink(page: Page, url: string) {
	await page.goto(importPage(url))
	await expect(
		page.getByRole('heading', { name: 'Import this Recipe?' }),
	).toBeVisible()
	await expect(page.getByText(url, { exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Import', exact: true }).click()
}

test('a shared URL waits for a tap, saves once and opens the Recipe; back skips the import, and a second share says it is saved before any tap', async ({
	page,
	login,
}) => {
	const user = await login()
	const count = countFetches(page)

	await page.goto('/recipes')
	// Any site can link here, so opening the link saves nothing by itself.
	await page.goto(importPage(sharedUrl))
	await expect(
		page.getByRole('heading', { name: 'Import this Recipe?' }),
	).toBeVisible()
	await expect(page.getByLabel('Recipe link', { exact: true })).toBeHidden()
	expect(count.fetches).toBe(0)
	expect(await prisma.recipe.count({ where: { userId: user.id } })).toBe(0)
	await page.getByRole('button', { name: 'Import', exact: true }).click()
	await expect(page).toHaveURL(/\/recipes\/(?!import)[a-z0-9]+$/)
	await expect(
		page.getByRole('heading', { name: 'Shared chickpea lunch', level: 1 }),
	).toBeVisible()
	// A clean import just opens the Recipe; the notice is for imports with
	// something to look at.
	await expect(
		page.getByRole('region', { name: 'Saved to your Recipes' }),
	).toHaveCount(0)
	expect(count.fetches).toBe(1)
	const recipes = await prisma.recipe.findMany({
		where: { userId: user.id },
		include: { ingredients: { orderBy: { order: 'asc' } }, instructions: true },
	})
	expect(recipes).toHaveLength(1)
	expect(recipes[0]).toMatchObject({
		title: 'Shared chickpea lunch',
		sourceUrl: sharedUrl,
		ingredients: [
			expect.objectContaining({ amount: '2', name: 'chickpeas' }),
			expect.objectContaining({ amount: '1', name: 'lemon' }),
		],
		instructions: [
			expect.objectContaining({
				content: 'Toss the chickpeas with lemon juice and serve.',
			}),
		],
	})

	// The tap replaced the shared link's entry and the save replaced Import, so
	// back skips both.
	await page.goBack()
	await expect(page).toHaveURL(/\/recipes$/)
	expect(count.fetches).toBe(1)

	await page.goto(importPage(sharedUrl))
	await expect(page.getByText('Already in your Recipes')).toBeVisible()
	await expect(
		page.getByText('It’s saved as “Shared chickpea lunch”.'),
	).toBeVisible()
	await expect(
		page.getByRole('heading', { name: 'Import this Recipe?' }),
	).toHaveCount(0)
	await expect(page.getByLabel('Recipe link', { exact: true })).toHaveValue('')
	expect(count.fetches).toBe(1)
	expect(await prisma.recipe.count({ where: { userId: user.id } })).toBe(1)
	await page.getByRole('link', { name: 'Open it', exact: true }).click()
	await expect(page).toHaveURL(`/recipes/${recipes[0]!.id}`)
})

test('a shared URL that fails to fetch stays on the filled URL tab', async ({
	page,
	login,
}) => {
	const user = await login()
	const count = countFetches(page)
	await importSharedLink(page, E2E_MISSING_URL)
	await expect(
		page.getByText('Couldn’t open that page (error 404)'),
	).toBeVisible()
	await expect(page.getByLabel('Recipe link', { exact: true })).toHaveValue(
		E2E_MISSING_URL,
	)
	await expect(page).toHaveURL(/\/recipes\/import$/)
	expect(count.fetches).toBe(1)
	expect(await prisma.recipe.count({ where: { userId: user.id } })).toBe(0)
})

test('a link whose page names a photo imports with that photo on the Recipe', async ({
	page,
	login,
}) => {
	const user = await login()
	await page.goto('/recipes/import')
	const link = page.getByLabel('Recipe link', { exact: true })
	await hydrated(link)
	await link.fill(E2E_PHOTO_RECIPE_URL)
	await page.getByRole('button', { name: 'Import', exact: true }).click()

	await expect(page).toHaveURL(/\/recipes\/(?!import)[a-z0-9]+$/)
	const recipeId = new URL(page.url()).pathname.split('/').at(-1)!
	const photo = page.getByRole('img', { name: 'Roast tomato soup' })
	await expect(photo).toBeVisible()
	// Visible is not loaded: the image route must have served the photo.
	await expect
		.poll(() =>
			photo.evaluate((element) => (element as HTMLImageElement).naturalWidth),
		)
		.toBeGreaterThan(0)

	const recipe = await prisma.recipe.findUniqueOrThrow({
		where: { id: recipeId },
		select: {
			userId: true,
			sourceUrl: true,
			image: { select: { objectKey: true } },
		},
	})
	expect(recipe).toMatchObject({
		userId: user.id,
		sourceUrl: E2E_PHOTO_RECIPE_URL,
	})
	expect(recipe.image?.objectKey).toMatch(
		new RegExp(`^users/${user.id}/recipes/${recipeId}/images/.+\\.jpg$`),
	)
	const stored = await fs.stat(
		path.join(
			process.cwd(),
			'tests/fixtures/uploaded',
			recipe.image!.objectKey,
		),
	)
	expect(stored.size).toBeLessThan(1024)
})
