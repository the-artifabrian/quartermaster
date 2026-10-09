import {
	importFailure,
	saveImportedRecipe,
} from '#app/utils/import-recipe-save.server.ts'
import { type ExtractedRecipe } from '#app/utils/import-recipe-types.ts'
import { parseRecipeText } from '#app/utils/recipe-text-parser.ts'
import { MAX_RAW_TEXT_LENGTH } from '#app/utils/recipe-validation.ts'

/**
 * The `parse-text` intent: read the Recipe from pasted text without AI and
 * save it, even with its ingredients or its steps missing. Text with neither
 * saves nothing: the parser reads nearly any first line as a title, so a title
 * alone would save whatever was pasted as an empty Recipe.
 */
export async function importFromText(
	formData: FormData,
	user: { userId: string; householdId: string },
) {
	const rawText = (formData.get('rawText') as string) || ''
	const sourceUrl = (formData.get('sourceUrl') as string) || ''

	if (!rawText.trim()) {
		return importFailure('parse-text', 'Please paste some recipe text.')
	}

	if (rawText.length > MAX_RAW_TEXT_LENGTH) {
		return importFailure(
			'parse-text',
			'Text is too long. Please shorten it and try again.',
		)
	}

	const parsed = parseRecipeText(rawText)

	if (!parsed.ingredients.length && !parsed.instructions.length) {
		return importFailure(
			'parse-text',
			'Could not find a recipe in the pasted text. Try including a title, ingredients, and instructions.',
		)
	}

	const recipe: ExtractedRecipe = {
		title: parsed.title || 'Untitled Recipe',
		description: parsed.description || null,
		notes: null,
		activeTime: null,
		totalTime: null,
		yieldAmount: parsed.yieldAmount ?? null,
		yieldLabel: parsed.yieldLabel ?? null,
		sourceUrl: sourceUrl || '',
		metadataValueIds: [],
		rawText,
		ingredients: parsed.ingredients.map((ing) => ({
			name: ing.name,
			amount: ing.amount,
			unit: ing.unit,
			notes: ing.notes,
			isHeading: ing.isHeading,
		})),
		instructions: parsed.instructions,
	}

	return saveImportedRecipe(recipe, 'parse-text', user)
}
