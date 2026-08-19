import { createId } from '@paralleldrive/cuid2'
import { type PrismaClient } from '#app/generated/prisma/client.ts'

/**
 * Meal write seam for the switched planner (#105).
 *
 * Dual-write contract, in force until the #106 contraction: Meal and
 * MealRecipeItem are authoritative — the planner reads only them — but every
 * Recipe item write also mirrors a legacy MealPlanEntry row, because the
 * week-wide Shopping generator (and the legacy sections of full export) still
 * read MealPlanEntry until #106 mechanically ports them.
 *
 * The mirror link reuses the #104 backfill convention: item id =
 * 'mri-bf-' + <legacy entry id>, so backfilled and newly created items update
 * their legacy rows through one rule and the deploy-time delta migration
 * recognizes both. Mirrored rows set mealType to the parent Meal's id — an
 * opaque value that keeps the legacy @@unique([mealPlanId, date, mealType,
 * recipeId]) satisfiable for any Meal composition; nothing user-facing reads
 * mealType after this ticket. Mirrored servings approximate the item's
 * multiplier as round(multiplier × Recipe.servings) so legacy Shopping scaling
 * (override / Recipe.servings) stays equivalent. Text-only Meals mirror
 * nothing: they have no Shopping behavior. Meals restored by import have no
 * mirror link; their legacy rows arrive from the export's own entries section.
 */

const MIRROR_ITEM_PREFIX = 'mri-bf-'

export function legacyEntryIdForItem(itemId: string): string | null {
	return itemId.startsWith(MIRROR_ITEM_PREFIX)
		? itemId.slice(MIRROR_ITEM_PREFIX.length)
		: null
}

function mirrorServings(
	scaleMultiplier: number,
	recipeServings: number,
): number | null {
	if (scaleMultiplier === 1) return null
	return Math.min(
		999,
		Math.max(1, Math.round(scaleMultiplier * recipeServings)),
	)
}

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
 * Create one Meal with ordered Recipe items and their legacy mirror rows.
 * The caller has already authorized the plan and the Recipes for the
 * household. Items whose Recipe is gone (missing cards being copied) get no
 * mirror row — a missing card must not produce fresh Shopping demand.
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
	const liveRecipes = await db.recipe.findMany({
		where: { id: { in: items.flatMap((item) => item.recipeId ?? []) } },
		select: { id: true, servings: true },
	})
	const servingsById = new Map(liveRecipes.map((r) => [r.id, r.servings]))

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
		...items.flatMap((item, index) => {
			const recipeServings = item.recipeId
				? servingsById.get(item.recipeId)
				: undefined
			const mirrored = item.recipeId != null && recipeServings != null
			const entryId = createId()
			const itemCreate = (id: string) =>
				db.mealRecipeItem.create({
					data: {
						id,
						mealId,
						order: index,
						recipeId: item.recipeId,
						recipeTitle: item.recipeTitle,
						scaleMultiplier: item.scaleMultiplier,
						cooked: item.cooked ?? false,
					},
				})
			if (!mirrored) return [itemCreate(createId())]
			return [
				db.mealPlanEntry.create({
					data: {
						id: entryId,
						date,
						mealType: mealId,
						servings: mirrorServings(item.scaleMultiplier, recipeServings),
						cooked: item.cooked ?? false,
						mealPlanId,
						recipeId: item.recipeId!,
					},
				}),
				itemCreate(MIRROR_ITEM_PREFIX + entryId),
			]
		}),
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
			mealPlanId: string
			date: Date
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
	const entryId = createId()
	await db.$transaction([
		db.mealPlanEntry.create({
			data: {
				id: entryId,
				date: meal.date,
				mealType: meal.id,
				cooked: false,
				mealPlanId: meal.mealPlanId,
				recipeId: recipe.id,
			},
		}),
		db.mealRecipeItem.create({
			data: {
				id: MIRROR_ITEM_PREFIX + entryId,
				mealId: meal.id,
				order: (max._max.order ?? -1) + 1,
				recipeId: recipe.id,
				recipeTitle: recipe.title,
				scaleMultiplier: 1,
			},
		}),
	])
	return { created: true as const }
}

export async function setItemCooked(
	db: PrismaClient,
	{ itemId, cooked }: { itemId: string; cooked: boolean },
) {
	const legacyId = legacyEntryIdForItem(itemId)
	await db.$transaction([
		db.mealRecipeItem.update({ where: { id: itemId }, data: { cooked } }),
		// updateMany: the mirror row is gone when the Recipe was deleted
		// (legacy rows cascade), and imports have no mirror link at all.
		db.mealPlanEntry.updateMany({
			where: { id: legacyId ?? '' },
			data: { cooked },
		}),
	])
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
	const items = await db.mealRecipeItem.findMany({
		where: { mealId: meal.id },
		select: { id: true },
	})
	const legacyIds = items.flatMap((item) => legacyEntryIdForItem(item.id) ?? [])
	await db.$transaction([
		db.mealRecipeItem.updateMany({
			where: { mealId: meal.id },
			data: { cooked },
		}),
		db.mealPlanEntry.updateMany({
			where: { id: { in: legacyIds } },
			data: { cooked },
		}),
	])
}

export async function setItemMultiplier(
	db: PrismaClient,
	{
		item,
		scaleMultiplier,
	}: {
		item: { id: string; recipe: { servings: number } | null }
		scaleMultiplier: number
	},
) {
	const legacyId = legacyEntryIdForItem(item.id)
	await db.$transaction([
		db.mealRecipeItem.update({
			where: { id: item.id },
			data: { scaleMultiplier },
		}),
		db.mealPlanEntry.updateMany({
			where: { id: legacyId ?? '' },
			data: {
				servings: item.recipe
					? mirrorServings(scaleMultiplier, item.recipe.servings)
					: null,
			},
		}),
	])
}

/**
 * Remove one Recipe item (and its mirror row). Removing the last item removes
 * the Meal itself — a Recipe Meal with nothing in it is not a planned thing.
 */
export async function removeRecipeItem(
	db: PrismaClient,
	{ item }: { item: { id: string; mealId: string } },
) {
	const legacyId = legacyEntryIdForItem(item.id)
	return db.$transaction(async (tx) => {
		await tx.mealRecipeItem.delete({ where: { id: item.id } })
		await tx.mealPlanEntry.deleteMany({ where: { id: legacyId ?? '' } })
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
	const items = await db.mealRecipeItem.findMany({
		where: { mealId },
		select: { id: true },
	})
	const legacyIds = items.flatMap((item) => legacyEntryIdForItem(item.id) ?? [])
	await db.$transaction([
		db.mealPlanEntry.deleteMany({ where: { id: { in: legacyIds } } }),
		// Items cascade with the Meal.
		db.meal.delete({ where: { id: mealId } }),
	])
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
