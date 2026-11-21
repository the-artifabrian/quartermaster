import { data, replace } from 'react-router'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { prisma } from './db.server.ts'
import { fitImportedRecipe } from './import-recipe-fit.ts'
import {
	type ExtractedRecipe,
	type ImportedFrom,
} from './import-recipe-types.ts'
import { RECIPE_IMPORTED } from './posthog-events.ts'
import { captureServerEvent } from './posthog.server.ts'
import { writeTransaction } from './write-transaction.server.ts'

export type ImportIntent =
	'fetch' | 'parse-text' | 'extract-text' | 'extract-image'

const importedFrom: Record<ImportIntent, ImportedFrom> = {
	fetch: 'url',
	'parse-text': 'text',
	'extract-text': 'text',
	'extract-image': 'images',
}

// An import with no ingredient (headings aside) and no step has nothing to
// cook from. It saves nothing: a title alone would be an empty Recipe, and for
// a link, one that answers every later import of it.
const nothingToRead: Record<ImportIntent, string> = {
	fetch:
		'The recipe data on this page has no ingredients or instructions. Paste its text in From Text instead.',
	'parse-text':
		'Could not find a recipe in the pasted text. Try including a title, ingredients, and instructions.',
	'extract-text': 'Could not find a recipe in the pasted text.',
	'extract-image': 'Could not find a recipe in the screenshots.',
}

/** An import that saved nothing, said on the tab the cook used. */
export function importFailure(
	intent: ImportIntent | null,
	error: string,
	status = 400,
) {
	return data({ intent, error, existing: null }, { status })
}

/** The household's Recipe imported from `url`, if it has one. */
export async function findRecipeFromUrl(
	householdId: string,
	url: string,
	db: Pick<PrismaClient, 'recipe'> = prisma,
) {
	return db.recipe.findFirst({
		where: { householdId, sourceUrl: url },
		select: { id: true, title: true },
		orderBy: { createdAt: 'desc' },
	})
}

/** A second import of a link the household already has: open nothing new. */
export function alreadyImported(
	intent: ImportIntent,
	existing: { id: string; title: string },
) {
	return data({ intent, error: null, existing })
}

/**
 * Saves what an import read and opens it. There is no review step: the
 * Recipe page says what was saved, what is missing and what was shortened,
 * and the cook edits it there.
 */
export async function saveImportedRecipe(
	extracted: ExtractedRecipe,
	intent: ImportIntent,
	{ userId, householdId }: { userId: string; householdId: string },
	db: PrismaClient = prisma,
) {
	let saved:
		| { created: { id: string; title: string } }
		| { existing: { id: string; title: string } }
	let shortened: string[]
	let ingredientCount: number
	try {
		const fitted = fitImportedRecipe(extracted)
		const { recipe } = fitted
		shortened = fitted.shortened
		ingredientCount = recipe.ingredients.length
		if (
			!recipe.ingredients.some((ingredient) => !ingredient.isHeading) &&
			!recipe.instructions.length
		) {
			return importFailure(intent, nothingToRead[intent])
		}
		saved = await writeTransaction(db, async (tx) => {
			// Checked in the same transaction as the save, so two saves of one
			// link at once (a shared link's own save and a tap) keep one Recipe
			// and the second answers with it.
			const existing = recipe.sourceUrl
				? await findRecipeFromUrl(householdId, recipe.sourceUrl, tx)
				: null
			if (existing) return { existing }
			// Suggested classifications are ids this household had when the
			// extraction ran; one deleted since then is skipped, not an error.
			const values = recipe.metadataValueIds.length
				? await tx.recipeMetadataValue.findMany({
						where: { id: { in: recipe.metadataValueIds }, householdId },
						select: { id: true },
					})
				: []
			const created = await tx.recipe.create({
				data: {
					title: recipe.title,
					description: recipe.description,
					notes: recipe.notes,
					activeTime: recipe.activeTime,
					totalTime: recipe.totalTime,
					yieldAmount: recipe.yieldAmount,
					yieldLabel: recipe.yieldLabel,
					sourceUrl: recipe.sourceUrl,
					rawText: recipe.rawText,
					userId,
					householdId,
					metadataAssignments: {
						create: values.map((value) => ({ valueId: value.id })),
					},
					ingredients: {
						create: recipe.ingredients.map((ingredient, order) => ({
							...ingredient,
							order,
						})),
					},
					instructions: {
						create: recipe.instructions.map((instruction, order) => ({
							content: instruction.content,
							order,
						})),
					},
				},
				select: { id: true, title: true },
			})
			return { created }
		})
	} catch (error) {
		console.error('Saving an imported Recipe failed:', error)
		return importFailure(
			intent,
			'Nothing was saved. Try again in a moment.',
			503,
		)
	}

	if ('existing' in saved) return alreadyImported(intent, saved.existing)
	const { created } = saved
	captureServerEvent(userId, RECIPE_IMPORTED, {
		recipe_title: created.title,
		ingredient_count: ingredientCount,
		source: intent,
	})
	const search = new URLSearchParams({ imported: importedFrom[intent] })
	if (shortened.length) search.set('shortened', shortened.join(','))
	// Replaces Import in history, so Back from the new Recipe goes to wherever
	// the import started rather than to an empty form.
	return replace(`/recipes/${created.id}?${search}`)
}
