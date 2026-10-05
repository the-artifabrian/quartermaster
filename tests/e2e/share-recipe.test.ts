import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { expect, test } from '#tests/playwright-utils.ts'

const UPLOADS_DIR = 'tests/fixtures/uploaded'
// An 8x8 orange PNG. The page encodes the saved copy to AVIF on its first
// request, and a large fixture makes that take longer than the test waits on
// a loaded CI runner. A tiny source keeps the encode at a few milliseconds.
const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQI12N4UGWPFTEMLQkAHGBmQW+NP7cAAAAASUVORK5CYII=',
	'base64',
)

test('a saved shared Recipe keeps its picture after the source deletes theirs', async ({
	page,
	login,
}) => {
	const recipient = await login()
	const source = await prisma.user.create({ data: createUser() })
	const sourceHome = await prisma.household.create({
		data: {
			name: 'Source household',
			members: { create: { userId: source.id, role: 'owner' } },
		},
	})
	// The source's picture is an upload of its own, so its bytes can go away
	// the way a real delete removes them. A fixture image cannot be removed.
	const sourceUploads = path.join(UPLOADS_DIR, 'users', source.id)
	const sourceObjectKey = `users/${source.id}/recipes/source/images/carrots.png`
	await fs.mkdir(path.dirname(path.join(UPLOADS_DIR, sourceObjectKey)), {
		recursive: true,
	})
	await fs.writeFile(path.join(UPLOADS_DIR, sourceObjectKey), TINY_PNG)
	try {
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Roast carrots',
				userId: source.id,
				householdId: sourceHome.id,
				image: {
					create: {
						objectKey: sourceObjectKey,
						altText: 'Shared carrots picture',
					},
				},
				ingredients: {
					create: [{ name: 'carrots', amount: '1', unit: 'kg', order: 0 }],
				},
				instructions: { create: [{ content: 'Roast until sweet.', order: 0 }] },
			},
		})

		await page.goto(`/share/${recipe.id}`)
		await page.getByRole('button', { name: 'Save to My Recipes' }).click()
		await expect(page).toHaveURL(/\/recipes\/[a-z0-9]+$/)

		const saved = await prisma.recipe.findFirstOrThrow({
			where: { householdId: recipient.householdId, title: 'Roast carrots' },
			select: { id: true, image: { select: { objectKey: true } } },
		})
		// The copy owns its bytes: a key of its own, not the source's.
		expect(saved.image?.objectKey).toMatch(
			new RegExp(`^users/${recipient.id}/recipes/${saved.id}/images/`),
		)

		// The source deletes its Recipe: the row goes and so do its bytes.
		await prisma.recipe.delete({ where: { id: recipe.id } })
		await fs.rm(sourceUploads, { recursive: true, force: true })
		await page.reload()
		const image = page.getByRole('img', { name: 'Shared carrots picture' })
		await expect(image).toBeVisible()
		// Visible is not loaded: the copied image is encoded on first request.
		await expect
			.poll(() =>
				image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
			)
			.toBeGreaterThan(0)
	} finally {
		await fs.rm(path.join(UPLOADS_DIR, 'users', recipient.id), {
			recursive: true,
			force: true,
		})
		await fs.rm(sourceUploads, { recursive: true, force: true })
		await prisma.household.delete({ where: { id: sourceHome.id } })
		await prisma.user.delete({ where: { id: source.id } })
	}
})
