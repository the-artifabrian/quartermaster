import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { createId } from '@paralleldrive/cuid2'
import { useEffect, useRef, useState } from 'react'
import { data, Link, useFetcher } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import {
	householdIngredientDisplayName,
	householdIngredientKey,
} from '#app/utils/household-ingredient.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { ensureMealPlan } from '#app/utils/meal-plan.server.ts'
import { createMealWithItems } from '#app/utils/meal.server.ts'
import { groupSnapshotEntries } from '#app/utils/menu-snapshot.ts'
import { menuTitleKey } from '#app/utils/menu-validation.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { getUserTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/import.ts'
import { type SettingsPageHandle } from './_layout.tsx'

export const handle: SettingsPageHandle & SEOHandle = {
	pageTitle: 'Import Data',
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Import Data | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithHousehold(request)
	return {}
}

// --- Zod Schemas ---

const ImportIngredientSchema = z.object({
	name: z.string().min(1).max(200),
	amount: z.string().max(50).nullable().optional(),
	unit: z.string().max(50).nullable().optional(),
	notes: z.string().max(500).nullable().optional(),
})

const ImportRecipeSchema = z.object({
	// Export-local reference key — how Menus reconnect to their Recipes (#102).
	ref: z.string().max(50).optional(),
	title: z.string().min(1).max(100),
	description: z.string().max(500).nullable().optional(),
	servings: z.number().int().positive().nullable().optional(),
	prepTime: z.number().int().nonnegative().nullable().optional(),
	cookTime: z.number().int().nonnegative().nullable().optional(),
	isFavorite: z.boolean().optional(),
	sourceUrl: z.string().max(2000).nullable().optional(),
	notes: z.string().max(5000).nullable().optional(),
	ingredients: z.array(ImportIngredientSchema).max(200),
	instructions: z
		.array(
			z.union([
				z.string().min(1).max(5000),
				z.object({ content: z.string().min(1).max(5000) }),
			]),
		)
		.max(200),
	tags: z.any().optional(),
	image: z.any().optional(),
})

const ImportInventoryItemSchema = z.object({
	name: z
		.string()
		.min(1)
		.max(200)
		.transform((s) => s.toLowerCase()),
	location: z.enum(['pantry', 'fridge', 'freezer']).optional(), // accepted for backward compat (ignored)
	quantity: z.number().nullable().optional(),
	unit: z.string().max(50).nullable().optional(),
	expiresAt: z.string().nullable().optional(), // accepted for backward compat (ignored)
	lowStock: z.boolean().optional(), // accepted for backward compat (ignored)
})

const ImportHouseholdIngredientSchema = z
	.object({
		displayName: z
			.string()
			.transform(householdIngredientDisplayName)
			.pipe(z.string().min(1).max(200)),
		canonicalKey: z.string().min(1).max(200),
		isStaple: z.boolean(),
		isOut: z.boolean(),
	})
	.superRefine((ingredient, context) => {
		if (
			ingredient.canonicalKey !== householdIngredientKey(ingredient.displayName)
		) {
			context.addIssue({
				code: 'custom',
				message:
					'Household ingredient canonical key does not match its display name',
				path: ['canonicalKey'],
			})
		}
		if (ingredient.isOut && !ingredient.isStaple) {
			context.addIssue({
				code: 'custom',
				message: 'Only a Staple can be Out',
				path: ['isOut'],
			})
		}
	})

const ImportHouseholdSchema = z.object({
	staplesCutoverAt: z
		.string()
		.refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid cutover date')
		.nullable()
		.optional(),
})

// The retired fixed-slot representation (#106). Pre-#104 exports carry only
// this shape, so it stays parseable and restores as Meals; current exports
// no longer contain it.
const ImportMealPlanEntrySchema = z.object({
	date: z.string(),
	mealType: z.string().max(50),
	servings: z.number().int().positive().nullable().optional(),
	cooked: z.boolean().optional(),
	recipe: z.string().min(1).max(100),
})

// Shared by Menu note cards and Meal snapshot note cards (#107).
const ImportMenuShoppingLineSchema = z.object({
	name: z.string().min(1).max(200),
	quantity: z.string().max(50).nullable().optional(),
	unit: z.string().max(50).nullable().optional(),
})

// One schema for both snapshot card kinds, like Menu cards: `kind` decides
// which fields are read, defaulting to 'recipe' so pre-#107 exports parse.
const ImportMealItemSchema = z.object({
	kind: z.enum(['recipe', 'note']).optional().default('recipe'),
	// Export-local reference key. When present it alone decides the Recipe
	// link — an unknown ref restores as a missing card, never a title guess.
	recipeRef: z.string().max(50).nullable().optional(),
	recipeTitle: z.string().min(1).max(100).nullable().optional(),
	// Migrated multipliers are exact override/servings ratios, so unlike Menu
	// cards they are not clamped to two decimals or 100 — recovery preserves
	// the stored value.
	scaleMultiplier: z.number().positive().max(1000).nullable().optional(),
	cooked: z.boolean().optional(),
	note: z.string().max(500).nullable().optional(),
	text: z.string().max(1000).nullable().optional(),
	shoppingLines: z.array(ImportMenuShoppingLineSchema).max(20).optional(),
})

// A frozen snapshot section (#107): name (null = the unnamed section) plus
// Recipe and note cards interleaved in their shared order.
const ImportMealSectionSchema = z.object({
	name: z.string().min(1).max(100).nullable().optional(),
	items: z.array(ImportMealItemSchema).max(100).optional(),
})

const ImportMealSchema = z
	.object({
		// Export-local source key for current Shopping contributions (#110).
		ref: z.string().max(50).optional(),
		date: z.string(),
		order: z.number().int().nonnegative().optional(),
		label: z.string().max(50).nullable().optional(),
		servingAt: z.string().nullable().optional(),
		servingTimeZone: z.string().max(100).nullable().optional(),
		genericText: z.string().max(1000).nullable().optional(),
		completed: z.boolean().optional(),
		guestCount: z.number().int().positive().max(999).nullable().optional(),
		sourceMenuTitle: z.string().max(100).nullable().optional(),
		sourceMenuRevision: z.string().nullable().optional(),
		items: z.array(ImportMealItemSchema).max(100).optional(),
		// Optional so every pre-#107 export stays importable.
		sections: z.array(ImportMealSectionSchema).max(20).optional(),
	})
	// Generic text and Recipe/snapshot content are mutually exclusive on a
	// saved Meal (#98 readiness corrections).
	.refine(
		(meal) =>
			!(
				meal.genericText &&
				((meal.items?.length ?? 0) > 0 ||
					(meal.sections ?? []).some(
						(section) => (section.items?.length ?? 0) > 0,
					))
			),
		{
			message: 'A Meal cannot carry both generic text and snapshot cards',
		},
	)

const ImportMealPlanSchema = z.object({
	weekStart: z.string(),
	// Optional since #106 stopped exporting the legacy shape; when a file
	// carries only entries (pre-#104 exports) they restore as Meals.
	entries: z.array(ImportMealPlanEntrySchema).max(100).optional(),
	// Optional so every pre-Meal export stays importable (#104).
	meals: z.array(ImportMealSchema).max(200).optional(),
})

const ImportShoppingListItemSchema = z.object({
	name: z.string().min(1).max(200),
	quantity: z.string().max(50).nullable().optional(),
	unit: z.string().max(50).nullable().optional(),
	category: z.string().max(50).nullable().optional(),
	checked: z.boolean().optional(),
	source: z.string().max(50).optional(),
	// Optional so pre-#110 exports remain importable.
	mealContributions: z
		.array(
			z.object({
				sourceMealRef: z.string().max(50).nullable(),
				orphaned: z.boolean(),
				fingerprint: z.object({
					canonicalName: z.string().min(1).max(200),
					name: z.string().min(1).max(200),
					quantity: z.string().max(50).nullable(),
					unit: z.string().max(50).nullable(),
				}),
			}),
		)
		.max(500)
		.optional(),
})

const ImportShoppingListSchema = z.object({
	name: z.string().min(1).max(200).optional().default('Shopping List'),
	items: z.array(ImportShoppingListItemSchema).max(500),
})

// One schema for both card kinds — Recipe fields and note fields are each
// optional so the other kind parses; `kind` decides which are read.
const ImportMenuItemSchema = z.object({
	kind: z.enum(['recipe', 'note']).optional().default('recipe'),
	recipeRef: z.string().max(50).nullable().optional(),
	recipeTitle: z.string().max(100).nullable().optional(),
	scaleMultiplier: z.number().positive().max(100).nullable().optional(),
	note: z.string().max(500).nullable().optional(),
	text: z.string().max(1000).nullable().optional(),
	shoppingLines: z.array(ImportMenuShoppingLineSchema).max(20).optional(),
})

const ImportMenuSectionSchema = z.object({
	// null marks the headingless unnamed section
	name: z.string().min(1).max(100).nullable().optional(),
	items: z.array(ImportMenuItemSchema).max(100).optional(),
})

const ImportMenuSchema = z.object({
	title: z.string().trim().min(1).max(100),
	description: z.string().max(500).nullable().optional(),
	defaultGuestCount: z.number().int().positive().max(999).nullable().optional(),
	sections: z.array(ImportMenuSectionSchema).max(20).optional(),
})

// Older full exports may contain a `cookingLogs` array — the feature was
// removed, and the loose object lets those files import with logs ignored.
const FullExportSchema = z.looseObject({
	format: z.literal('quartermaster-full-export-v1'),
	recipes: z.array(ImportRecipeSchema).max(500),
	household: ImportHouseholdSchema.optional(),
	householdIngredients: z
		.array(ImportHouseholdIngredientSchema)
		.max(1000)
		.optional(),
	inventory: z.array(ImportInventoryItemSchema).max(1000).optional(),
	mealPlans: z.array(ImportMealPlanSchema).max(200).optional(),
	shoppingLists: z.array(ImportShoppingListSchema).max(100).optional(),
	// Optional so every pre-Menu export stays importable (#102).
	menus: z.array(ImportMenuSchema).max(200).optional(),
})

const RecipeOnlyExportSchema = z.looseObject({
	recipeCount: z.number(),
	recipes: z.array(ImportRecipeSchema).max(500),
})

type FullExport = z.infer<typeof FullExportSchema>
type RecipeOnlyExport = z.infer<typeof RecipeOnlyExportSchema>
type ImportRecipe = z.infer<typeof ImportRecipeSchema>

function parseImportData(
	parsed: unknown,
):
	| { type: 'full'; data: FullExport }
	| { type: 'recipe-only'; data: RecipeOnlyExport }
	| { error: string } {
	if (typeof parsed !== 'object' || parsed === null) {
		return { error: 'Invalid JSON format' }
	}

	const obj = parsed as Record<string, unknown>

	if (obj.format === 'quartermaster-full-export-v1') {
		const result = FullExportSchema.safeParse(parsed)
		if (result.success) return { type: 'full', data: result.data }
		return {
			error: `Invalid data: ${result.error.issues[0]?.message ?? 'validation failed'}`,
		}
	}

	if ('recipeCount' in obj) {
		const result = RecipeOnlyExportSchema.safeParse(parsed)
		if (result.success) return { type: 'recipe-only', data: result.data }
		return {
			error: `Invalid data: ${result.error.issues[0]?.message ?? 'validation failed'}`,
		}
	}

	return { error: 'Unrecognized format. Expected a Quartermaster export file.' }
}

// --- Preview types ---

interface ImportPreview {
	recipes: number
	menus: number
	householdIngredients: number
	inventory: number
	mealPlans: number
	meals: number
	shoppingLists: number
	isFullExport: boolean
}

interface ImportResults {
	recipes: { created: number; skipped: number; errored: number }
	menus: { created: number; skipped: number; errored: number }
	householdIngredients: { created: number; skipped: number }
	staplesCutoverRestored: boolean
	inventory: { created: number; skipped: number }
	mealPlans: { created: number; skipped: number }
	meals: { created: number; skipped: number }
	shoppingLists: { created: number; skipped: number }
}

type ShoppingListItemImport = {
	name: string
	quantity: string | null
	unit: string | null
	category: string | null
	checked: boolean
	source: string
}

function getShoppingListItemImportKey(item: ShoppingListItemImport) {
	return JSON.stringify([
		item.name.trim().toLocaleLowerCase(),
		item.quantity?.trim() || null,
		item.unit?.trim().toLocaleLowerCase() || null,
		item.category?.trim().toLocaleLowerCase() || null,
		item.checked,
		item.source.trim().toLocaleLowerCase(),
	])
}

// --- Action ---

/**
 * How the import file's Recipes resolve to household Recipe rows once the
 * Recipe pass finishes: by export-local reference key, by normalized title,
 * and back to a display title for freezing on Menu cards.
 */
interface RecipeIndex {
	titleToIdMap: Map<string, string>
	refToIdMap: Map<string, string>
	titleById: Map<string, string>
}

async function importRecipes(
	recipes: ImportRecipe[],
	{ titleToIdMap, refToIdMap, titleById }: RecipeIndex,
	userId: string,
	householdId: string,
) {
	const stats = { created: 0, skipped: 0, errored: 0 }

	for (const recipe of recipes) {
		const lowerTitle = recipe.title.toLowerCase()
		const existingId = titleToIdMap.get(lowerTitle)
		if (existingId != null) {
			// A skipped duplicate still resolves its reference key — Menus that
			// point at it reconnect to the existing household Recipe.
			if (recipe.ref) refToIdMap.set(recipe.ref, existingId)
			stats.skipped++
			continue
		}
		try {
			const instructions = recipe.instructions.map((inst, order) => ({
				content: typeof inst === 'string' ? inst : inst.content,
				order,
			}))

			const created = await prisma.recipe.create({
				data: {
					title: recipe.title,
					description: recipe.description || null,
					servings: recipe.servings ?? undefined,
					prepTime: recipe.prepTime ?? undefined,
					cookTime: recipe.cookTime ?? undefined,
					isFavorite: recipe.isFavorite ?? false,
					sourceUrl: recipe.sourceUrl || null,
					notes: recipe.notes || null,
					userId,
					householdId,
					ingredients: {
						create: recipe.ingredients.map((ing, order) => ({
							name: ing.name,
							amount: ing.amount || null,
							unit: ing.unit || null,
							notes: ing.notes || null,
							order,
						})),
					},
					instructions: { create: instructions },
				},
				select: { id: true },
			})
			titleToIdMap.set(lowerTitle, created.id)
			titleById.set(created.id, recipe.title)
			if (recipe.ref) refToIdMap.set(recipe.ref, created.id)
			stats.created++
		} catch {
			stats.errored++
		}
	}

	return stats
}

type ImportMenu = z.infer<typeof ImportMenuSchema>
type ImportMenuItem = z.infer<typeof ImportMenuItemSchema>

/**
 * Restores Menus after the Recipe pass. References reconnect by export-local
 * reference key, falling back to normalized Recipe title only when a key is
 * absent (older or hand-edited data). On a normalized Menu-title collision
 * the existing target Menu wins and the imported Menu is skipped wholesale;
 * within one import the first occurrence wins.
 */
async function importMenus(
	menus: ImportMenu[],
	recipeIndex: RecipeIndex,
	householdId: string,
) {
	const stats = { created: 0, skipped: 0, errored: 0 }

	const existingMenus = await prisma.menu.findMany({
		where: { householdId },
		select: { titleKey: true },
	})
	const takenTitleKeys = new Set(existingMenus.map((menu) => menu.titleKey))

	for (const menu of menus) {
		const titleKey = menuTitleKey(menu.title)
		if (takenTitleKeys.has(titleKey)) {
			stats.skipped++
			continue
		}
		takenTitleKeys.add(titleKey)

		// At most one unnamed section per Menu: the file's first unnamed
		// section wins, later unnamed ones merge into it. A Menu with no
		// unnamed section is valid; one with no sections at all still gets the
		// starting empty unnamed section so its cards have somewhere to live.
		const sections: Array<{
			name: string | null
			items: ImportMenuItem[]
		}> = []
		let unnamedIndex = -1
		for (const section of menu.sections ?? []) {
			const items = section.items ?? []
			if (section.name == null) {
				if (unnamedIndex === -1) {
					unnamedIndex = sections.length
					sections.push({ name: null, items: [...items] })
				} else {
					sections[unnamedIndex]!.items.push(...items)
				}
			} else {
				sections.push({ name: section.name, items: [...items] })
			}
		}
		if (sections.length === 0) sections.push({ name: null, items: [] })

		// A Recipe appears once per Menu — a second resolved occurrence imports
		// as a missing card so structure and frozen identity still survive.
		const usedRecipeIds = new Set<string>()
		const resolveItem = (item: ImportMenuItem) => {
			if (item.kind === 'note') {
				return {
					kind: 'note' as const,
					note: item.text ?? '',
					shoppingLines: {
						create: (item.shoppingLines ?? []).map((line, order) => ({
							name: line.name,
							quantity: line.quantity || null,
							unit: line.unit || null,
							order,
						})),
					},
				}
			}
			let recipeId: string | null = null
			if (item.recipeRef != null) {
				recipeId = recipeIndex.refToIdMap.get(item.recipeRef) ?? null
			} else if (item.recipeTitle) {
				recipeId =
					recipeIndex.titleToIdMap.get(item.recipeTitle.toLowerCase()) ?? null
			}
			if (recipeId != null) {
				if (usedRecipeIds.has(recipeId)) recipeId = null
				else usedRecipeIds.add(recipeId)
			}
			const recipeTitle =
				item.recipeTitle ??
				(recipeId != null
					? (recipeIndex.titleById.get(recipeId) ?? null)
					: null)
			return {
				kind: 'recipe' as const,
				recipeId,
				recipeTitle,
				// Stored multipliers stay positive with at most two decimals; a
				// crafted sub-0.005 value must not round down to zero.
				scaleMultiplier:
					item.scaleMultiplier != null
						? Math.max(0.01, Math.round(item.scaleMultiplier * 100) / 100)
						: 1,
				note: item.note || null,
			}
		}

		try {
			// One nested create per Menu — it restores atomically or not at all.
			await prisma.menu.create({
				data: {
					title: menu.title,
					titleKey,
					description: menu.description || null,
					defaultGuestCount: menu.defaultGuestCount ?? null,
					householdId,
					sections: {
						create: sections.map((section, order) => ({
							name: section.name,
							order,
							items: {
								create: section.items.map((item, itemOrder) => ({
									order: itemOrder,
									...resolveItem(item),
								})),
							},
						})),
					},
				},
				select: { id: true },
			})
			stats.created++
		} catch {
			stats.errored++
		}
	}

	return stats
}

type ImportMeal = z.infer<typeof ImportMealSchema>
type ImportMealPlanEntry = z.infer<typeof ImportMealPlanEntrySchema>

const LEGACY_SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack']

/**
 * Pre-#104 exports carry the retired fixed-slot `entries` shape. It restores
 * as Meals under the #104 backfill's recovery rules: entries sharing a UTC
 * day and meal type become one labeled Meal, a serving override becomes
 * override / Recipe.servings, day order runs breakfast, lunch, dinner, snack,
 * then unexpected labels lexically, and items keep file order. An entry whose
 * Recipe title has no match is skipped like the legacy import path skipped
 * it — the retired shape froze no display identity to keep as a missing card.
 */
function legacyEntriesToMeals(
	entries: ImportMealPlanEntry[],
	titleToIdMap: Map<string, string>,
	servingsByRecipeId: Map<string, number>,
): { meals: ImportMeal[]; skippedEntries: number } {
	let skippedEntries = 0
	const groups = new Map<
		string,
		{ day: string; mealType: string; items: NonNullable<ImportMeal['items']> }
	>()
	for (const entry of entries) {
		const parsed = new Date(entry.date)
		if (Number.isNaN(parsed.getTime())) {
			skippedEntries++
			continue
		}
		const recipeId = titleToIdMap.get(entry.recipe.toLowerCase())
		if (!recipeId) {
			skippedEntries++
			continue
		}
		const day = new Date(
			Date.UTC(
				parsed.getUTCFullYear(),
				parsed.getUTCMonth(),
				parsed.getUTCDate(),
			),
		).toISOString()
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
	return { meals, skippedEntries }
}

/**
 * One restored or existing snapshot card, normalized for both dedupe keys and
 * creation — the same discriminated shape the Meal write seam consumes.
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
 * content — snapshot sections, notes, and note Shopping lines included —
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
 * snapshot structure (#107: sections, note cards, note Shopping lines) into
 * one ensured week plan (#104). Recipe references reconnect like Menu cards
 * do: reference key first, normalized-title fallback only when a key is
 * absent, unknown key ⇒ missing card. Imported Meals append after any
 * existing Meals on their day so explicit within-day order stays contiguous.
 */
async function importMeals(
	meals: ImportMeal[],
	mealPlanId: string,
	recipeIndex: RecipeIndex,
	menuIdByTitleKey: Map<string, string>,
	mealIdByRef: Map<string, string>,
) {
	const stats = { created: 0, skipped: 0 }

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
	// text. Note entries are only meaningful inside sections — snapshots never
	// store them unsectioned — so the unsectioned list keeps Recipe entries.
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

	for (const meal of meals) {
		const date = new Date(meal.date)
		if (Number.isNaN(date.getTime())) {
			stats.skipped++
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
		// would be an empty shell — skip it. A note-only snapshot Meal is valid
		// (#98 readiness corrections) and restores.
		const hasSectionContent = sections.some(
			(section) => section.items.length > 0,
		)
		if (genericText == null && items.length === 0 && !hasSectionContent) {
			stats.skipped++
			continue
		}

		// Parent completion belongs to text-only Meals; a Recipe Meal derives
		// completion from its items' cooked state.
		const completed = genericText != null ? (meal.completed ?? false) : false

		// The serving time is one instant plus its originating timezone — a
		// timezone without a valid instant is meaningless, so they restore as a
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
			// The shared Meal write seam restores the Meal and its snapshot
			// children in one transaction — atomically or not at all.
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
		} catch {
			stats.skipped++
		}
	}

	return stats
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const formData = await request.formData()
	const rawJson = formData.get('importData')

	if (typeof rawJson !== 'string') {
		return data(
			{ error: 'No import data provided', results: null },
			{ status: 400 },
		)
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(rawJson)
	} catch {
		return data(
			{ error: 'Invalid JSON format', results: null },
			{ status: 400 },
		)
	}

	const importResult = parseImportData(parsed)
	if ('error' in importResult) {
		return data({ error: importResult.error, results: null }, { status: 400 })
	}

	const { isProActive } = await getUserTier(userId)

	const recipes = importResult.data.recipes
	// Legacy Pro-only data (inventory, meal plans, shopping lists) is skipped
	// for free users. Recipes and household-owned canonical data are not gated.
	const fullData =
		importResult.type === 'full' && isProActive ? importResult.data : null
	// Household-owned canonical data is available on every tier. Keep its
	// recovery path independent from the legacy Pro-only full-data sections.
	const fullHouseholdData =
		importResult.type === 'full' ? importResult.data : null

	const results: ImportResults = {
		recipes: { created: 0, skipped: 0, errored: 0 },
		menus: { created: 0, skipped: 0, errored: 0 },
		householdIngredients: { created: 0, skipped: 0 },
		staplesCutoverRestored: false,
		inventory: { created: 0, skipped: 0 },
		mealPlans: { created: 0, skipped: 0 },
		meals: { created: 0, skipped: 0 },
		shoppingLists: { created: 0, skipped: 0 },
	}

	// --- 1. Recipes ---
	const recipeIndex: RecipeIndex = {
		titleToIdMap: new Map(),
		refToIdMap: new Map(),
		titleById: new Map(),
	}
	const { titleToIdMap } = recipeIndex
	try {
		const existingRecipes = await prisma.recipe.findMany({
			where: { householdId },
			select: { id: true, title: true },
		})
		for (const r of existingRecipes) {
			titleToIdMap.set(r.title.toLowerCase(), r.id)
			recipeIndex.titleById.set(r.id, r.title)
		}

		results.recipes = await importRecipes(
			recipes,
			recipeIndex,
			userId,
			householdId,
		)
	} catch {
		results.recipes.errored = recipes.length
	}

	// --- 2. Menus (after Recipes, so references can reconnect) ---
	// Menus are not Pro-gated in the product, so unlike the sections below
	// they import for every tier.
	const fullMenus = fullHouseholdData?.menus ?? null
	if (fullMenus?.length) {
		try {
			results.menus = await importMenus(fullMenus, recipeIndex, householdId)
		} catch {
			results.menus.errored = fullMenus.length
		}
	}

	// --- 3. Inventory ---
	if (fullData?.inventory) {
		try {
			const existingInventory = await prisma.inventoryItem.findMany({
				where: { householdId },
				select: { name: true },
			})
			const existingKeys = new Set(
				existingInventory.map((i) => i.name.toLowerCase()),
			)

			for (const item of fullData.inventory) {
				const key = item.name
				if (existingKeys.has(key)) {
					results.inventory.skipped++
					continue
				}
				try {
					await prisma.inventoryItem.create({
						data: {
							name: item.name,
							userId,
							householdId,
						},
					})
					existingKeys.add(key)
					results.inventory.created++
				} catch {
					// skip individual item errors
				}
			}
		} catch {
			// skip entire inventory section on error
		}
	}

	// --- 4. Household canonical ingredients and cutover ---
	// Restore rows and the reviewed boundary atomically. Existing target rows
	// and an existing target cutover win; importing recovery data never silently
	// rewrites a household that has already made its own choice.
	if (
		fullHouseholdData &&
		(fullHouseholdData.householdIngredients !== undefined ||
			fullHouseholdData.household?.staplesCutoverAt != null)
	) {
		await prisma.$transaction(async (tx) => {
			const existing = await tx.householdIngredient.findMany({
				where: { householdId },
				select: { canonicalKey: true },
			})
			const existingKeys = new Set(existing.map((item) => item.canonicalKey))
			for (const ingredient of fullHouseholdData.householdIngredients ?? []) {
				if (existingKeys.has(ingredient.canonicalKey)) {
					results.householdIngredients.skipped++
					continue
				}
				await tx.householdIngredient.create({
					data: { ...ingredient, householdId },
				})
				existingKeys.add(ingredient.canonicalKey)
				results.householdIngredients.created++
			}

			const cutoverAt = fullHouseholdData.household?.staplesCutoverAt
			if (cutoverAt) {
				const restored = await tx.household.updateMany({
					where: { id: householdId, staplesCutoverAt: null },
					data: { staplesCutoverAt: new Date(cutoverAt) },
				})
				results.staplesCutoverRestored = restored.count === 1
			}
		})
	}

	// --- 5. Meal Plans ---
	const mealIdByRef = new Map<string, string>()
	if (fullData?.mealPlans) {
		// Source Menu references on Meals reconnect by normalized household
		// title — a Menu's identity (#98).
		const menuIdByTitleKey = new Map<string, string>()
		if (
			fullData.mealPlans.some((plan) =>
				plan.meals?.some((meal) => meal.sourceMenuTitle),
			)
		) {
			try {
				const householdMenus = await prisma.menu.findMany({
					where: { householdId },
					select: { id: true, titleKey: true },
				})
				for (const menu of householdMenus) {
					menuIdByTitleKey.set(menu.titleKey, menu.id)
				}
			} catch {
				// Meals still import — their source Menu link stays unset.
			}
		}

		// Legacy-only plans need Recipe servings to recover multipliers
		// (override / Recipe.servings, the #104 rule).
		let servingsByRecipeId = new Map<string, number>()
		if (
			fullData.mealPlans.some(
				(plan) => !plan.meals?.length && plan.entries?.length,
			)
		) {
			try {
				const householdRecipes = await prisma.recipe.findMany({
					where: { householdId },
					select: { id: true, servings: true },
				})
				servingsByRecipeId = new Map(
					householdRecipes.map((recipe) => [recipe.id, recipe.servings]),
				)
			} catch {
				// Entries still restore — overrides fall back to 1× multipliers.
			}
		}

		for (const plan of fullData.mealPlans) {
			try {
				const weekStart = new Date(plan.weekStart)

				const mealPlan = await ensureMealPlan(prisma, {
					householdId,
					weekStart,
				})

				if (plan.meals?.length) {
					// A file that carries Meals restores only them — its `entries`,
					// when present (#104–#106 window exports), are the dual-write
					// mirrors of those same Meals.
					const mealStats = await importMeals(
						plan.meals,
						mealPlan.id,
						recipeIndex,
						menuIdByTitleKey,
						mealIdByRef,
					)
					results.meals.created += mealStats.created
					results.meals.skipped += mealStats.skipped
				} else if (plan.entries?.length) {
					const { meals, skippedEntries } = legacyEntriesToMeals(
						plan.entries,
						titleToIdMap,
						servingsByRecipeId,
					)
					results.mealPlans.skipped += skippedEntries
					const mealStats = await importMeals(
						meals,
						mealPlan.id,
						recipeIndex,
						menuIdByTitleKey,
						mealIdByRef,
					)
					results.meals.created += mealStats.created
					results.meals.skipped += mealStats.skipped
				}
			} catch {
				// skip this meal plan
			}
		}
	}

	// --- 5. Shopping Lists ---
	if (fullData?.shoppingLists?.length) {
		try {
			const shoppingList = await ensureShoppingList(prisma, {
				userId,
				householdId,
				name: fullData.shoppingLists[0]!.name,
			})
			const existingItems = await prisma.shoppingListItem.findMany({
				where: { listId: shoppingList.id },
				select: {
					id: true,
					name: true,
					quantity: true,
					unit: true,
					category: true,
					checked: true,
					source: true,
				},
			})
			const itemIdByKey = new Map(
				existingItems.map((item) => [
					getShoppingListItemImportKey(item),
					item.id,
				]),
			)
			const contributionSeeds: Array<{
				itemId: string
				contribution: NonNullable<
					(typeof fullData.shoppingLists)[number]['items'][number]['mealContributions']
				>[number]
			}> = []

			for (const list of fullData.shoppingLists) {
				let skipped = 0
				const newItems: Array<ShoppingListItemImport & { id: string }> = []
				for (const item of list.items) {
					const normalizedItem = {
						name: item.name,
						quantity: item.quantity || null,
						unit: item.unit || null,
						category: item.category || null,
						checked: item.checked ?? false,
						source: item.source || 'manual',
					}
					const key = getShoppingListItemImportKey(normalizedItem)
					let targetItemId = itemIdByKey.get(key)
					if (targetItemId) {
						skipped++
					} else {
						targetItemId = createId()
						itemIdByKey.set(key, targetItemId)
						newItems.push({ id: targetItemId, ...normalizedItem })
					}
					for (const contribution of item.mealContributions ?? []) {
						contributionSeeds.push({
							itemId: targetItemId,
							contribution,
						})
					}
				}

				if (newItems.length > 0) {
					await prisma.shoppingListItem.createMany({
						data: newItems.map((item) => ({
							...item,
							listId: shoppingList.id,
						})),
					})
				}
				results.shoppingLists.created += newItems.length
				results.shoppingLists.skipped += skipped
			}

			const existingContributions =
				await prisma.mealShoppingContribution.findMany({
					where: { item: { listId: shoppingList.id } },
					select: {
						itemId: true,
						mealId: true,
						canonicalName: true,
						name: true,
						quantity: true,
						unit: true,
					},
				})
			const contributionKey = (entry: {
				itemId: string
				mealId: string | null
				canonicalName: string
				name: string
				quantity: string | null
				unit: string | null
			}) =>
				entry.mealId
					? JSON.stringify(['meal', entry.mealId, entry.canonicalName])
					: JSON.stringify([
							'orphan',
							entry.itemId,
							entry.canonicalName,
							entry.name,
							entry.quantity,
							entry.unit,
						])
			const liveContributionKeys = new Set(
				existingContributions
					.filter((entry) => entry.mealId != null)
					.map(contributionKey),
			)
			// Orphan contributions have no unique source Meal key. Identical
			// records may represent several deleted Meals and each still counts
			// toward the displayed total, so reconcile them as a multiset.
			const availableOrphanCounts = new Map<string, number>()
			for (const entry of existingContributions) {
				if (entry.mealId != null) continue
				const key = contributionKey(entry)
				availableOrphanCounts.set(
					key,
					(availableOrphanCounts.get(key) ?? 0) + 1,
				)
			}
			const newContributions = []
			for (const seed of contributionSeeds) {
				const { contribution } = seed
				const mealId = contribution.orphaned
					? contribution.sourceMealRef == null
						? null
						: undefined
					: contribution.sourceMealRef != null
						? mealIdByRef.get(contribution.sourceMealRef)
						: undefined
				if (mealId === undefined) continue
				const candidate = {
					id: createId(),
					itemId: seed.itemId,
					mealId,
					...contribution.fingerprint,
				}
				const key = contributionKey(candidate)
				if (mealId != null) {
					if (liveContributionKeys.has(key)) continue
					liveContributionKeys.add(key)
				} else {
					const available = availableOrphanCounts.get(key) ?? 0
					if (available > 0) {
						availableOrphanCounts.set(key, available - 1)
						continue
					}
				}
				newContributions.push(candidate)
			}
			if (newContributions.length > 0) {
				await prisma.mealShoppingContribution.createMany({
					data: newContributions,
				})
			}
		} catch {
			// skip shopping-list data on error
		}
	}

	return { error: null, results }
}

// --- Component ---

function getPreview(jsonData: unknown): ImportPreview | null {
	const result = parseImportData(jsonData)
	if ('error' in result) return null

	const isFullExport = result.type === 'full'
	const fullData = isFullExport ? result.data : null

	return {
		recipes: result.data.recipes.length,
		menus: fullData?.menus?.length ?? 0,
		householdIngredients: fullData?.householdIngredients?.length ?? 0,
		inventory: fullData?.inventory?.length ?? 0,
		mealPlans:
			fullData?.mealPlans?.reduce(
				(sum, p) => sum + (p.entries?.length ?? 0),
				0,
			) ?? 0,
		meals:
			fullData?.mealPlans?.reduce(
				(sum, p) => sum + (p.meals?.length ?? 0),
				0,
			) ?? 0,
		shoppingLists: fullData?.shoppingLists?.length ?? 0,
		isFullExport,
	}
}

export default function ImportData() {
	const fetcher = useFetcher<typeof action>()
	const fileInputRef = useRef<HTMLInputElement>(null)
	const [preview, setPreview] = useState<ImportPreview | null>(null)
	const [fileError, setFileError] = useState<string | null>(null)
	const [rawJson, setRawJson] = useState<string | null>(null)

	const isSubmitting = fetcher.state === 'submitting'
	const [cleared, setCleared] = useState(false)
	const results = cleared ? null : (fetcher.data?.results ?? null)
	const serverError = cleared ? null : (fetcher.data?.error ?? null)

	// Handle fetcher completion — toast is an external side effect
	const lastFetcherData = useRef(fetcher.data)
	useEffect(() => {
		if (!fetcher.data || fetcher.data === lastFetcherData.current) return
		lastFetcherData.current = fetcher.data
		setCleared(false)
		if (fetcher.data.results) {
			const r = fetcher.data.results
			const total =
				r.recipes.created +
				r.menus.created +
				r.householdIngredients.created +
				(r.staplesCutoverRestored ? 1 : 0) +
				r.inventory.created +
				r.mealPlans.created +
				r.meals.created +
				r.shoppingLists.created
			if (total > 0) {
				toast.success(`Imported ${total} items`)
			} else {
				toast.info('Nothing new to import — all items already exist')
			}
		}
		if (fetcher.data.error) {
			toast.error(fetcher.data.error)
		}
	}, [fetcher.data])

	function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0]
		if (!file) return

		setFileError(null)
		setPreview(null)
		setRawJson(null)

		if (!file.name.endsWith('.json')) {
			setFileError('Please select a .json file')
			return
		}

		if (file.size > 50 * 1024 * 1024) {
			setFileError('File is too large (max 50 MB)')
			return
		}

		const reader = new FileReader()
		reader.onload = (event) => {
			const text = event.target?.result
			if (typeof text !== 'string') {
				setFileError('Could not read file')
				return
			}

			let parsed: unknown
			try {
				parsed = JSON.parse(text)
			} catch {
				setFileError('File is not valid JSON')
				return
			}

			const previewData = getPreview(parsed)
			if (!previewData) {
				setFileError(
					'Unrecognized format. Expected a Quartermaster export file.',
				)
				return
			}

			setRawJson(text)
			setPreview(previewData)
		}
		reader.onerror = () => setFileError('Could not read file')
		reader.readAsText(file)
	}

	function handleSubmit() {
		if (!rawJson) return
		const formData = new FormData()
		formData.set('importData', rawJson)
		void fetcher.submit(formData, { method: 'POST' })
	}

	function handleReset() {
		setPreview(null)
		setFileError(null)
		setRawJson(null)
		setCleared(true)
		if (fileInputRef.current) fileInputRef.current.value = ''
	}

	return (
		<div>
			<p className="text-muted-foreground mb-6">
				Import a previously exported Quartermaster file. Both full exports and
				recipe-only exports are supported. Duplicates are automatically skipped.
			</p>

			{/* Phase 3: Results */}
			{results ? (
				<div className="space-y-4">
					<div className="bg-muted/40 rounded-lg p-6">
						<h2 className="mb-4 text-lg font-semibold">Import Complete</h2>
						<div className="space-y-3">
							<ResultRow
								label="Recipes"
								created={results.recipes.created}
								skipped={results.recipes.skipped}
								errored={results.recipes.errored}
							/>
							{(results.menus.created > 0 ||
								results.menus.skipped > 0 ||
								results.menus.errored > 0) && (
								<ResultRow
									label="Menus"
									created={results.menus.created}
									skipped={results.menus.skipped}
									errored={results.menus.errored}
								/>
							)}
							{(results.inventory.created > 0 ||
								results.inventory.skipped > 0) && (
								<ResultRow
									label="Pantry items"
									created={results.inventory.created}
									skipped={results.inventory.skipped}
								/>
							)}
							{(results.householdIngredients.created > 0 ||
								results.householdIngredients.skipped > 0) && (
								<ResultRow
									label="Household ingredients"
									created={results.householdIngredients.created}
									skipped={results.householdIngredients.skipped}
								/>
							)}
							{(results.mealPlans.created > 0 ||
								results.mealPlans.skipped > 0) && (
								<ResultRow
									label="Meal plan entries"
									created={results.mealPlans.created}
									skipped={results.mealPlans.skipped}
								/>
							)}
							{(results.meals.created > 0 || results.meals.skipped > 0) && (
								<ResultRow
									label="Meals"
									created={results.meals.created}
									skipped={results.meals.skipped}
								/>
							)}
							{(results.shoppingLists.created > 0 ||
								results.shoppingLists.skipped > 0) && (
								<ResultRow
									label="Shopping list items"
									created={results.shoppingLists.created}
									skipped={results.shoppingLists.skipped}
								/>
							)}
						</div>
					</div>
					<div className="flex gap-3">
						<Button variant="outline" onClick={handleReset}>
							Import another file
						</Button>
						<Button asChild>
							<Link to="/recipes">View recipes</Link>
						</Button>
					</div>
				</div>
			) : (
				<>
					{/* Phase 1: Upload */}
					<div className="bg-muted/40 rounded-lg p-6">
						<label className="block">
							<span className="text-sm font-medium">Select export file</span>
							<input
								ref={fileInputRef}
								type="file"
								accept=".json"
								onChange={handleFileChange}
								className="file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 mt-2 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:px-4 file:py-2 file:text-sm file:font-medium"
							/>
						</label>

						{fileError && (
							<p className="text-destructive mt-3 text-sm">{fileError}</p>
						)}
						{serverError && !results && (
							<p className="text-destructive mt-3 text-sm">{serverError}</p>
						)}

						<p className="text-muted-foreground mt-4 text-xs">
							Images are not included in exports and will be skipped during
							import.
						</p>
					</div>

					{/* Phase 2: Preview */}
					{preview && (
						<div className="mt-4 space-y-4">
							<div className="bg-muted/40 rounded-lg p-6">
								<h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wider uppercase">
									{preview.isFullExport ? 'Full Export' : 'Recipe-Only Export'}
								</h2>
								<div className="space-y-1.5 text-sm">
									<PreviewRow label="Recipes" count={preview.recipes} />
									{preview.menus > 0 && (
										<PreviewRow label="Menus" count={preview.menus} />
									)}
									{preview.inventory > 0 && (
										<PreviewRow
											label="Pantry items"
											count={preview.inventory}
										/>
									)}
									{preview.householdIngredients > 0 && (
										<PreviewRow
											label="Household ingredients"
											count={preview.householdIngredients}
										/>
									)}
									{preview.mealPlans > 0 && (
										<PreviewRow
											label="Meal plan entries"
											count={preview.mealPlans}
										/>
									)}
									{preview.meals > 0 && (
										<PreviewRow label="Meals" count={preview.meals} />
									)}
									{preview.shoppingLists > 0 && (
										<PreviewRow
											label="Shopping lists"
											count={preview.shoppingLists}
										/>
									)}
								</div>
								<p className="text-muted-foreground mt-3 text-xs">
									Existing recipes and menus (matched by title) and Pantry items
									(matched by name) will be automatically skipped.
								</p>
							</div>

							<div className="flex justify-end gap-3">
								<Button variant="outline" onClick={handleReset}>
									Cancel
								</Button>
								<StatusButton
									type="button"
									status={isSubmitting ? 'pending' : 'idle'}
									disabled={isSubmitting}
									onClick={handleSubmit}
								>
									{isSubmitting ? 'Importing...' : 'Import'}
								</StatusButton>
							</div>
						</div>
					)}
				</>
			)}
		</div>
	)
}

function PreviewRow({ label, count }: { label: string; count: number }) {
	return (
		<div className="flex justify-between">
			<span>{label}</span>
			<span className="font-medium">{count}</span>
		</div>
	)
}

function ResultRow({
	label,
	created,
	skipped = 0,
	errored = 0,
}: {
	label: string
	created: number
	skipped?: number
	errored?: number
}) {
	return (
		<div className="flex items-center justify-between text-sm">
			<span>{label}</span>
			<span className="flex gap-3">
				{created > 0 && (
					<span className="text-green-600 dark:text-green-400">
						{created} imported
					</span>
				)}
				{skipped > 0 && (
					<span className="text-muted-foreground">{skipped} skipped</span>
				)}
				{errored > 0 && (
					<span className="text-destructive">{errored} failed</span>
				)}
				{created === 0 && skipped === 0 && errored === 0 && (
					<span className="text-muted-foreground">none</span>
				)}
			</span>
		</div>
	)
}
