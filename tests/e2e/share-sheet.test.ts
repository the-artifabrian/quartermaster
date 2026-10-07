import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

declare global {
	interface Window {
		shareCalls: Array<ShareData>
	}
}

async function createRecipe(user: { id: string; householdId: string }) {
	return prisma.recipe.create({
		data: {
			title: 'Sheet Pan Gnocchi',
			userId: user.id,
			householdId: user.householdId,
			ingredients: { create: [{ name: 'gnocchi', order: 0 }] },
			instructions: { create: [{ content: 'Roast until golden.', order: 0 }] },
		},
	})
}

// Records every share() call and settles it the way the test asks: resolved
// for a finished share, or rejected with the named DOMException.
async function stubShareSheet(page: Page, rejectWith?: string) {
	await page.addInitScript((rejectName) => {
		window.shareCalls = []
		Object.defineProperty(Navigator.prototype, 'canShare', {
			configurable: true,
			value: () => true,
		})
		Object.defineProperty(Navigator.prototype, 'share', {
			configurable: true,
			value: (data: ShareData) => {
				window.shareCalls.push(data)
				return rejectName
					? Promise.reject(new DOMException('Share canceled', rejectName))
					: Promise.resolve()
			},
		})
	}, rejectWith)
}

// The handler has finished with the share when a later Copy Recipe toast
// shows, so an absent share toast is really absent and not just late. That
// barrier holds only because the share stub settles in a microtask and every
// caller first polls shareCalls, so the share has already settled by the tap.
async function expectNoShareToast(page: Page) {
	await page.getByRole('button', { name: 'Copy Recipe' }).click()
	const announcements = page.getByRole('region', { name: /Notifications/ })
	await expect(announcements.getByText('Copied', { exact: true })).toBeVisible()
	await expect(announcements.getByText('Public link copied')).toHaveCount(0)
	await expect(announcements.getByText(/Unable to copy —/)).toHaveCount(0)
}

test('Share opens the system share sheet with the Recipe title and public link', async ({
	page,
	login,
}) => {
	const recipe = await createRecipe(await login())
	await stubShareSheet(page)
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.goto(`/recipes/${recipe.id}`)

	await page.getByRole('button', { name: 'Share recipe' }).click()
	const origin = new URL(page.url()).origin
	await expect
		.poll(() => page.evaluate(() => window.shareCalls))
		.toEqual([
			{ title: 'Sheet Pan Gnocchi', url: `${origin}/share/${recipe.id}` },
		])
	await expectNoShareToast(page)
})

test('a cancelled share sheet stays silent', async ({ page, login }) => {
	const recipe = await createRecipe(await login())
	await stubShareSheet(page, 'AbortError')
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.goto(`/recipes/${recipe.id}`)

	await page.getByRole('button', { name: 'Share recipe' }).click()
	await expect.poll(() => page.evaluate(() => window.shareCalls.length)).toBe(1)
	await expectNoShareToast(page)
})

test('a second tap while the share sheet is open is ignored', async ({
	page,
	login,
}) => {
	const recipe = await createRecipe(await login())
	// The sheet stays open until the test closes it. Safari rejects a second
	// share() with InvalidStateError meanwhile; this stub just records it.
	await page.addInitScript(() => {
		window.shareCalls = []
		Object.defineProperty(Navigator.prototype, 'share', {
			configurable: true,
			value: (data: ShareData) => {
				window.shareCalls.push(data)
				return new Promise<void>((resolve) => {
					;(window as unknown as { closeSheet: () => void }).closeSheet =
						resolve
				})
			},
		})
	})
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.goto(`/recipes/${recipe.id}`)

	const share = page.getByRole('button', { name: 'Share recipe' })
	await share.click()
	await share.click()
	expect(await page.evaluate(() => window.shareCalls.length)).toBe(1)
	await page.evaluate(() =>
		(window as unknown as { closeSheet: () => void }).closeSheet(),
	)
	await expectNoShareToast(page)
})

test('a share sheet that fails still copies the public link', async ({
	page,
	login,
}) => {
	const recipe = await createRecipe(await login())
	await stubShareSheet(page, 'NotAllowedError')
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.goto(`/recipes/${recipe.id}`)

	await page.getByRole('button', { name: 'Share recipe' }).click()
	await expect(page.getByText('Public link copied')).toBeVisible()
	const origin = new URL(page.url()).origin
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		`${origin}/share/${recipe.id}`,
	)
})

test('without a share sheet, Share copies the public link', async ({
	page,
	login,
}) => {
	const recipe = await createRecipe(await login())
	await page.addInitScript(() => {
		delete (Navigator.prototype as Partial<Navigator>).share
		delete (Navigator.prototype as Partial<Navigator>).canShare
	})
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.goto(`/recipes/${recipe.id}`)
	expect(await page.evaluate(() => 'share' in navigator)).toBe(false)

	await page.getByRole('button', { name: 'Share recipe' }).click()
	await expect(page.getByText('Public link copied')).toBeVisible()
	const origin = new URL(page.url()).origin
	const link = await page.evaluate(() => navigator.clipboard.readText())
	expect(link).toBe(`${origin}/share/${recipe.id}`)

	// The copied link opens the public Recipe.
	await page.goto(link)
	await expect(
		page.getByRole('heading', { name: 'Sheet Pan Gnocchi' }),
	).toBeVisible()
})

test('Share on a Menu opens the system share sheet with its title and public link', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createRecipe(user)
	const menu = await prisma.menu.create({
		data: {
			title: 'Friday Supper',
			titleKey: 'friday supper',
			householdId: user.householdId,
			sections: {
				create: {
					items: {
						create: {
							kind: 'recipe',
							recipeId: recipe.id,
							recipeTitle: recipe.title,
							scaleMultiplier: 1,
							order: 0,
						},
					},
				},
			},
		},
	})
	await stubShareSheet(page)
	await page.goto(`/recipes/menus/${menu.id}`)

	await page.getByRole('button', { name: 'Share', exact: true }).click()
	const origin = new URL(page.url()).origin
	await expect
		.poll(() => page.evaluate(() => window.shareCalls))
		.toEqual([
			{ title: 'Friday Supper', url: `${origin}/share/menus/${menu.id}` },
		])
})
