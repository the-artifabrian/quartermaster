import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { prisma } from './db.server.ts'

/** The message a row gets when its sub-Recipe link cannot be kept. */
export const LINKED_RECIPE_GONE_MESSAGE =
	'This linked Recipe was deleted. Remove the link to save.'

/**
 * The rows whose sub-Recipe link points outside the editor's household: a
 * Recipe another member deleted while the form was open, or (by hand only;
 * the picker offers nothing else) another household's. The save stops and
 * the form shows the error at those rows, keeping the edits.
 */
export async function unlinkableRows(
	ingredients: ReadonlyArray<{ linkedRecipeId?: string | null }>,
	householdId: string,
	db: Pick<PrismaClient, 'recipe'> = prisma,
) {
	const linkedIds = [
		...new Set(
			ingredients.flatMap((ingredient) =>
				ingredient.linkedRecipeId ? [ingredient.linkedRecipeId] : [],
			),
		),
	]
	if (linkedIds.length === 0) return []
	const owned = new Set(
		(
			await db.recipe.findMany({
				where: { id: { in: linkedIds }, householdId },
				select: { id: true },
			})
		).map((recipe) => recipe.id),
	)
	return ingredients.flatMap((ingredient, index) =>
		ingredient.linkedRecipeId && !owned.has(ingredient.linkedRecipeId)
			? [index]
			: [],
	)
}
