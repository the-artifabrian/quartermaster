import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { prisma } from './db.server.ts'
import { deleteRecipeImage } from './storage.server.ts'
import { writeTransaction } from './write-transaction.server.ts'

/**
 * Remove a Recipe image from storage unless another Recipe still shows it.
 *
 * `RecipeImage.objectKey` is not unique: household moves copy a Recipe row
 * without copying its bytes, and copies made before the public share route
 * copied bytes share their source's key too. Counting rows first keeps a
 * delete on one copy from blanking the picture on every other.
 *
 * Call it once the row that showed the image is gone, so the count sees
 * only other Recipes, including a copy written a moment before.
 */
export async function deleteRecipeImageUnlessShared(
	objectKey: string,
	db: Pick<PrismaClient, 'recipeImage'> = prisma,
) {
	const references = await db.recipeImage.count({ where: { objectKey } })
	if (references > 0) return false
	await deleteRecipeImage(objectKey)
	return true
}

/**
 * Delete a Recipe, then its photo file unless another Recipe still shows it.
 * Returns the deleted Recipe's title, or null when it was already gone.
 *
 * The photo is read in the same write transaction as the delete, so a photo
 * attached at the same moment (an import's, which lands after its Recipe is
 * saved) either comes first and is deleted here, or comes after and finds no
 * Recipe. A share Save that copies the photo's key either wrote its copy
 * before the delete, and the count sees it, or finds no photo to copy
 * (share.$recipeId.tsx).
 */
export async function deleteRecipeAndPhoto(
	recipeId: string,
	db: PrismaClient = prisma,
) {
	const deleted = await writeTransaction(db, async (tx) => {
		const recipe = await tx.recipe.findUnique({
			where: { id: recipeId },
			select: { title: true, image: { select: { objectKey: true } } },
		})
		if (recipe) await tx.recipe.delete({ where: { id: recipeId } })
		return recipe
	})
	if (deleted?.image) {
		try {
			await deleteRecipeImageUnlessShared(deleted.image.objectKey, db)
		} catch (error) {
			// The Recipe is gone either way; the file is left behind.
			console.error('Failed to delete recipe image from storage:', error)
		}
	}
	return deleted && { title: deleted.title }
}
