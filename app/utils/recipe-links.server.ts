import { invariantResponse } from '@epic-web/invariant'
import { prisma } from './db.server.ts'

/**
 * A sub-Recipe link may only point inside the editor's own household. The
 * picker offers nothing else, so a foreign id can only arrive by hand; reject
 * the save rather than store a link the household cannot follow.
 */
export async function assertLinkedRecipesInHousehold(
	ingredients: ReadonlyArray<{ linkedRecipeId?: string | null }>,
	householdId: string,
) {
	const linkedIds = [
		...new Set(
			ingredients.flatMap((ingredient) =>
				ingredient.linkedRecipeId ? [ingredient.linkedRecipeId] : [],
			),
		),
	]
	if (linkedIds.length === 0) return
	const owned = await prisma.recipe.count({
		where: { id: { in: linkedIds }, householdId },
	})
	invariantResponse(
		owned === linkedIds.length,
		'A linked Recipe is not in your household',
		{ status: 400 },
	)
}
