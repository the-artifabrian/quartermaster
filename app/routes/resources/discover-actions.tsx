import { categoryToLocation } from '#app/utils/category-location-map.ts'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	getCanonicalIngredientName,
	matchRecipesWithInventory,
} from '#app/utils/recipe-matching.server.ts'
import { suggestExpiryDate } from '#app/utils/shelf-life.ts'
import { guessCategory } from '#app/utils/shopping-list-validation.ts'
import { type Route } from './+types/discover-actions.ts'

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'addMissing') {
		const recipeIdsParam = formData.get('recipeIds')
		if (typeof recipeIdsParam !== 'string' || !recipeIdsParam) {
			return { status: 'error' as const, intent: 'addMissing' as const, addedCount: 0 }
		}

		const recipeIds = recipeIdsParam.split(',').filter(Boolean)
		if (recipeIds.length === 0) {
			return { status: 'error' as const, intent: 'addMissing' as const, addedCount: 0 }
		}

		// Fetch the requested recipes with ingredients
		const recipes = await prisma.recipe.findMany({
			where: { id: { in: recipeIds }, householdId },
			include: { ingredients: true, image: { select: { objectKey: true } } },
		})

		// Fetch inventory items
		const inventoryItems = await prisma.inventoryItem.findMany({
			where: { householdId },
		})

		// Re-compute matching server-side for accuracy
		const matches = matchRecipesWithInventory(recipes, inventoryItems)

		// Collect all missing ingredients, deduplicate via canonical name
		const missingByCanonical = new Map<string, string>()
		for (const match of matches) {
			for (const ing of match.missingIngredients) {
				const canonical = getCanonicalIngredientName(ing.name)
				if (!missingByCanonical.has(canonical)) {
					missingByCanonical.set(canonical, ing.name)
				}
			}
		}

		if (missingByCanonical.size === 0) {
			return { status: 'success' as const, intent: 'addMissing' as const, addedCount: 0 }
		}

		// Get or create shopping list
		let shoppingList = await prisma.shoppingList.findFirst({
			where: { householdId },
			include: { items: { where: { checked: false } } },
		})

		if (!shoppingList) {
			shoppingList = await prisma.shoppingList.create({
				data: { userId, householdId },
				include: { items: { where: { checked: false } } },
			})
		}

		// Check existing items to avoid duplicates
		const existingCanonicals = new Set(
			shoppingList.items.map((item) => getCanonicalIngredientName(item.name)),
		)

		const itemsToAdd = [...missingByCanonical.entries()]
			.filter(([canonical]) => !existingCanonicals.has(canonical))
			.map(([, originalName]) => ({
				name: originalName,
				category: guessCategory(originalName),
				source: 'discover',
				listId: shoppingList.id,
			}))

		if (itemsToAdd.length > 0) {
			await prisma.shoppingListItem.createMany({ data: itemsToAdd })

			void emitHouseholdEvent({
				type: 'shopping_list_item_added',
				payload: { count: itemsToAdd.length, source: 'discover' },
				userId,
				householdId,
			})
		}

		return { status: 'success' as const, intent: 'addMissing' as const, addedCount: itemsToAdd.length }
	}

	if (intent === 'addToInventory') {
		const ingredientName = formData.get('ingredientName')
		if (typeof ingredientName !== 'string' || !ingredientName.trim()) {
			return { status: 'error' as const, intent: 'addToInventory' as const, addedCount: 0 }
		}

		const existingItems = await prisma.inventoryItem.findMany({
			where: { householdId },
			select: { name: true },
		})

		const canonicalNew = getCanonicalIngredientName(ingredientName)
		const alreadyExists = existingItems.some(
			(item) => getCanonicalIngredientName(item.name) === canonicalNew,
		)

		if (alreadyExists) {
			return { status: 'already_exists' as const, intent: 'addToInventory' as const, addedCount: 0 }
		}

		const trimmedName = ingredientName.trim()
		const category = guessCategory(trimmedName)
		const location = categoryToLocation(category)
		const expiresAt = suggestExpiryDate(trimmedName, location)

		await prisma.inventoryItem.create({
			data: {
				name: trimmedName,
				location,
				expiresAt: expiresAt ? new Date(expiresAt) : null,
				userId,
				householdId,
			},
		})

		void emitHouseholdEvent({
			type: 'inventory_item_added',
			payload: { itemName: trimmedName },
			userId,
			householdId,
		})

		return { status: 'success' as const, intent: 'addToInventory' as const, addedCount: 1 }
	}

	return { status: 'error' as const, addedCount: 0 }
}
