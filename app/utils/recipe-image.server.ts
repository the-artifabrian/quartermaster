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
 * `exceptRecipeId` is the Recipe whose image row is about to go away, so its
 * own reference does not count.
 */
export async function deleteRecipeImageUnlessShared(
	objectKey: string,
	{ exceptRecipeId }: { exceptRecipeId?: string } = {},
) {
	const otherReferences = await prisma.recipeImage.count({
		where: {
			objectKey,
			...(exceptRecipeId ? { recipeId: { not: exceptRecipeId } } : {}),
		},
	})
	if (otherReferences > 0) return false
	await deleteRecipeImage(objectKey)
	return true
}
