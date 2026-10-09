import { z } from 'zod'
import {
	type ExtractedRecipe,
	SHORTENED_PARTS,
	type ShortenedPart,
} from './import-recipe-types.ts'
import {
	IngredientSchema,
	InstructionSchema,
	MAX_INGREDIENT_AMOUNT_LENGTH,
	MAX_INGREDIENT_NAME_LENGTH,
	MAX_INGREDIENT_NOTES_LENGTH,
	MAX_INGREDIENT_UNIT_LENGTH,
	MAX_INSTRUCTION_LENGTH,
	MAX_RAW_TEXT_LENGTH,
	MAX_RECIPE_DESCRIPTION_LENGTH,
	MAX_RECIPE_INGREDIENTS,
	MAX_RECIPE_INSTRUCTIONS,
	MAX_RECIPE_NOTES_LENGTH,
	MAX_RECIPE_TITLE_LENGTH,
	MAX_SOURCE_URL_LENGTH,
	MAX_YIELD_LABEL_LENGTH,
	RecipeSchema,
} from './recipe-validation.ts'

export type FittedRecipe = {
	title: string
	description: string | null
	notes: string | null
	activeTime: number | null
	totalTime: number | null
	yieldAmount: number | null
	yieldLabel: string | null
	sourceUrl: string | null
	rawText: string
	metadataValueIds: string[]
	ingredients: Array<{
		name: string
		amount: string | null
		unit: string | null
		notes: string | null
		isHeading: boolean
	}>
	instructions: Array<{ content: string }>
}

// The save schema, except that an import may arrive without ingredients or
// steps: it is saved anyway, and the Recipe page asks for what is missing.
const ImportedRecipeSchema = RecipeSchema.safeExtend({
	ingredients: z.array(IngredientSchema).max(MAX_RECIPE_INGREDIENTS),
	instructions: z.array(InstructionSchema).max(MAX_RECIPE_INSTRUCTIONS),
})

function blankToNull(text: string | null | undefined) {
	const trimmed = text?.trim()
	return trimmed ? trimmed : null
}

/** The longest start of `text` within `limit`, ending at a word when it can. */
function headAtWord(text: string, limit: number) {
	let head = text.slice(0, limit)
	const lastSpace = head.search(/\s\S*$/)
	if (text.length > limit && !/\s/.test(text[limit]!) && lastSpace > 0) {
		head = head.slice(0, lastSpace)
	}
	// A cut between the two halves of an emoji would leave invalid text.
	if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1)
	return head.trimEnd()
}

/**
 * `text` within `limit` characters, ending in an ellipsis when it was cut.
 * Calls `onCut` when it was.
 */
function fit(text: string, limit: number, onCut: () => void) {
	if (text.length <= limit) return text
	onCut()
	return `${headAtWord(text, limit - 1)}…`
}

function positiveMinutes(value: number | null) {
	if (value == null || !Number.isFinite(value)) return null
	const minutes = Math.round(value)
	return minutes > 0 ? minutes : null
}

function webAddress(value: string) {
	if (value.length > MAX_SOURCE_URL_LENGTH) return null
	try {
		const url = new URL(value)
		return url.protocol === 'https:' || url.protocol === 'http:' ? value : null
	} catch {
		return null
	}
}

/**
 * Makes what an import read savable without asking the cook first. Text
 * moves to the field beside it when that keeps it whole: a long description
 * into Notes, the tail of a long ingredient name into that ingredient's notes.
 * Anything still over a limit is cut at a word and reported in `shortened`,
 * so the Recipe page can say so.
 */
export function fitImportedRecipe(extracted: ExtractedRecipe): {
	recipe: FittedRecipe
	shortened: ShortenedPart[]
} {
	const shortened = new Set<ShortenedPart>()
	const cut = (part: ShortenedPart) => () => shortened.add(part)

	const title = fit(
		blankToNull(extracted.title) ?? 'Untitled Recipe',
		MAX_RECIPE_TITLE_LENGTH,
		cut('title'),
	)

	let description = blankToNull(extracted.description)
	let notes = blankToNull(extracted.notes)
	if (notes) notes = fit(notes, MAX_RECIPE_NOTES_LENGTH, cut('notes'))
	if (description && description.length > MAX_RECIPE_DESCRIPTION_LENGTH) {
		const moved = notes ? `${description}\n\n${notes}` : description
		if (moved.length <= MAX_RECIPE_NOTES_LENGTH) {
			notes = moved
			description = null
		} else {
			description = fit(
				description,
				MAX_RECIPE_DESCRIPTION_LENGTH,
				cut('description'),
			)
		}
	}

	const ingredientRows = extracted.ingredients.filter((row) =>
		blankToNull(row.name),
	)
	if (ingredientRows.length > MAX_RECIPE_INGREDIENTS) cut('ingredients')()
	const ingredients = ingredientRows
		.slice(0, MAX_RECIPE_INGREDIENTS)
		.map((row) => {
			let name = blankToNull(row.name)!
			if (row.isHeading) {
				return {
					name: fit(name, MAX_INGREDIENT_NAME_LENGTH, cut('ingredients')),
					amount: null,
					unit: null,
					notes: null,
					isHeading: true,
				}
			}
			let notes = blankToNull(row.notes)
			if (name.length > MAX_INGREDIENT_NAME_LENGTH) {
				const head = headAtWord(name, MAX_INGREDIENT_NAME_LENGTH)
				const tail = name.slice(head.length).trim()
				const moved = notes ? `${tail}, ${notes}` : tail
				if (head && moved.length <= MAX_INGREDIENT_NOTES_LENGTH) {
					name = head
					notes = moved
				} else {
					name = fit(name, MAX_INGREDIENT_NAME_LENGTH, cut('ingredients'))
				}
			}
			const amount = blankToNull(row.amount)
			const unit = blankToNull(row.unit)
			return {
				name,
				amount:
					amount &&
					fit(amount, MAX_INGREDIENT_AMOUNT_LENGTH, cut('ingredients')),
				unit: unit && fit(unit, MAX_INGREDIENT_UNIT_LENGTH, cut('ingredients')),
				notes:
					notes && fit(notes, MAX_INGREDIENT_NOTES_LENGTH, cut('ingredients')),
				isHeading: false,
			}
		})

	const steps = extracted.instructions.flatMap((row) => {
		const content = blankToNull(row.content)
		return content ? [content] : []
	})
	if (steps.length > MAX_RECIPE_INSTRUCTIONS) cut('instructions')()
	const instructions = steps
		.slice(0, MAX_RECIPE_INSTRUCTIONS)
		.map((content) => ({
			content: fit(content, MAX_INSTRUCTION_LENGTH, cut('instructions')),
		}))

	const yieldAmount =
		extracted.yieldAmount != null &&
		Number.isFinite(extracted.yieldAmount) &&
		extracted.yieldAmount > 0
			? extracted.yieldAmount
			: null
	const yieldLabel =
		yieldAmount == null
			? null
			: fit(
					blankToNull(extracted.yieldLabel) ?? 'servings',
					MAX_YIELD_LABEL_LENGTH,
					cut('yield'),
				)

	const recipe: FittedRecipe = {
		title,
		description,
		notes,
		activeTime: positiveMinutes(extracted.activeTime),
		totalTime: positiveMinutes(extracted.totalTime),
		yieldAmount,
		yieldLabel,
		sourceUrl: webAddress(extracted.sourceUrl),
		rawText: extracted.rawText.slice(0, MAX_RAW_TEXT_LENGTH),
		metadataValueIds: [...new Set(extracted.metadataValueIds)],
		ingredients,
		instructions,
	}

	// The save schema is the contract every other way into a Recipe keeps. A
	// field this function lets through over a limit is a bug here, not a
	// Recipe to write.
	const check = ImportedRecipeSchema.safeParse({
		...recipe,
		description: recipe.description ?? undefined,
		notes: recipe.notes ?? undefined,
		activeTime: recipe.activeTime ?? undefined,
		totalTime: recipe.totalTime ?? undefined,
		yieldAmount: recipe.yieldAmount ?? undefined,
		yieldLabel: recipe.yieldLabel ?? undefined,
		sourceUrl: recipe.sourceUrl ?? '',
		ingredients: recipe.ingredients.map((row) => ({
			name: row.name,
			amount: row.amount ?? undefined,
			unit: row.unit ?? undefined,
			notes: row.notes ?? undefined,
		})),
	})
	if (!check.success) {
		throw new Error(
			`An imported Recipe did not fit the save schema: ${check.error.message}`,
		)
	}

	return {
		recipe,
		shortened: SHORTENED_PARTS.filter((part) => shortened.has(part)),
	}
}
