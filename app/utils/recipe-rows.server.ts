import { type Prisma } from '#app/generated/prisma/client.ts'
import {
	existingIds,
	matchRows,
	newRowIdCandidates,
	newRowIds,
} from './loaded-rows.ts'
import {
	type RecipeFormIngredient,
	type RecipeFormInstruction,
} from './recipe-validation.ts'

/**
 * Saves an edited Recipe's ingredient and step rows inside the caller's
 * write transaction. A row keeps its id when the form posts it back, through
 * any change of text, order or heading, so cooking checks on rows that
 * didn't change stay checked. Rows without an id of this Recipe's are added,
 * with the id the form gave them when that id is free (loaded-rows.ts).
 * Rows the form loaded and left out are removed. Rows added after the form
 * loaded stay, after the saved rows in their old order.
 */
export async function saveRecipeRows(
	tx: Prisma.TransactionClient,
	recipeId: string,
	rows: {
		ingredients: RecipeFormIngredient[]
		instructions: RecipeFormInstruction[]
	},
	loaded: { ingredients: Set<string> | null; instructions: Set<string> | null },
) {
	const storedIngredients = await tx.ingredient.findMany({
		where: { recipeId },
		orderBy: { order: 'asc' },
		select: {
			id: true,
			name: true,
			amount: true,
			unit: true,
			notes: true,
			isHeading: true,
			linkedRecipeId: true,
			order: true,
		},
	})
	const postedIngredientIds = rows.ingredients.map((row) => row.id)
	const ingredients = matchRows(
		storedIngredients,
		postedIngredientIds,
		loaded.ingredients,
	)
	const ingredientIds = newRowIds(
		postedIngredientIds,
		ingredients.matches,
		await existingIds(
			tx.ingredient,
			newRowIdCandidates(postedIngredientIds, ingredients.matches),
		),
	)
	for (const [order, row] of rows.ingredients.entries()) {
		const data = {
			name: row.name,
			amount: row.amount || null,
			unit: row.unit || null,
			notes: row.notes || null,
			isHeading: row.isHeading ?? false,
			linkedRecipeId: row.linkedRecipeId || null,
			order,
		}
		const stored = ingredients.matches[order]
		if (!stored) {
			await tx.ingredient.create({
				data: { ...data, id: ingredientIds[order], recipeId },
			})
		} else if (changes(stored, data)) {
			await tx.ingredient.update({ where: { id: stored.id }, data })
		}
	}
	await removeAndMoveAfter(
		tx.ingredient,
		recipeId,
		ingredients,
		rows.ingredients.length,
	)

	const storedInstructions = await tx.instruction.findMany({
		where: { recipeId },
		orderBy: { order: 'asc' },
		select: { id: true, content: true, order: true },
	})
	const postedInstructionIds = rows.instructions.map((row) => row.id)
	const instructions = matchRows(
		storedInstructions,
		postedInstructionIds,
		loaded.instructions,
	)
	const instructionIds = newRowIds(
		postedInstructionIds,
		instructions.matches,
		await existingIds(
			tx.instruction,
			newRowIdCandidates(postedInstructionIds, instructions.matches),
		),
	)
	for (const [order, row] of rows.instructions.entries()) {
		const data = { content: row.content, order }
		const stored = instructions.matches[order]
		if (!stored) {
			await tx.instruction.create({
				data: { ...data, id: instructionIds[order], recipeId },
			})
		} else if (changes(stored, data)) {
			await tx.instruction.update({ where: { id: stored.id }, data })
		}
	}
	await removeAndMoveAfter(
		tx.instruction,
		recipeId,
		instructions,
		rows.instructions.length,
	)
}

function changes<T extends object>(stored: T, data: Partial<T>) {
	return Object.entries(data).some(
		([key, value]) => stored[key as keyof T] !== value,
	)
}

type RowDelegate = {
	deleteMany(args: {
		where: { recipeId: string; id: { in: string[] } }
	}): Promise<unknown>
	update(args: {
		where: { id: string }
		data: { order: number }
	}): Promise<unknown>
}

async function removeAndMoveAfter(
	delegate: RowDelegate,
	recipeId: string,
	{
		removed,
		unseen,
	}: {
		removed: Array<{ id: string }>
		unseen: Array<{ id: string; order: number }>
	},
	savedCount: number,
) {
	if (removed.length > 0) {
		await delegate.deleteMany({
			where: { recipeId, id: { in: removed.map((row) => row.id) } },
		})
	}
	for (const [index, row] of unseen.entries()) {
		const order = savedCount + index
		if (row.order !== order) {
			await delegate.update({ where: { id: row.id }, data: { order } })
		}
	}
}
