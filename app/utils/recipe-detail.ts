// Pure utility functions and types extracted from recipe detail route

export type SubtractionPreviewData = {
	willSubtract: Array<{
		name: string
		currentQuantity: number | null
		currentUnit: string | null
		subtractAmount: number | null
		newQuantity: number | null
		willBeRemoved: boolean
	}>
	noMatch: string[]
	willSkip: Array<{
		name: string
		reason: 'no_quantity' | 'incompatible_units'
	}>
}

export type AppliedSubstitution = {
	originalName: string
	replacementShort: string
}

export function toIsoDuration(
	minutes: number | null | undefined,
): string | undefined {
	if (!minutes) return undefined
	const h = Math.floor(minutes / 60)
	const m = minutes % 60
	return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}`
}

export function getRecipeJsonLd(
	recipe: {
		title: string
		description: string | null
		servings: number
		prepTime: number | null
		cookTime: number | null
		image: { objectKey: string; altText: string | null } | null
		ingredients: Array<{
			name: string
			amount: string | null
			unit: string | null
			isHeading?: boolean
		}>
		instructions: Array<{ content: string }>
	},
	origin: string | undefined,
) {
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)

	const jsonLd: Record<string, unknown> = {
		'@context': 'https://schema.org',
		'@type': 'Recipe',
		name: recipe.title,
		...(recipe.description && { description: recipe.description }),
		...(recipe.servings && { recipeYield: `${recipe.servings} servings` }),
		...(recipe.prepTime && { prepTime: toIsoDuration(recipe.prepTime) }),
		...(recipe.cookTime && { cookTime: toIsoDuration(recipe.cookTime) }),
		...(totalTime > 0 && { totalTime: toIsoDuration(totalTime) }),
		recipeIngredient: recipe.ingredients
			.filter((i) => !i.isHeading)
			.map((i) => [i.amount, i.unit, i.name].filter(Boolean).join(' ')),
		recipeInstructions: recipe.instructions.map((step, idx) => ({
			'@type': 'HowToStep',
			position: idx + 1,
			text: step.content,
		})),
	}

	if (origin && recipe.image?.objectKey) {
		jsonLd.image = `${origin}/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}&w=1200&h=630&fit=cover`
	}

	return jsonLd
}

export function formatQuantity(q: number | null): string {
	if (q === null) return '?'
	return Number.isInteger(q) ? q.toString() : q.toFixed(1)
}

export function extractPrimaryIngredient(replacement: string): string {
	// Split on common combiners, take first part
	const primary = replacement.split(/\s*(?:\+|&|\band\b|\bwith\b)\s*/i)[0]!
	// Strip leading amounts/units (e.g., "1 cup butter" → "butter")
	return primary
		.replace(
			/^\d[\d./]*\s*(?:cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|ml|liters?|litres?)?\s*/i,
			'',
		)
		.trim()
}

export function applySubstitutionsToText(
	text: string,
	substitutions: Map<string, AppliedSubstitution>,
): string {
	let result = text
	for (const sub of substitutions.values()) {
		const escaped = sub.originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		const regex = new RegExp(`\\b${escaped}\\b`, 'gi')
		result = result.replace(regex, sub.replacementShort)
	}
	return result
}
