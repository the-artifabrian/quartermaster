// Restores the Plan in an export file: each week's Meals, or the fixed-slot
// entries of exports from before Meals.

import { z } from 'zod'
import { getWeekStart, parseDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { ensureMealPlan } from '#app/utils/meal-plan.server.ts'
import { createMealWithItems } from '#app/utils/meal.server.ts'
import { groupSnapshotEntries } from '#app/utils/menu-snapshot.ts'
import { menuTitleKey } from '#app/utils/menu-validation.ts'
import {
	type ImportMealItemSchema,
	type ImportMealPlanEntrySchema,
	type ImportMealPlanSchema,
	type ImportMealSchema,
	type ImportRecipe,
} from './+export-format.ts'
import { type RecipeIndex } from './restore-recipes.server.ts'
import {
	type RecordFailure,
	refusedWriteCode,
	type RestoreCounts,
	type RestoreFailure,
} from './restore-results.server.ts'

type ImportMeal = z.infer<typeof ImportMealSchema>
type ImportMealPlanEntry = z.infer<typeof ImportMealPlanEntrySchema>

const LEGACY_SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack']

/**
 * Exports from before Meals carry the fixed-slot `entries` shape. It restores
 * as Meals by the same rules the database used when it moved to Meals:
 * entries sharing a UTC day and meal type become one labeled Meal, a serving
 * override becomes override / Recipe.servings, day order runs breakfast,
 * lunch, dinner, snack, then unexpected labels lexically, and items keep file
 * order. An entry whose Recipe title has no match can't restore: the
 * fixed-slot shape froze no display identity to keep as a missing card. It
 * comes back as a failed entry, as does one with an unreadable date.
 */
type LegacyEntryFailure = {
	index: number
	reason: 'invalid-date' | 'recipe-not-in-file'
}

const FileDaySchema = z.union([
	z.iso.date(),
	z.iso.datetime({ offset: true, local: true }),
])

/**
 * A day from the file as UTC midnight, the way Meal days are stored, or null
 * when it isn't one. Exports write days as full ISO strings at UTC midnight,
 * and a hand-edited file may carry an offset; either way the day is the date
 * as written. Read as an instant, an offset would move it to another day.
 */
function fileDay(value: string): Date | null {
	return FileDaySchema.safeParse(value).success
		? parseDate(value.slice(0, 10))
		: null
}

function legacyEntriesToMeals(
	entries: ImportMealPlanEntry[],
	titleToIdMap: Map<string, string>,
	servingsByRecipeId: Map<string, number>,
): { meals: ImportMeal[]; failedEntries: LegacyEntryFailure[] } {
	const failedEntries: LegacyEntryFailure[] = []
	const groups = new Map<
		string,
		{ day: string; mealType: string; items: NonNullable<ImportMeal['items']> }
	>()
	for (const [index, entry] of entries.entries()) {
		const day = fileDay(entry.date)?.toISOString()
		if (!day) {
			failedEntries.push({ index, reason: 'invalid-date' })
			continue
		}
		const recipeId = titleToIdMap.get(entry.recipe.toLowerCase())
		if (!recipeId) {
			failedEntries.push({ index, reason: 'recipe-not-in-file' })
			continue
		}
		const recipeServings = servingsByRecipeId.get(recipeId)
		const scaleMultiplier =
			entry.servings != null && recipeServings != null && recipeServings > 0
				? entry.servings / recipeServings
				: 1
		const key = `${day}\u0000${entry.mealType}`
		const group = groups.get(key) ?? {
			day,
			mealType: entry.mealType,
			items: [],
		}
		group.items.push({
			kind: 'recipe',
			recipeTitle: entry.recipe,
			scaleMultiplier,
			cooked: entry.cooked ?? false,
		})
		groups.set(key, group)
	}
	const slotRank = (label: string) => {
		const index = LEGACY_SLOT_ORDER.indexOf(label)
		return index === -1 ? LEGACY_SLOT_ORDER.length : index
	}
	const meals = [...groups.values()]
		.sort(
			(a, b) =>
				a.day.localeCompare(b.day) ||
				slotRank(a.mealType) - slotRank(b.mealType) ||
				a.mealType.localeCompare(b.mealType),
		)
		.map((group) => ({
			date: group.day,
			label: group.mealType,
			items: group.items,
		}))
	return { meals, failedEntries }
}

/**
 * One restored or existing snapshot card, normalized for both dedupe keys and
 * creation. It is the same discriminated shape `createMealWithItems` takes.
 */
type ResolvedMealEntry =
	| {
			kind: 'recipe'
			recipeId: string | null
			recipeTitle: string
			scaleMultiplier: number
			cooked: boolean
			note: string | null
	  }
	| {
			kind: 'note'
			text: string
			shoppingLines: Array<{
				name: string
				quantity: string | null
				unit: string | null
			}>
	  }

function mealEntryKeyPart(entry: ResolvedMealEntry) {
	return entry.kind === 'recipe'
		? ([
				'recipe',
				entry.recipeTitle.toLocaleLowerCase(),
				entry.scaleMultiplier,
				entry.cooked,
				entry.note,
			] as const)
		: ([
				'note',
				entry.text,
				entry.shoppingLines.map((line) => [
					line.name,
					line.quantity,
					line.unit,
				]),
			] as const)
}

/**
 * How one restored or existing Meal is recognized on a later import: its full
 * content (snapshot sections, notes, and note Shopping lines included)
 * except within-day order and source Menu revision. A file Meal whose key
 * matches an existing Meal in the same week plan is skipped, so re-import
 * stays idempotent without a natural unique identity.
 */
function getMealImportKey(meal: {
	dateMs: number
	label: string | null
	genericText: string | null
	completed: boolean
	guestCount: number | null
	servingAtMs: number | null
	servingTimeZone: string | null
	sourceMenuId: string | null
	items: ResolvedMealEntry[]
	sections: Array<{ name: string | null; items: ResolvedMealEntry[] }>
}) {
	return JSON.stringify([
		meal.dateMs,
		meal.label,
		meal.genericText,
		meal.completed,
		meal.guestCount,
		meal.servingAtMs,
		meal.servingTimeZone,
		meal.sourceMenuId,
		meal.items.map(mealEntryKeyPart),
		meal.sections.map((section) => [
			section.name,
			section.items.map(mealEntryKeyPart),
		]),
	])
}

/**
 * Restores Meal parents, their ordered Recipe items, and their frozen Menu
 * snapshot structure (sections, note cards, note Shopping lines) into one
 * ensured week plan. Recipe references reconnect like Menu cards
 * do: reference key first, normalized-title fallback only when a key is
 * absent, unknown key ⇒ missing card. Imported Meals append after any
 * existing Meals on their day so the stored within-day order has no gaps.
 */
async function importMeals(
	meals: ImportMeal[],
	mealPlanId: string,
	recipeIndex: RecipeIndex,
	menuIdByTitleKey: Map<string, string | null>,
	mealIdByRef: Map<string, string>,
	{
		weekStart,
		locate,
		recordFailure,
	}: {
		/** The plan's Monday. A Meal dated outside its week would never show. */
		weekStart: Date
		locate: (index: number) => string
		recordFailure: RecordFailure
	},
) {
	const stats = { created: 0, skipped: 0, errored: 0 }
	const fail = (index: number, failure: Omit<RestoreFailure, 'at'>) => {
		recordFailure({ at: locate(index), ...failure })
		stats.errored++
	}

	const existingMeals = await prisma.meal.findMany({
		where: { mealPlanId },
		select: {
			id: true,
			date: true,
			order: true,
			label: true,
			genericText: true,
			completed: true,
			guestCount: true,
			servingAt: true,
			servingTimeZone: true,
			sourceMenuId: true,
			sections: {
				orderBy: { order: 'asc' },
				select: { id: true, name: true },
			},
			noteItems: {
				orderBy: { order: 'asc' },
				select: {
					text: true,
					order: true,
					sectionId: true,
					shoppingLines: {
						orderBy: { order: 'asc' },
						select: { name: true, quantity: true, unit: true },
					},
				},
			},
			recipeItems: {
				select: {
					recipeTitle: true,
					scaleMultiplier: true,
					cooked: true,
					note: true,
					order: true,
					sectionId: true,
				},
				orderBy: { order: 'asc' },
			},
		},
	})
	const mealIdByKey = new Map(
		existingMeals.map((meal) => {
			const recipeEntry = (item: {
				recipeTitle: string
				scaleMultiplier: number
				cooked: boolean
				note: string | null
			}): ResolvedMealEntry => ({
				kind: 'recipe',
				recipeId: null, // identity comes from the frozen title in the key
				recipeTitle: item.recipeTitle,
				scaleMultiplier: item.scaleMultiplier,
				cooked: item.cooked,
				note: item.note,
			})
			const key = getMealImportKey({
				dateMs: meal.date.getTime(),
				label: meal.label,
				genericText: meal.genericText,
				completed: meal.completed,
				guestCount: meal.guestCount,
				servingAtMs: meal.servingAt?.getTime() ?? null,
				servingTimeZone: meal.servingTimeZone,
				sourceMenuId: meal.sourceMenuId,
				items: meal.recipeItems
					.filter((item) => item.sectionId == null)
					.map(recipeEntry),
				sections: groupSnapshotEntries(
					meal.sections,
					meal.recipeItems,
					meal.noteItems,
				).map((group) => ({
					name: group.name,
					items: group.entries.map((entry): ResolvedMealEntry =>
						entry.kind === 'recipe'
							? recipeEntry(entry.item)
							: {
									kind: 'note',
									text: entry.item.text,
									shoppingLines: entry.item.shoppingLines,
								},
					),
				})),
			})
			return [key, meal.id] as const
		}),
	)
	const nextOrderByDay = new Map<number, number>()
	for (const meal of existingMeals) {
		const day = meal.date.getTime()
		nextOrderByDay.set(
			day,
			Math.max(nextOrderByDay.get(day) ?? 0, meal.order + 1),
		)
	}

	// Kind-aware entry resolution, shared by the unsectioned list and every
	// snapshot section. Unrepresentable cards drop: a Recipe entry with
	// neither a resolvable Recipe nor a frozen title, or a note entry with no
	// text. Note entries only mean something inside sections (snapshots never
	// store them unsectioned), so the unsectioned list keeps Recipe entries.
	const resolveEntry = (
		item: z.infer<typeof ImportMealItemSchema>,
	): ResolvedMealEntry[] => {
		if (item.kind === 'note') {
			const text = item.text?.trim()
			if (!text) return []
			return [
				{
					kind: 'note',
					text,
					shoppingLines: (item.shoppingLines ?? []).map((line) => ({
						name: line.name,
						quantity: line.quantity || null,
						unit: line.unit || null,
					})),
				},
			]
		}
		let recipeId: string | null = null
		if (item.recipeRef != null) {
			recipeId = recipeIndex.refToIdMap.get(item.recipeRef) ?? null
		} else if (item.recipeTitle) {
			recipeId =
				recipeIndex.titleToIdMap.get(item.recipeTitle.toLowerCase()) ?? null
		}
		const recipeTitle =
			item.recipeTitle ??
			(recipeId != null ? (recipeIndex.titleById.get(recipeId) ?? null) : null)
		if (recipeTitle == null) return []
		return [
			{
				kind: 'recipe',
				recipeId,
				recipeTitle,
				scaleMultiplier: item.scaleMultiplier ?? 1,
				cooked: item.cooked ?? false,
				note: item.note || null,
			},
		]
	}

	for (const [index, meal] of meals.entries()) {
		const date = fileDay(meal.date)
		if (!date) {
			fail(index, { reason: 'invalid-date' })
			continue
		}
		if (getWeekStart(date).getTime() !== weekStart.getTime()) {
			fail(index, { reason: 'outside-week' })
			continue
		}

		const items = (meal.items ?? [])
			.flatMap(resolveEntry)
			.filter(
				(entry): entry is Extract<ResolvedMealEntry, { kind: 'recipe' }> =>
					entry.kind === 'recipe',
			)
		const sections = (meal.sections ?? []).map((section) => ({
			name: section.name ?? null,
			items: (section.items ?? []).flatMap(resolveEntry),
		}))

		const genericText = meal.genericText || null
		// A Meal with neither generic text nor restorable snapshot content
		// would be an empty shell, so it fails. A note-only snapshot Meal is
		// valid and restores.
		const hasSectionContent = sections.some(
			(section) => section.items.length > 0,
		)
		if (genericText == null && items.length === 0 && !hasSectionContent) {
			fail(index, { reason: 'nothing-to-restore' })
			continue
		}

		// Parent completion belongs to text-only Meals; a Recipe Meal derives
		// completion from its items' cooked state.
		const completed = genericText != null ? (meal.completed ?? false) : false

		// The serving time is one instant plus the timezone it was set in. A
		// timezone without a valid instant means nothing, so they restore as a
		// pair.
		const servingAtParsed = meal.servingAt ? new Date(meal.servingAt) : null
		const servingAt =
			servingAtParsed && !Number.isNaN(servingAtParsed.getTime())
				? servingAtParsed
				: null
		const servingTimeZone = servingAt ? (meal.servingTimeZone ?? null) : null

		const sourceMenuId = meal.sourceMenuTitle
			? (menuIdByTitleKey.get(menuTitleKey(meal.sourceMenuTitle)) ?? null)
			: null
		const revisionParsed =
			sourceMenuId && meal.sourceMenuRevision
				? new Date(meal.sourceMenuRevision)
				: null
		const sourceMenuRevision =
			revisionParsed && !Number.isNaN(revisionParsed.getTime())
				? revisionParsed
				: null

		const key = getMealImportKey({
			dateMs: date.getTime(),
			label: meal.label ?? null,
			genericText,
			completed,
			guestCount: meal.guestCount ?? null,
			servingAtMs: servingAt?.getTime() ?? null,
			servingTimeZone,
			sourceMenuId,
			items,
			sections,
		})
		const existingMealId = mealIdByKey.get(key)
		if (existingMealId) {
			if (meal.ref && !mealIdByRef.has(meal.ref)) {
				mealIdByRef.set(meal.ref, existingMealId)
			}
			stats.skipped++
			continue
		}

		const day = date.getTime()
		const order = nextOrderByDay.get(day) ?? 0
		try {
			// createMealWithItems restores the Meal and its snapshot children in
			// one transaction, so it lands whole or not at all.
			const createdMealId = await createMealWithItems(prisma, {
				mealPlanId,
				date,
				order,
				label: meal.label ?? null,
				genericText,
				completed,
				guestCount: meal.guestCount ?? null,
				servingAt,
				servingTimeZone,
				sourceMenuId,
				sourceMenuRevision,
				items,
				sections,
			})
			mealIdByKey.set(key, createdMealId)
			if (meal.ref && !mealIdByRef.has(meal.ref)) {
				mealIdByRef.set(meal.ref, createdMealId)
			}
			nextOrderByDay.set(day, order + 1)
			stats.created++
		} catch (error) {
			const code = refusedWriteCode(error)
			if (!code) throw error
			fail(index, { reason: 'write-refused', code })
		}
	}

	return stats
}

type ImportMealPlan = z.infer<typeof ImportMealPlanSchema>

/**
 * Restores each week plan's Meals, or an older plan's fixed-slot entries,
 * after Recipes and Menus. Returns the restored Meal ids by export-local
 * reference key, which Shopping contributions point at.
 */
export async function importMealPlans(
	mealPlans: ImportMealPlan[],
	recipes: ImportRecipe[],
	recipeIndex: RecipeIndex,
	sharedMenuIdsByTitleKey: Map<string, string | null>,
	householdId: string,
	recordFailure: RecordFailure,
) {
	const stats = {
		mealPlans: { created: 0, skipped: 0, errored: 0 },
		meals: { created: 0, skipped: 0, errored: 0 },
	}
	const mealIdByRef = new Map<string, string>()
	// Source Menu titles resolve through this import's shared-copy mapping
	// first, then the existing household title for older/unshared Menus.
	const menuIdByTitleKey = new Map<string, string | null>()
	if (
		mealPlans.some((plan) => plan.meals?.some((meal) => meal.sourceMenuTitle))
	) {
		const householdMenus = await prisma.menu.findMany({
			where: { householdId },
			select: { id: true, titleKey: true },
		})
		for (const menu of householdMenus) {
			menuIdByTitleKey.set(menu.titleKey, menu.id)
		}
	}
	for (const [titleKey, id] of sharedMenuIdsByTitleKey) {
		menuIdByTitleKey.set(titleKey, id)
	}

	// Plans with only fixed-slot entries use the old file's own Recipe servings
	// to recover the override/base ratio. That value never reaches saved
	// Recipes or typed yield.
	let servingsByRecipeId = new Map<string, number>()
	if (mealPlans.some((plan) => !plan.meals?.length && plan.entries?.length)) {
		for (const recipe of recipes) {
			const recipeId = recipe.ref
				? recipeIndex.refToIdMap.get(recipe.ref)
				: recipeIndex.titleToIdMap.get(recipe.title.toLowerCase())
			if (recipeId && recipe.servings != null && recipe.servings > 0) {
				servingsByRecipeId.set(recipeId, recipe.servings)
			}
		}
	}

	const addMealStats = (mealStats: RestoreCounts) => {
		stats.meals.created += mealStats.created
		stats.meals.skipped += mealStats.skipped
		stats.meals.errored += mealStats.errored
	}

	for (const [planIndex, plan] of mealPlans.entries()) {
		const at = `mealPlans[${planIndex}]`
		// Any day of the week names it; the plan is kept under its Monday.
		const weekDay = fileDay(plan.weekStart)
		if (!weekDay) {
			// Without its week there is no plan to put the Meals in, so every
			// Meal (or older entry) in it fails.
			const meals = plan.meals?.length ?? 0
			const entries = meals > 0 ? 0 : (plan.entries?.length ?? 0)
			if (meals + entries > 0) {
				recordFailure({ at, reason: 'invalid-week', count: meals + entries })
			}
			stats.meals.errored += meals
			stats.mealPlans.errored += entries
			continue
		}

		const weekStart = getWeekStart(weekDay)
		const mealPlan = await ensureMealPlan(prisma, { householdId, weekStart })

		if (plan.meals?.length) {
			// A file that carries Meals restores only them. Some exports carry
			// `entries` too, as a second copy of the same Meals in the fixed-slot
			// shape.
			addMealStats(
				await importMeals(
					plan.meals,
					mealPlan.id,
					recipeIndex,
					menuIdByTitleKey,
					mealIdByRef,
					{
						weekStart,
						locate: (index) => `${at}.meals[${index}]`,
						recordFailure,
					},
				),
			)
		} else if (plan.entries?.length) {
			const { meals, failedEntries } = legacyEntriesToMeals(
				plan.entries,
				recipeIndex.titleToIdMap,
				servingsByRecipeId,
			)
			for (const { index, reason } of failedEntries) {
				recordFailure({ at: `${at}.entries[${index}]`, reason })
			}
			stats.mealPlans.errored += failedEntries.length
			addMealStats(
				await importMeals(
					meals,
					mealPlan.id,
					recipeIndex,
					menuIdByTitleKey,
					mealIdByRef,
					{
						weekStart,
						// Entries are grouped into Meals, so a Meal has no single
						// place in the file.
						locate: (index) => `${at}.entries (Meal ${index + 1})`,
						recordFailure,
					},
				),
			)
		}
	}

	return { stats, mealIdByRef }
}
