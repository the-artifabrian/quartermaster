import { createId } from '@paralleldrive/cuid2'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { type SnapshotSectionSeed } from '#app/utils/menu-snapshot.ts'

/**
 * Meal writes for the planner, the Menu's Add to Plan and the restore. A Meal
 * holds ordered MealRecipeItems and, when it came from a Menu, the frozen
 * snapshot rows (MealSection, MealNoteItem, MealShoppingLine).
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
	note?: string | null
}

/**
 * Create one Meal with ordered Recipe items and, for Menu snapshots,
 * frozen sections whose Recipe and note cards share one order sequence. The
 * caller has already authorized the plan and the Recipes for the household.
 * `order` places the Meal within its day (a restore passes the stored
 * order). When absent the Meal appends after the day's existing Meals.
 */
export async function createMealWithItems(
	db: PrismaClient,
	{
		mealPlanId,
		date,
		order: explicitOrder,
		label = null,
		genericText = null,
		servingAt = null,
		servingTimeZone = null,
		guestCount = null,
		completed = false,
		sourceMenuId = null,
		sourceMenuRevision = null,
		items,
		sections = [],
	}: {
		mealPlanId: string
		date: Date
		order?: number
		label?: string | null
		genericText?: string | null
		servingAt?: Date | null
		servingTimeZone?: string | null
		guestCount?: number | null
		completed?: boolean
		sourceMenuId?: string | null
		sourceMenuRevision?: Date | null
		items: MealItemSeed[]
		sections?: SnapshotSectionSeed[]
	},
) {
	const mealId = createId()
	const order = explicitOrder ?? (await nextMealOrder(db, mealPlanId, date))

	// Everything (ids included) is computed up front so the write is one short
	// batch transaction. A long interactive transaction would hold SQLite's
	// single writer while two people plan at once.
	const sectionSeeds = sections.map((section) => ({
		...section,
		id: createId(),
	}))
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
				sourceMenuId,
				sourceMenuRevision,
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
					note: item.note ?? null,
				},
			}),
		),
		...sectionSeeds.map((section, index) =>
			db.mealSection.create({
				data: {
					id: section.id,
					mealId,
					name: section.name,
					order: index,
				},
			}),
		),
		...sectionSeeds.flatMap((section) =>
			section.items.map((item, index) =>
				item.kind === 'recipe'
					? db.mealRecipeItem.create({
							data: {
								id: createId(),
								mealId,
								sectionId: section.id,
								order: index,
								recipeId: item.recipeId,
								recipeTitle: item.recipeTitle,
								scaleMultiplier: item.scaleMultiplier,
								cooked: item.cooked ?? false,
								note: item.note ?? null,
							},
						})
					: db.mealNoteItem.create({
							data: {
								id: createId(),
								mealId,
								sectionId: section.id,
								order: index,
								text: item.text,
								shoppingLines: {
									create: item.shoppingLines.map((line, lineOrder) => ({
										id: createId(),
										name: line.name,
										quantity: line.quantity,
										unit: line.unit,
										order: lineOrder,
									})),
								},
							},
						}),
			),
		),
	])
	return mealId
}

/**
 * The one-Recipe fast path. Idempotent on (plan, day, label, Recipe), so
 * double-taps and repeat submissions do not stack duplicate Meals.
 *
 * Returns the Meal that now holds the Recipe together with the multiplier it
 * actually carries: a match keeps its own multiplier, so the caller can say
 * what is planned instead of implying the requested scale was applied.
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
		// Repeat submissions must resolve to the same Meal, so the day's manual
		// order decides when more than one Meal holds the Recipe.
		orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
		select: {
			id: true,
			recipeItems: {
				where: { recipeId: recipe.id },
				orderBy: [{ order: 'asc' }, { id: 'asc' }],
				take: 1,
				select: { scaleMultiplier: true },
			},
		},
	})
	if (existing) {
		return {
			created: false as const,
			mealId: existing.id,
			// The `some` filter above guarantees the matching item exists.
			scaleMultiplier: existing.recipeItems[0]!.scaleMultiplier,
		}
	}

	const mealId = await createMealWithItems(db, {
		mealPlanId,
		date,
		label,
		items: [
			{ recipeId: recipe.id, recipeTitle: recipe.title, scaleMultiplier },
		],
	})
	return { created: true as const, mealId, scaleMultiplier }
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

	// Later additions to a snapshot Meal append unsectioned, after the frozen
	// sections, and `order` counts within the unsectioned group.
	const max = await db.mealRecipeItem.aggregate({
		_max: { order: true },
		where: { mealId: meal.id, sectionId: null },
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
 * so marking the Meal cooked updates every item. A text-only Meal has its own
 * completed flag instead.
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
 * Move a Meal one step within its day. The order the user set is the only
 * order; label and serving time never reorder anything. Rewrites the whole
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
