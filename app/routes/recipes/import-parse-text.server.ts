import { data } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import {
	type DuplicateMatch,
	type ExtractedRecipe,
} from '#app/utils/import-recipe-types.ts'
import { parseRecipeText } from '#app/utils/recipe-text-parser.ts'
import { MAX_RAW_TEXT_LENGTH } from '#app/utils/recipe-validation.ts'

/** The `parse-text` intent: read the Recipe from pasted text without AI. */
export async function importFromText(
	formData: FormData,
	{ householdId }: { householdId: string },
) {
	const rawText = (formData.get('rawText') as string) || ''
	const sourceUrl = (formData.get('sourceUrl') as string) || ''

	if (!rawText.trim()) {
		return data(
			{
				intent: 'parse-text' as const,
				error: 'Please paste some recipe text.',
				recipe: null,
				result: null,
				duplicates: null,
			},
			{ status: 400 },
		)
	}

	if (rawText.length > MAX_RAW_TEXT_LENGTH) {
		return data(
			{
				intent: 'parse-text' as const,
				error: 'Text is too long. Please shorten it and try again.',
				recipe: null,
				result: null,
				duplicates: null,
			},
			{ status: 400 },
		)
	}

	const parsed = parseRecipeText(rawText)

	if (
		!parsed.title &&
		!parsed.ingredients.length &&
		!parsed.instructions.length
	) {
		return data(
			{
				intent: 'parse-text' as const,
				error:
					'Could not find a recipe in the pasted text. Try including a title, ingredients, and instructions.',
				recipe: null,
				result: null,
				duplicates: null,
			},
			{ status: 400 },
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
		warnings: parsed.warnings.filter(
			(warning) => !warning.startsWith('Joined steps'),
		),
		ingredients: parsed.ingredients.map((ing) => ({
			name: ing.name,
			amount: ing.amount,
			unit: ing.unit,
			notes: ing.notes,
			isHeading: ing.isHeading,
		})),
		instructions: parsed.instructions,
	}

	// Check for duplicates
	const duplicates: DuplicateMatch[] = []

	if (sourceUrl) {
		const urlMatches = await prisma.recipe.findMany({
			where: { householdId, sourceUrl },
			select: { id: true, title: true, sourceUrl: true },
		})
		for (const match of urlMatches) {
			duplicates.push({ ...match, matchReason: 'same-url' })
		}
	}

	const urlMatchIds = new Set(duplicates.map((m) => m.id))
	const titleMatches = await prisma.recipe.findMany({
		where: {
			householdId,
			title: { equals: recipe.title },
			id: { notIn: [...urlMatchIds] },
		},
		select: { id: true, title: true, sourceUrl: true },
	})
	for (const match of titleMatches) {
		duplicates.push({ ...match, matchReason: 'similar-title' })
	}

	return data({
		intent: 'parse-text' as const,
		recipe,
		error: null,
		result: null,
		duplicates: duplicates.length > 0 ? duplicates : null,
	})
}
