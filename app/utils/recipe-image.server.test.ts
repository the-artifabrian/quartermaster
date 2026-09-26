import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { deleteRecipeImageUnlessShared } from './recipe-image.server.ts'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

const UPLOADS_DIR = path.join(process.cwd(), 'tests/fixtures/uploaded')

/** An object in the mock bucket that removes its upload folder on dispose. */
async function uploadedObject(userId: string) {
	const objectKey = `users/${userId}/recipes/shared/images/photo.png`
	const filePath = path.join(UPLOADS_DIR, objectKey)
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, 'png bytes')
	return {
		objectKey,
		filePath,
		async [Symbol.asyncDispose]() {
			await fs.rm(path.join(UPLOADS_DIR, 'users', userId), {
				recursive: true,
				force: true,
			})
		},
	}
}

async function recipeWithImage(objectKey: string) {
	const user = await prisma.user.create({ data: createUser() })
	const household = await prisma.household.create({
		data: {
			name: 'Home',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Pictured',
			userId: user.id,
			householdId: household.id,
			image: { create: { objectKey, altText: null } },
		},
		select: { id: true },
	})
	return { userId: user.id, recipeId: recipe.id }
}

const exists = (filePath: string) =>
	fs.access(filePath).then(
		() => true,
		() => false,
	)

describe('deleteRecipeImageUnlessShared', () => {
	test('keeps the object while another Recipe still shows it', async () => {
		const owner = await prisma.user.create({ data: createUser() })
		await using object = await uploadedObject(owner.id)
		const { objectKey, filePath } = object
		const original = await recipeWithImage(objectKey)
		await recipeWithImage(objectKey)

		const deleted = await deleteRecipeImageUnlessShared(objectKey, {
			exceptRecipeId: original.recipeId,
		})

		expect(deleted).toBe(false)
		expect(await exists(filePath)).toBe(true)
	})

	test('removes the object when the deleting Recipe holds the last reference', async () => {
		const owner = await prisma.user.create({ data: createUser() })
		await using object = await uploadedObject(owner.id)
		const { objectKey, filePath } = object
		const only = await recipeWithImage(objectKey)

		const deleted = await deleteRecipeImageUnlessShared(objectKey, {
			exceptRecipeId: only.recipeId,
		})

		expect(deleted).toBe(true)
		expect(await exists(filePath)).toBe(false)
	})

	test('removes an object no Recipe references', async () => {
		const owner = await prisma.user.create({ data: createUser() })
		await using object = await uploadedObject(owner.id)
		const { objectKey, filePath } = object

		expect(await deleteRecipeImageUnlessShared(objectKey)).toBe(true)
		expect(await exists(filePath)).toBe(false)
	})

	test('without an excepted Recipe, any stored reference keeps the object', async () => {
		const owner = await prisma.user.create({ data: createUser() })
		await using object = await uploadedObject(owner.id)
		const { objectKey, filePath } = object
		await recipeWithImage(objectKey)

		expect(await deleteRecipeImageUnlessShared(objectKey)).toBe(false)
		expect(await exists(filePath)).toBe(true)
	})
})
