import { scaleAmountKitchen } from './fractions.ts'

type CopyIngredient = {
	name: string
	amount: string | null
	unit: string | null
	isHeading?: boolean
}

type CopyInstruction = {
	content: string
}

type CopyRecipe<
	Ingredient extends CopyIngredient,
	Instruction extends CopyInstruction,
> = {
	title: string
	ingredients: Ingredient[]
	instructions: Instruction[]
}

export function formatRecipeForCopy<
	Ingredient extends CopyIngredient,
	Instruction extends CopyInstruction,
>(
	recipe: CopyRecipe<Ingredient, Instruction>,
	scaleMultiplier: number,
): string {
	const ingredientLines = recipe.ingredients.flatMap((ingredient) => {
		const name = ingredient.name.trim()
		if (ingredient.isHeading || !name) return []

		const scaledAmount = scaleAmountKitchen(
			ingredient.amount,
			scaleMultiplier,
			ingredient.unit,
		)
		const amount = scaledAmount
			? `${scaledAmount.approximate ? '≈' : ''}${scaledAmount.display}`
			: null
		const line = [amount, ingredient.unit?.trim(), name]
			.filter(Boolean)
			.join(' ')
		return line ? [`- ${line}`] : []
	})

	const instructionLines = recipe.instructions.flatMap((instruction) => {
		const content = instruction.content.trim()
		return content ? [content] : []
	})

	const sections = [recipe.title.trim()]
	if (ingredientLines.length > 0) {
		sections.push(`Ingredients\n${ingredientLines.join('\n')}`)
	}
	if (instructionLines.length > 0) {
		sections.push(
			`Instructions\n${instructionLines.map((line, index) => `${index + 1}. ${line}`).join('\n')}`,
		)
	}

	return sections.filter(Boolean).join('\n\n')
}
