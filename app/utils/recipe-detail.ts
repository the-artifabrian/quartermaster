// Pure utility functions and types extracted from recipe detail route

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
