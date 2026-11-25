// Restores a file's Recipes and indexes them for its Menus and Meals.

import { createId } from '@paralleldrive/cuid2'
import { prisma } from '#app/utils/db.server.ts'
import { ensureRecipeMetadataValues } from '#app/utils/recipe-metadata.server.ts'
import { writeTransaction } from '#app/utils/write-transaction.server.ts'
import { type ImportRecipe } from './+export-format.ts'
import {
	type RecordFailure,
	refusedWriteCode,
} from './restore-results.server.ts'

/**
 * How the import file's Recipes resolve to household Recipe rows once the
 * Recipe pass finishes: by export-local reference key, by normalized title,
 * and back to a display title for freezing on Menu cards.
 */
export interface RecipeIndex {
	titleToIdMap: Map<string, string>
	refToIdMap: Map<string, string>
	titleById: Map<string, string>
}

export async function importRecipes(
	recipes: ImportRecipe[],
	{ titleToIdMap, refToIdMap, titleById }: RecipeIndex,
	userId: string,
	householdId: string,
	recordFailure: RecordFailure,
) {
	const stats = { created: 0, skipped: 0, errored: 0 }
	// Sub-Recipe links of the Recipes this import creates. A skipped duplicate
	// keeps the household's own lines untouched.
	const pendingLinks: Array<{
		recipeId: string
		ingredientId: string
		ref: string
	}> = []

	try {
		for (const [index, recipe] of recipes.entries()) {
			const lowerTitle = recipe.title.toLowerCase()
			const existingId = titleToIdMap.get(lowerTitle)
			if (existingId != null) {
				// A skipped duplicate still resolves its reference key, so Menus that
				// point at it reconnect to the existing household Recipe.
				if (recipe.ref) refToIdMap.set(recipe.ref, existingId)
				stats.skipped++
				continue
			}
			try {
				// Older exports may carry only Prep/Cook. They become a total only
				// when both parts are present, non-negative, and add up to more than
				// zero, and the rule runs one way: a total is never split back into
				// prep and cook. An old file's servings is accepted here and never
				// becomes typed yield.
				const legacyTotal =
					recipe.prepTime != null &&
					recipe.cookTime != null &&
					recipe.prepTime >= 0 &&
					recipe.cookTime >= 0 &&
					recipe.prepTime + recipe.cookTime > 0
						? recipe.prepTime + recipe.cookTime
						: undefined
				const instructions = recipe.instructions.map((inst, order) => ({
					content: typeof inst === 'string' ? inst : inst.content,
					order,
				}))
				const ingredientIds = recipe.ingredients.map(() => createId())

				const created = await writeTransaction(prisma, async (tx) => {
					const metadataValueIds = await ensureRecipeMetadataValues(
						tx,
						householdId,
						recipe.metadataValues ?? [],
					)
					return tx.recipe.create({
						data: {
							title: recipe.title,
							description: recipe.description || null,
							activeTime: recipe.activeTime ?? undefined,
							totalTime: recipe.totalTime ?? legacyTotal,
							yieldAmount: recipe.yieldAmount ?? undefined,
							yieldLabel: recipe.yieldLabel ?? undefined,
							isFavorite: recipe.isFavorite ?? false,
							sourceUrl: recipe.sourceUrl || null,
							rawText: recipe.rawText ?? null,
							notes: recipe.notes || null,
							userId,
							householdId,
							metadataAssignments: {
								create: metadataValueIds.map((valueId) => ({ valueId })),
							},
							ingredients: {
								create: recipe.ingredients.map((ing, order) => ({
									id: ingredientIds[order],
									name: ing.name,
									amount: ing.amount || null,
									unit: ing.unit || null,
									notes: ing.notes || null,
									isHeading: ing.isHeading ?? false,
									order,
								})),
							},
							instructions: { create: instructions },
						},
						select: { id: true },
					})
				})
				titleToIdMap.set(lowerTitle, created.id)
				titleById.set(created.id, recipe.title)
				if (recipe.ref) refToIdMap.set(recipe.ref, created.id)
				// The editor never links a heading, so a file cannot either.
				recipe.ingredients.forEach((ing, order) => {
					if (ing.linkedRecipeRef && !ing.isHeading)
						pendingLinks.push({
							recipeId: created.id,
							ingredientId: ingredientIds[order]!,
							ref: ing.linkedRecipeRef,
						})
				})
				stats.created++
			} catch (error) {
				const code = refusedWriteCode(error)
				if (!code) throw error
				recordFailure({
					at: `recipes[${index}]`,
					reason: 'write-refused',
					code,
				})
				stats.errored++
			}
		}
	} finally {
		// Also after an unexpected error: a rerun skips the Recipes saved so far
		// as duplicates, so this is their only chance to get their links.
		await restorePendingLinks()
	}

	return stats

	async function restorePendingLinks() {
		// Links resolve only once every Recipe in the file has a household row, so
		// a Recipe can link to one later in the file. A ref resolves through this
		// file's Recipes alone; one that names no Recipe here stays plain. So does
		// one that resolves back to its own Recipe, which the picker never offers.
		for (const link of pendingLinks) {
			const linkedRecipeId = refToIdMap.get(link.ref)
			if (!linkedRecipeId || linkedRecipeId === link.recipeId) continue
			try {
				await prisma.ingredient.update({
					where: { id: link.ingredientId },
					data: { linkedRecipeId },
				})
			} catch (error) {
				// The link is dropped either way, so the Recipes already restored
				// still count as created. Only the expected race is silent: P2025 when
				// the linking Recipe was deleted mid-import, P2003 when the linked
				// one was. Anything else is logged.
				const code = (error as { code?: unknown } | null)?.code
				if (code !== 'P2025' && code !== 'P2003')
					console.error('Unable to restore a sub-Recipe link', error)
			}
		}
	}
}
