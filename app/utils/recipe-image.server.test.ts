import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	createWalDatabase,
	writeAfterFirstRead,
} from '#tests/sqlite-concurrency.ts'
import {
	deleteRecipeAndPhoto,
	deleteRecipeImageUnlessShared,
} from './recipe-image.server.ts'
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
	test('removes an object no Recipe references', async () => {
		const owner = await prisma.user.create({ data: createUser() })
		await using object = await uploadedObject(owner.id)
		const { objectKey, filePath } = object

		expect(await deleteRecipeImageUnlessShared(objectKey)).toBe(true)
		expect(await exists(filePath)).toBe(false)
	})

	test('keeps the object while a Recipe still shows it', async () => {
		const owner = await prisma.user.create({ data: createUser() })
		await using object = await uploadedObject(owner.id)
		const { objectKey, filePath } = object
		await recipeWithImage(objectKey)

		expect(await deleteRecipeImageUnlessShared(objectKey)).toBe(false)
		expect(await exists(filePath)).toBe(true)
	})
})

describe('deleteRecipeAndPhoto', () => {
	test('deletes the Recipe and its photo file', async () => {
		const owner = await prisma.user.create({ data: createUser() })
		await using object = await uploadedObject(owner.id)
		const { recipeId } = await recipeWithImage(object.objectKey)

		expect(await deleteRecipeAndPhoto(recipeId)).toEqual({ title: 'Pictured' })
		expect(await prisma.recipe.count({ where: { id: recipeId } })).toBe(0)
		expect(await exists(object.filePath)).toBe(false)
	})

	test('a photo attached while the delete is running waits for it, so the delete never misses a photo it then cascades away', async () => {
		await using database = await createWalDatabase()
		const { db: wal, url } = database
		const user = await wal.user.create({ data: createUser() })
		const household = await wal.household.create({
			data: {
				name: 'Home',
				members: { create: { userId: user.id, role: 'owner' } },
			},
		})
		const recipe = await wal.recipe.create({
			data: {
				title: 'Fresh import',
				userId: user.id,
				householdId: household.id,
			},
			select: { id: true },
		})
		const now = Date.now()
		const { db, state } = writeAfterFirstRead(
			wal,
			url,
			['recipe', 'findUnique'],
			'INSERT INTO "RecipeImage" ("id", "objectKey", "recipeId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)',
			[
				'late-photo',
				`users/${user.id}/recipes/${recipe.id}/images/late.jpg`,
				recipe.id,
				now,
				now,
			],
		)

		await deleteRecipeAndPhoto(recipe.id, db)
		// Once the Recipe is gone the insert may be refused; either way it
		// came after the delete.
		await state.other!.committed.catch(() => {})

		expect(state.landedAtOnce).toBe(false)
		expect(await wal.recipe.count({ where: { id: recipe.id } })).toBe(0)
	})
})
