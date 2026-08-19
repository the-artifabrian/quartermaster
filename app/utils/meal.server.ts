import { createId } from '@paralleldrive/cuid2'
import { type PrismaClient } from '#app/generated/prisma/client.ts'

/**
 * Meal write seam for the planner (#105). Meal and MealRecipeItem are the
 * only Plan representation since #106 contracted the legacy fixed-slot
 * MealPlanEntry rows and their dual-write mirrors.
 */

async function nextMealOrder(db: PrismaClient, mealPlanId: string, date: Date) {
	const max = await db.meal.aggregate({
		_max: { order: true },
		where: { mealPlanId, date },
	})
	return (max._max.order ?? -1) + 1
}

export type MealItemSeed = {
	recipeId: string | null
	recipeTitle: string
	scaleMultiplier: number
	cooked?: boolean
}

/**
 * Create one Meal with ordered Recipe items. The caller has already
 * authorized the plan and the Recipes for the household.
 */
export async function createMealWithItems(
	db: PrismaClient,
	{
		mealPlanId,
		date,
		label = null,
		genericText = null,
		servingAt = null,
		servingTimeZone = null,
		guestCount = null,
		completed = false,
		items,
	}: {
		mealPlanId: string
		date: Date
		label?: string | null
		genericText?: string | null
		servingAt?: Date | null
		servingTimeZone?: string | null
		guestCount?: number | null
		completed?: boolean
		items: MealItemSeed[]
	},
) {
	const mealId = createId()
	const order = await nextMealOrder(db, mealPlanId, date)

	// Everything (ids included) is computed up front so the write is one short
	// batch transaction — long-held interactive transactions starve SQLite's
	// single writer under concurrent planning.
	await db.$transaction([
		db.meal.create({
			data: {
				id: mealId,
				mealPlanId,
				date,
				order,
				label,
				genericText,
				servingAt,
				servingTimeZone,
				guestCount,
				completed,
			},
		}),
		...items.map((item, index) =>
			db.mealRecipeItem.create({
				data: {
					id: createId(),
					mealId,
					order: index,
					recipeId: item.recipeId,
					recipeTitle: item.recipeTitle,
					scaleMultiplier: item.scaleMultiplier,
					cooked: item.cooked ?? false,
				},
			}),
		),
	])
	return mealId
}

/**
 * The one-Recipe fast path. Idempotent on (plan, day, label, Recipe) — the
 * same dedupe the legacy unique constraint gave slot assignment — so
 * double-taps and repeat submissions do not stack duplicate Meals.
 */
export async function createRecipeMeal(
	db: PrismaClient,
	{
		mealPlanId,
		date,
		label = null,
		recipe,
		scaleMultiplier = 1,
	}: {
		mealPlanId: string
		date: Date
		label?: string | null
		recipe: { id: string; title: string }
		scaleMultiplier?: number
	},
) {
	const existing = await db.meal.findFirst({
		where: {
			mealPlanId,
			date,
			label,
			recipeItems: { some: { recipeId: recipe.id } },
		},
		select: { id: true },
	})
	if (existing) return { created: false as const, mealId: existing.id }

	const mealId = await createMealWithItems(db, {
		mealPlanId,
		date,
		label,
		items: [
			{ recipeId: recipe.id, recipeTitle: recipe.title, scaleMultiplier },
		],
	})
	return { created: true as const, mealId }
}

/** Add a Recipe to an existing Meal. No-op when the Meal already holds it. */
export async function addRecipeToMeal(
	db: PrismaClient,
	{
		meal,
		recipe,
	}: {
		meal: {
			id: string
			genericText: string | null
		}
		recipe: { id: string; title: string }
	},
) {
	if (meal.genericText != null) {
		throw new Error('A text-only Meal cannot hold Recipe items')
	}
	const duplicate = await db.mealRecipeItem.findFirst({
		where: { mealId: meal.id, recipeId: recipe.id },
		select: { id: true },
	})
	if (duplicate) return { created: false as const }

	const max = await db.mealRecipeItem.aggregate({
		_max: { order: true },
		where: { mealId: meal.id },
	})
	await db.mealRecipeItem.create({
		data: {
			mealId: meal.id,
			order: (max._max.order ?? -1) + 1,
			recipeId: recipe.id,
			recipeTitle: recipe.title,
			scaleMultiplier: 1,
		},
	})
	return { created: true as const }
}

export async function setItemCooked(
	db: PrismaClient,
	{ itemId, cooked }: { itemId: string; cooked: boolean },
) {
	await db.mealRecipeItem.update({ where: { id: itemId }, data: { cooked } })
}

/**
 * Meal-level completion. A Recipe Meal's completion is derived from its items,
 * so "mark Meal cooked" explicitly updates all items (#98); a text-only Meal
 * owns one completed flag instead.
 */
export async function setMealCooked(
	db: PrismaClient,
	{
		meal,
		cooked,
	}: {
		meal: { id: string; genericText: string | null }
		cooked: boolean
	},
) {
	if (meal.genericText != null) {
		await db.meal.update({
			where: { id: meal.id },
			data: { completed: cooked },
		})
		return
	}
	await db.mealRecipeItem.updateMany({
		where: { mealId: meal.id },
		data: { cooked },
	})
}

export async function setItemMultiplier(
	db: PrismaClient,
	{
		itemId,
		scaleMultiplier,
	}: {
		itemId: string
		scaleMultiplier: number
	},
) {
	await db.mealRecipeItem.update({
		where: { id: itemId },
		data: { scaleMultiplier },
	})
}

/**
 * Remove one Recipe item. Removing the last item removes the Meal itself — a
 * Recipe Meal with nothing in it is not a planned thing.
 */
export async function removeRecipeItem(
	db: PrismaClient,
	{ item }: { item: { id: string; mealId: string } },
) {
	return db.$transaction(async (tx) => {
		await tx.mealRecipeItem.delete({ where: { id: item.id } })
		const remaining = await tx.mealRecipeItem.count({
			where: { mealId: item.mealId },
		})
		if (remaining === 0) {
			await tx.meal.delete({ where: { id: item.mealId } })
			return { mealDeleted: true as const }
		}
		return { mealDeleted: false as const }
	})
}

export async function removeMeal(
	db: PrismaClient,
	{ mealId }: { mealId: string },
) {
	// Items cascade with the Meal.
	await db.meal.delete({ where: { id: mealId } })
}

/**
 * Move a Meal one step within its day. Explicit manual order is authoritative
 * (#98) — label and serving time never reorder anything. Rewrites the whole
 * day 0..n so gaps and ties repair themselves.
 */
export async function moveMealInDay(
	db: PrismaClient,
	{
		meal,
		direction,
	}: {
		meal: { id: string; mealPlanId: string; date: Date }
		direction: 'up' | 'down'
	},
) {
	const dayMeals = await db.meal.findMany({
		where: { mealPlanId: meal.mealPlanId, date: meal.date },
		orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
		select: { id: true },
	})
	const index = dayMeals.findIndex((m) => m.id === meal.id)
	const target = direction === 'up' ? index - 1 : index + 1
	if (index === -1 || target < 0 || target >= dayMeals.length) return
	const reordered = [...dayMeals]
	;[reordered[index], reordered[target]] = [
		reordered[target]!,
		reordered[index]!,
	]
	await db.$transaction(
		reordered.map((m, order) =>
			db.meal.update({ where: { id: m.id }, data: { order } }),
		),
	)
}
