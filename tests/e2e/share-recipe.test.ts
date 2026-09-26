import fs from 'node:fs/promises'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { expect, test } from '#tests/playwright-utils.ts'

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
	try {
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Roast carrots',
				userId: source.id,
				householdId: sourceHome.id,
				image: {
					create: {
						objectKey: 'notes/1.png',
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

		await prisma.recipe.delete({ where: { id: recipe.id } })
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
		await fs.rm(`tests/fixtures/uploaded/users/${recipient.id}`, {
			recursive: true,
			force: true,
		})
		await prisma.household.delete({ where: { id: sourceHome.id } })
		await prisma.user.delete({ where: { id: source.id } })
	}
})
