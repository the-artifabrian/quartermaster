import { type ExtractedRecipe } from './import-recipe-types.ts'
import {
	detectIngredientHeading,
	isAllCapsHouseStyle,
	parseIngredient,
	parseISODuration,
} from './ingredient-parser.server.ts'
import {
	extractYieldFromTitle,
	joinBrokenUnitSteps,
} from './recipe-text-parser.ts'
import { MAX_RAW_TEXT_LENGTH } from './recipe-validation.ts'

/** The Recipe node has a field in a shape the import cannot read. */
export class RecipeShapeError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'RecipeShapeError'
	}
}

export function findRecipeInJsonLd(
	obj: unknown,
): Record<string, unknown> | null {
	if (!obj || typeof obj !== 'object') return null

	if (Array.isArray(obj)) {
		for (const item of obj) {
			const found = findRecipeInJsonLd(item)
			if (found) return found
		}
		return null
	}

	const record = obj as Record<string, unknown>

	// Check @type
	const type = record['@type']
	if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
		return record
	}

	// Check @graph
	if (record['@graph']) {
		return findRecipeInJsonLd(record['@graph'])
	}

	return null
}

/** Decode HTML entities and strip tags from JSON-LD text values */
export function cleanJsonLdText(text: string): string {
	return (
		text
			// Replace <br> variants with spaces
			.replace(/<br\s*\/?>/gi, ' ')
			// Strip remaining HTML tags
			.replace(/<[^>]+>/g, '')
			// Decode common HTML entities
			.replace(/&nbsp;/gi, ' ')
			.replace(/&amp;/gi, '&')
			.replace(/&lt;/gi, '<')
			.replace(/&gt;/gi, '>')
			.replace(/&quot;/gi, '"')
			.replace(/&#39;/gi, "'")
			.replace(/&#x27;/gi, "'")
			// Decode numeric HTML entities: &#40; → ( , &#x28; → (
			.replace(/&#(\d+);/g, (_, code) =>
				String.fromCharCode(parseInt(code, 10)),
			)
			.replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
				String.fromCharCode(parseInt(code, 16)),
			)
			// Collapse multiple spaces into one
			.replace(/\s{2,}/g, ' ')
			.trim()
	)
}

function parseTypedYield(value: unknown): {
	amount: number
	label: string
} | null {
	// WP Recipe Maker sends ["24", "24 cookies"]: a labelled entry wins, and
	// only without one does a bare number count, as schema.org's servings
	const entries: unknown[] = Array.isArray(value) ? value : [value]
	for (const entry of entries) {
		const parsed = parseYieldEntry(entry)
		if (parsed) return parsed
	}
	for (const entry of entries) {
		if (entry == null) continue
		const raw = cleanJsonLdText(String(entry))
		if (/^\d+$/.test(raw) && Number(raw) > 0) {
			return { amount: Number(raw), label: 'servings' }
		}
	}
	return null
}

function parseYieldEntry(value: unknown): {
	amount: number
	label: string
} | null {
	if (value == null) return null
	const raw = cleanJsonLdText(String(value))
	const amountMatch = raw.match(/\d+(?:[.,]\d+)?/)
	if (!amountMatch || amountMatch.index == null) return null
	const amount = Number(amountMatch[0].replace(',', '.'))
	if (!Number.isFinite(amount) || amount <= 0) return null

	const prefix = raw.slice(0, amountMatch.index).trim()
	const rawSuffix = raw.slice(amountMatch.index + amountMatch[0].length)
	if (/^\s*(?:[-–—]|to)\s*\d/i.test(rawSuffix)) return null
	const suffix = rawSuffix.replace(/^[\s:;,.\-–—]+/, '').trim()
	const label = suffix || (/^serves?\b/i.test(prefix) ? 'servings' : '')
	if (!label) return null
	return { amount, label: label.slice(0, 100).trim() }
}

function parseExplicitDuration(value: unknown): number | null {
	if (value == null) return null
	// Some sites send bare minutes ("30" or 30) instead of an ISO duration
	const raw = String(value).trim()
	const minutes = /^\d+$/.test(raw) ? Number(raw) : parseISODuration(raw)
	return minutes != null && minutes > 0 ? minutes : null
}

function parseInstructions(value: unknown): Array<{ content: string }> {
	if (!value) return []

	if (typeof value === 'string') {
		// Split before cleaning, which collapses blank lines into a space
		return value
			.split(/\n+/)
			.map(cleanJsonLdText)
			.filter(Boolean)
			.map((content) => ({ content }))
	}

	if (Array.isArray(value)) {
		const result: Array<{ content: string }> = []
		for (const item of value) {
			if (typeof item === 'string') {
				const cleaned = cleanJsonLdText(item)
				if (cleaned) result.push({ content: cleaned })
			} else if (item && typeof item === 'object') {
				const obj = item as Record<string, unknown>
				// HowToStep
				if (obj.text) {
					const text = cleanJsonLdText(String(obj.text))
					if (text) result.push({ content: text })
				}
				// HowToSection
				else if (obj.itemListElement) {
					const sectionSteps = parseInstructions(obj.itemListElement)
					result.push(...sectionSteps)
				}
				// HowToStep with its text only in name. A HowToSection's name is a
				// title, never a step, even when the section has no children.
				else if (obj.name && !isHowToSection(obj)) {
					const name = cleanJsonLdText(String(obj.name))
					if (name) result.push({ content: name })
				}
			}
		}
		return result
	}

	return []
}

function isHowToSection(obj: Record<string, unknown>): boolean {
	const type = obj['@type']
	return (
		type === 'HowToSection' ||
		(Array.isArray(type) && type.includes('HowToSection'))
	)
}

export function extractRecipe(
	jsonLd: Record<string, unknown>,
	url: string,
): ExtractedRecipe {
	const ingredientField = jsonLd.recipeIngredient || []
	if (
		!Array.isArray(ingredientField) ||
		!ingredientField.every((line) => typeof line === 'string')
	) {
		throw new RecipeShapeError('recipeIngredient is not a list of strings')
	}
	const rawIngredients: string[] = ingredientField
	const cleanedLines = rawIngredients.map(cleanJsonLdText)
	// When the whole list is caps, caps is house style, not structure
	const allCapsIsHeading = !isAllCapsHouseStyle(cleanedLines)
	const ingredients = cleanedLines
		.map((cleaned) => {
			// Sites stuff sub-section headers ("For the crust") into
			// recipeIngredient — keep them as headings, not fake ingredients
			const heading = detectIngredientHeading(cleaned, { allCapsIsHeading })
			if (heading) return { name: heading, isHeading: true }
			return parseIngredient(cleaned)
		})
		.filter((ing): ing is NonNullable<typeof ing> => ing !== null)

	const instructions = joinBrokenUnitSteps(
		parseInstructions(jsonLd.recipeInstructions),
	)

	const titleYield = extractYieldFromTitle(
		cleanJsonLdText(String(jsonLd.name || 'Untitled Recipe')),
	)
	const typedYield =
		parseTypedYield(jsonLd.recipeYield) ??
		(titleYield.yieldAmount != null && titleYield.yieldLabel != null
			? { amount: titleYield.yieldAmount, label: titleYield.yieldLabel }
			: null)

	return {
		title: titleYield.title,
		description: jsonLd.description
			? cleanJsonLdText(String(jsonLd.description))
			: null,
		notes: null,
		activeTime: parseExplicitDuration(jsonLd.prepTime),
		totalTime: parseExplicitDuration(jsonLd.totalTime),
		yieldAmount: typedYield?.amount ?? null,
		yieldLabel: typedYield?.label ?? null,
		sourceUrl: url,
		metadataValueIds: [],
		// Provenance, not data: some sites embed enormous JSON-LD blobs, and this
		// is posted straight back to saveImportedRecipe on save. Bound it here so
		// the field can never exceed what that schema accepts.
		rawText: JSON.stringify(jsonLd, null, 2).slice(0, MAX_RAW_TEXT_LENGTH),
		ingredients,
		instructions,
	}
}
