import { prisma } from './db.server.ts'
import { deleteRecipeImage } from './storage.server.ts'

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
export async function deleteRecipeImageUnlessShared(objectKey: string) {
	const references = await prisma.recipeImage.count({ where: { objectKey } })
	if (references > 0) return false
	await deleteRecipeImage(objectKey)
	return true
}
