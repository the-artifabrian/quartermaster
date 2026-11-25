import fs from 'node:fs/promises'
import path from 'node:path'
import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { SITE_DESCRIPTION } from '#app/utils/site-description.ts'
import { createUser, expect, test } from '#tests/playwright-utils.ts'

/* eslint-disable playwright/no-raw-locators -- this test inspects document head metadata */

// Root's error page has no origin, so it must not write a relative og:image.
// app/utils/meta.test.ts covers that, since a page can't reach it.
// A link to a public page, pasted into Slack, LinkedIn or iMessage, unfurls
// with the preview image. Each marketing page's meta replaces root's, so each
// one has to carry the image tags itself.
for (const pagePath of ['/', '/about', '/support', '/privacy', '/tos']) {
	test(`${pagePath} links unfurl with the preview image`, async ({ page }) => {
		await page.goto(pagePath)

		const ogImage = page.locator('meta[property="og:image"]')
		await expect(ogImage).toHaveCount(1)
		const imageUrl = await ogImage.getAttribute('content')
		// The build fingerprints the image, so a new one gets a new URL and
		// sites that cache previews by URL fetch it again.
		expect(imageUrl).toMatch(/^https?:\/\/.+\/assets\/og-image-[\w-]+\.png$/)
		await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
			'content',
			'summary_large_image',
		)

		const image = await page.request.get(new URL(imageUrl!).pathname)
		expect(image.ok()).toBe(true)
		expect(image.headers()['content-type']).toBe('image/png')
	})
}

// The homepage and any page that falls back to root's meta (here the 404
// page) describe the site in the same words as the install sheet, and preview
// with the full-size image.
for (const pagePath of ['/', '/no-such-page']) {
	test(`${pagePath} describes the site and previews at full size`, async ({
		page,
	}) => {
		await page.goto(pagePath)

		await expect(page.locator('meta[name="description"]')).toHaveAttribute(
			'content',
			SITE_DESCRIPTION,
		)
		await expect(
			page.locator('meta[property="og:description"]'),
		).toHaveAttribute('content', SITE_DESCRIPTION)
		await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
			'content',
			'Quartermaster',
		)

		const imageUrl = new URL(
			(await page
				.locator('meta[property="og:image"]')
				.getAttribute('content'))!,
		)
		const image = await page.request.get(imageUrl.pathname)
		expect(image.ok()).toBe(true)
		expect(image.headers()['content-type']).toBe('image/png')
		// A PNG keeps its width and height in the IHDR chunk, at bytes 16 to 23.
		const png = await image.body()
		expect({
			width: png.readUInt32BE(16),
			height: png.readUInt32BE(20),
		}).toEqual({ width: 1200, height: 630 })
	})
}

const UPLOADS_DIR = 'tests/fixtures/uploaded'
// An 8x8 PNG, so making the 1200×630 preview takes milliseconds on a slow
// runner.
const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQI12N4UGWPFTEMLQkAHGBmQW+NP7cAAAAASUVORK5CYII=',
	'base64',
)

/** A Recipe with a photo, in the given Household or a new one. */
async function recipeWithPhoto(householdId?: string) {
	const owner = householdId
		? await prisma.householdMember.findFirstOrThrow({
				where: { householdId },
				select: { userId: true },
			})
		: { userId: (await prisma.user.create({ data: createUser() })).id }
	const home =
		householdId ??
		(
			await prisma.household.create({
				data: {
					name: 'Preview household',
					members: { create: { userId: owner.userId, role: 'owner' } },
				},
			})
		).id
	const objectKey = `users/${owner.userId}/recipes/preview/images/carrots.png`
	await fs.mkdir(path.dirname(path.join(UPLOADS_DIR, objectKey)), {
		recursive: true,
	})
	await fs.writeFile(path.join(UPLOADS_DIR, objectKey), TINY_PNG)
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Roast carrots',
			userId: owner.userId,
			householdId: home,
			image: { create: { objectKey, altText: 'Carrots' } },
			ingredients: {
				create: [{ name: 'carrots', amount: '1', unit: 'kg', order: 0 }],
			},
			instructions: { create: [{ content: 'Roast until sweet.', order: 0 }] },
		},
		select: { id: true },
	})
	return {
		id: recipe.id,
		removePhoto: () =>
			fs.rm(path.join(UPLOADS_DIR, 'users', owner.userId), {
				recursive: true,
				force: true,
			}),
	}
}

/** The page's og:image, which must load as an image. */
async function expectPreviewImage(page: Page) {
	const ogImage = page.locator('meta[property="og:image"]')
	await expect(ogImage).toHaveCount(1)
	const imageUrl = new URL((await ogImage.getAttribute('content'))!)
	expect(imageUrl.pathname).toBe('/resources/images')
	await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
		'content',
		'summary_large_image',
	)
	const image = await page.request.get(imageUrl.pathname + imageUrl.search)
	expect(image.ok()).toBe(true)
	expect(image.headers()['content-type']).toMatch(/^image\//)
}

test('a shared Recipe link unfurls with its photo', async ({ page }) => {
	const recipe = await recipeWithPhoto()
	try {
		await page.goto(`/share/${recipe.id}`)
		await expectPreviewImage(page)
		// The share page's own title and description, not the site's.
		await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
			'content',
			'Roast carrots | Quartermaster',
		)
		await expect(page.locator('meta[name="description"]')).toHaveAttribute(
			'content',
			'View recipe for Roast carrots',
		)
	} finally {
		await recipe.removePhoto()
	}
})

test('a Recipe page carries its photo as the preview image', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await recipeWithPhoto(user.householdId)
	try {
		await page.goto(`/recipes/${recipe.id}`)
		await expectPreviewImage(page)
	} finally {
		await recipe.removePhoto()
	}
})
