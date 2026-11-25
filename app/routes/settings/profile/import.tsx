import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { createId } from '@paralleldrive/cuid2'
import { useEffect, useRef, useState } from 'react'
import { data, Link, useFetcher } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import {
	BodyTooLargeError,
	readBoundedText,
} from '#app/utils/bounded-body.server.ts'
import { getWeekStart, parseDate } from '#app/utils/date.ts'
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
import { captureServerEvent } from '#app/utils/posthog.server.ts'
import { ensureRecipeMetadataValues } from '#app/utils/recipe-metadata.server.ts'
import { MAX_RAW_TEXT_LENGTH } from '#app/utils/recipe-validation.ts'
import {
	RecipeMetadataDimensionSchema,
	RecipeMetadataNameSchema,
	recipeMetadataIdentity,
	recipeMetadataNameKey,
} from '#app/utils/recipe-metadata.ts'
import {
	NEXT_SHOP,
	ShoppingHorizonSchema,
} from '#app/utils/shopping-horizon.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { writeTransaction } from '#app/utils/write-transaction.server.ts'
import { type Route } from './+types/import.ts'
import { type SettingsPageHandle } from './_layout.tsx'

export const handle: SettingsPageHandle & SEOHandle = {
	pageTitle: 'Import data',
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Import data | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithHousehold(request)
	return {}
}

/**
 * The most of each list a restore takes, checked on the parsed JSON before the
 * schema runs, so a crafted file is refused before Zod looks at its elements.
 * The first group are the file's own lists. The rest are totals across the
 * whole file: nested lists multiply, and every Meal is its own write. 5,000
 * Meals took about 6 seconds locally, which is about a minute on the server.
 * These sit well above what a Household builds up (a busy one plans about 600
 * Meals a year), so only a crafted file reaches them.
 */
export const RESTORE_LIMITS = {
	recipes: 500,
	menus: 200,
	weeks: 200,
	shoppingLists: 100,
	staples: 1000,
	recipeClassifications: 300,
	oldPantryItems: 1000,
	recipeLines: 50_000,
	menuCards: 5_000,
	meals: 3_000,
	mealCards: 12_000,
	shoppingItems: 2_000,
	shoppingMealLinks: 10_000,
}

const RESTORE_LIMIT_LABELS: Record<keyof typeof RESTORE_LIMITS, string> = {
	recipes: 'Recipes',
	menus: 'Menus',
	weeks: 'weeks in the Plan',
	shoppingLists: 'lists of Shopping items',
	staples: 'Staples',
	recipeClassifications: 'Recipe classifications',
	oldPantryItems: 'old Pantry items',
	recipeLines: 'Recipe ingredients and steps',
	menuCards: 'cards on Menus',
	meals: 'Meals',
	mealCards: 'cards on Meals',
	shoppingItems: 'Shopping items',
	shoppingMealLinks: 'Meal links on Shopping items',
}

/**
 * An array schema that checks its length before its elements and stops at the
 * first element that fails. A plain `z.array` reports every bad element, so a
 * crafted file of small invalid objects would build an issue for each.
 */
export function boundedArray<T extends z.ZodType>(item: T, max: number) {
	return z
		.array(z.unknown())
		.max(max)
		.transform((elements, context) => {
			const parsed: Array<z.output<T>> = []
			for (const [index, element] of elements.entries()) {
				const result = item.safeParse(element, { reportInput: true })
				if (!result.success) {
					const issue = result.error.issues[0]!
					context.issues.push({
						...issue,
						path: [index, ...issue.path],
					} as z.core.$ZodRawIssue)
					return z.NEVER
				}
				parsed.push(result.data)
			}
			return parsed
		})
}

const ImportIngredientSchema = z.object({
	name: z.string().min(1).max(200),
	amount: z.string().max(50).nullable().optional(),
	unit: z.string().max(50).nullable().optional(),
	notes: z.string().max(500).nullable().optional(),
	// Exports from before ingredient headings omit the flag. Those lines
	// restore as ingredients: a lost heading is not guessed back from its name.
	isHeading: z.boolean().optional(),
	// The linked sub-Recipe's ref in this file. A ref with no Recipe in
	// the file restores a plain ingredient: it is never read as a database id.
	// Older exports omit it, and no link is guessed from a name.
	linkedRecipeRef: z.string().max(50).nullable().optional(),
})

const ImportRecipeMetadataValueSchema = z
	.object({
		dimension: RecipeMetadataDimensionSchema,
		name: RecipeMetadataNameSchema,
		nameKey: z.string().min(1).max(50),
		sortOrder: z.number().int().min(0).max(10_000).optional().default(1000),
	})
	.superRefine((value, context) => {
		if (value.nameKey !== recipeMetadataNameKey(value.name)) {
			context.addIssue({
				code: 'custom',
				path: ['nameKey'],
				message: 'Recipe classification key does not match its name',
			})
		}
	})

const ImportRecipeSchema = z
	.object({
		// Export-local reference key: how Menus reconnect to their Recipes.
		ref: z.string().max(50).optional(),
		title: z.string().min(1).max(100),
		description: z.string().max(500).nullable().optional(),
		servings: z.number().int().positive().nullable().optional(),
		prepTime: z.number().int().nonnegative().nullable().optional(),
		cookTime: z.number().int().nonnegative().nullable().optional(),
		activeTime: z.number().int().positive().nullable().optional(),
		totalTime: z.number().int().positive().nullable().optional(),
		yieldAmount: z.number().positive().nullable().optional(),
		yieldLabel: z.string().trim().min(1).max(100).nullable().optional(),
		isFavorite: z.boolean().optional(),
		// Older exports carry isAiGenerated. It is not declared here
		// and the schema is not strict, so the key is ignored rather than rejected.
		sourceUrl: z.string().max(2000).nullable().optional(),
		// Truncated, never rejected: rawText is ancillary provenance, and losing a
		// whole Recipe from a restore because its source text is long would be a
		// worse outcome than dropping the tail. Same call as the LLM extractor
		// makes for instruction content.
		rawText: z
			.string()
			.transform((text) => text.slice(0, MAX_RAW_TEXT_LENGTH))
			.nullable()
			.optional(),
		notes: z.string().max(5000).nullable().optional(),
		metadataValues: boundedArray(
			ImportRecipeMetadataValueSchema,
			60,
		).optional(),
		ingredients: boundedArray(ImportIngredientSchema, 200),
		instructions: boundedArray(
			z.union([
				z.string().min(1).max(5000),
				z.object({ content: z.string().min(1).max(5000) }),
			]),
			200,
		),
		tags: z.any().optional(),
		image: z.any().optional(),
	})
	.superRefine((recipe, context) => {
		if ((recipe.yieldAmount == null) !== (recipe.yieldLabel == null)) {
			context.addIssue({
				code: 'custom',
				path: recipe.yieldAmount == null ? ['yieldAmount'] : ['yieldLabel'],
				message: 'Recipe yield amount and label must be provided together',
			})
		}
	})

const ImportHouseholdIngredientSchema = z
	.object({
		displayName: z
			.string()
			.transform(householdIngredientDisplayName)
			.pipe(z.string().min(1).max(200)),
		canonicalKey: z.string().min(1).max(200),
		isStaple: z.boolean(),
		// Older exports can mark a Staple as Out. The value is accepted and
		// dropped, because a Staple has no state.
		isOut: z.boolean().optional(),
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
	})
	.transform(({ isOut: _isOut, ...ingredient }) => ingredient)

// The fixed-slot Plan shape: one entry per Recipe in a breakfast, lunch,
// dinner or snack slot. Exports from before Meals carry only this, so it stays
// parseable and restores as Meals. Current exports don't write it.
const ImportMealPlanEntrySchema = z.object({
	date: z.string(),
	mealType: z.string().max(50),
	servings: z.number().int().positive().nullable().optional(),
	cooked: z.boolean().optional(),
	recipe: z.string().min(1).max(100),
})

// Shared by Menu note cards and Meal snapshot note cards.
const ImportMenuShoppingLineSchema = z.object({
	name: z.string().min(1).max(200),
	quantity: z.string().max(50).nullable().optional(),
	unit: z.string().max(50).nullable().optional(),
})

// One schema for both snapshot card kinds, like Menu cards: `kind` decides
// which fields are read, defaulting to 'recipe' so exports from before note
// cards parse.
const ImportMealItemSchema = z.object({
	kind: z.enum(['recipe', 'note']).optional().default('recipe'),
	// Export-local reference key. When present it alone decides the Recipe
	// link: an unknown ref restores as a missing card, never a title guess.
	recipeRef: z.string().max(50).nullable().optional(),
	recipeTitle: z.string().min(1).max(100).nullable().optional(),
	// Migrated multipliers are exact override/servings ratios, so unlike Menu
	// cards they are not clamped to two decimals or 100. A restore keeps the
	// stored value.
	scaleMultiplier: z.number().positive().max(1000).nullable().optional(),
	cooked: z.boolean().optional(),
	note: z.string().max(500).nullable().optional(),
	text: z.string().max(1000).nullable().optional(),
	shoppingLines: boundedArray(ImportMenuShoppingLineSchema, 20).optional(),
})

// A frozen snapshot section: name (null = the unnamed section) plus
// Recipe and note cards interleaved in their shared order.
const ImportMealSectionSchema = z.object({
	name: z.string().min(1).max(100).nullable().optional(),
	items: boundedArray(ImportMealItemSchema, 100).optional(),
})

const ImportMealSchema = z
	.object({
		// Export-local key that Shopping items' Meal links point at.
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
		items: boundedArray(ImportMealItemSchema, 100).optional(),
		// Optional so exports from before Menu snapshots stay importable.
		sections: boundedArray(ImportMealSectionSchema, 20).optional(),
	})
	// A saved Meal holds either generic text or Recipe and snapshot cards,
	// never both.
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
	// Optional because current exports don't write it. When a file carries
	// only entries (exports from before Meals) they restore as Meals.
	entries: boundedArray(ImportMealPlanEntrySchema, 100).optional(),
	// Optional so exports from before Meals stay importable.
	meals: boundedArray(ImportMealSchema, 200).optional(),
})

const ImportShoppingListItemSchema = z.object({
	name: z.string().min(1).max(200),
	quantity: z.string().max(50).nullable().optional(),
	unit: z.string().max(50).nullable().optional(),
	category: z.string().max(50).nullable().optional(),
	checked: z.boolean().optional(),
	source: z.string().max(50).optional(),
	// Optional so exports from before Shopping horizons restore to Next shop.
	horizon: ShoppingHorizonSchema.optional().default(NEXT_SHOP),
	// Optional so exports from before Meal links stay importable.
	mealContributions: boundedArray(
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
		500,
	).optional(),
})

const ImportShoppingListSchema = z.object({
	name: z.string().min(1).max(200).optional().default('Shopping List'),
	items: boundedArray(ImportShoppingListItemSchema, 500),
})

// One schema for both card kinds. Recipe fields and note fields are each
// optional so the other kind parses, and `kind` decides which are read.
const ImportMenuItemSchema = z.object({
	kind: z.enum(['recipe', 'note']).optional().default('recipe'),
	recipeRef: z.string().max(50).nullable().optional(),
	recipeTitle: z.string().max(100).nullable().optional(),
	scaleMultiplier: z.number().positive().max(100).nullable().optional(),
	note: z.string().max(500).nullable().optional(),
	text: z.string().max(1000).nullable().optional(),
	shoppingLines: boundedArray(ImportMenuShoppingLineSchema, 20).optional(),
})

const ImportMenuSectionSchema = z.object({
	// null marks the headingless unnamed section
	name: z.string().min(1).max(100).nullable().optional(),
	items: boundedArray(ImportMenuItemSchema, 100).optional(),
})

const ImportMenuSchema = z.object({
	copiedFromMenuId: z.string().min(1).max(100).nullable().optional(),
	title: z.string().trim().min(1).max(100),
	description: z.string().max(500).nullable().optional(),
	defaultGuestCount: z.number().int().positive().max(999).nullable().optional(),
	sections: boundedArray(ImportMenuSectionSchema, 20).optional(),
})

// Older full exports may contain a `cookingLogs` array. The loose object
// lets those files import with the logs ignored.
const FullExportSchema = z.looseObject({
	format: z.literal('quartermaster-full-export-v1'),
	recipes: boundedArray(ImportRecipeSchema, RESTORE_LIMITS.recipes),
	// Older full exports carry a Staples cutover date and a Pantry list.
	// Nothing reads either one, so nothing validates them: a file must not be
	// rejected over a section the restore throws away.
	household: z.unknown().optional(),
	householdIngredients: boundedArray(
		ImportHouseholdIngredientSchema,
		RESTORE_LIMITS.staples,
	).optional(),
	recipeMetadataValues: boundedArray(
		ImportRecipeMetadataValueSchema,
		RESTORE_LIMITS.recipeClassifications,
	).optional(),
	inventory: z.array(z.unknown()).max(RESTORE_LIMITS.oldPantryItems).optional(),
	mealPlans: boundedArray(
		ImportMealPlanSchema,
		RESTORE_LIMITS.weeks,
	).optional(),
	shoppingLists: boundedArray(
		ImportShoppingListSchema,
		RESTORE_LIMITS.shoppingLists,
	).optional(),
	// Optional so exports from before Menus stay importable.
	menus: boundedArray(ImportMenuSchema, RESTORE_LIMITS.menus).optional(),
})

const RecipeOnlyExportSchema = z.looseObject({
	recipeCount: z.number(),
	recipes: boundedArray(ImportRecipeSchema, RESTORE_LIMITS.recipes),
})

type FullExport = z.infer<typeof FullExportSchema>
type RecipeOnlyExport = z.infer<typeof RecipeOnlyExportSchema>
type ImportRecipe = z.infer<typeof ImportRecipeSchema>

/**
 * The largest export file a restore takes. The form checks it before sending
 * and the action before parsing. The largest Household in production exports
 * about 3 MB. The server has 512 MB, and the worst-shaped 10 MB file that
 * passes every check before the schema (one object with 368,000 keys) took
 * about 140 MB of extra memory locally. A 0.5 MB file of 184,000 empty
 * Recipes, which Zod alone would turn into hundreds of thousands of issues,
 * is refused on its count for under 40 MB.
 */
export const RESTORE_MAX_FILE_BYTES = 10 * 1024 * 1024
const FILE_TOO_BIG = 'That file is too big. A restore takes files up to 10 MB.'

/** The list at `key` of a parsed JSON value, or an empty list. */
function listAt(value: unknown, key: string): unknown[] {
	const found =
		value !== null && typeof value === 'object'
			? (value as Record<string, unknown>)[key]
			: undefined
	return Array.isArray(found) ? found : []
}

/**
 * Counts the lists in a parsed file that hasn't been through the schema yet.
 * Anything that isn't a list counts as empty; the schema refuses it later.
 */
function countRestoreTotals(
	file: unknown,
	isFull: boolean,
): Record<keyof typeof RESTORE_LIMITS, number> {
	const sum = (list: unknown[], count: (item: unknown) => number) =>
		list.reduce<number>((total, item) => total + count(item), 0)
	const fullList = (key: string) => (isFull ? listAt(file, key) : [])
	const recipes = listAt(file, 'recipes')
	const menus = fullList('menus')
	const mealPlans = fullList('mealPlans')
	const shoppingLists = fullList('shoppingLists')
	return {
		recipes: recipes.length,
		menus: menus.length,
		weeks: mealPlans.length,
		shoppingLists: shoppingLists.length,
		staples: fullList('householdIngredients').length,
		recipeClassifications: fullList('recipeMetadataValues').length,
		oldPantryItems: fullList('inventory').length,
		recipeLines: sum(
			recipes,
			(recipe) =>
				listAt(recipe, 'ingredients').length +
				listAt(recipe, 'instructions').length,
		),
		menuCards: sum(menus, (menu) =>
			sum(
				listAt(menu, 'sections'),
				(section) => listAt(section, 'items').length,
			),
		),
		// A plan that carries Meals restores only them; its entries are their
		// mirrors.
		meals: sum(mealPlans, (plan) => {
			const meals = listAt(plan, 'meals').length
			return meals > 0 ? meals : listAt(plan, 'entries').length
		}),
		mealCards: sum(mealPlans, (plan) =>
			sum(
				listAt(plan, 'meals'),
				(meal) =>
					listAt(meal, 'items').length +
					sum(
						listAt(meal, 'sections'),
						(section) => listAt(section, 'items').length,
					),
			),
		),
		shoppingItems: sum(shoppingLists, (list) => listAt(list, 'items').length),
		shoppingMealLinks: sum(shoppingLists, (list) =>
			sum(
				listAt(list, 'items'),
				(item) => listAt(item, 'mealContributions').length,
			),
		),
	}
}

function overLimitError(file: unknown, isFull: boolean) {
	const totals = countRestoreTotals(file, isFull)
	for (const key of Object.keys(RESTORE_LIMITS) as Array<
		keyof typeof RESTORE_LIMITS
	>) {
		if (totals[key] > RESTORE_LIMITS[key]) {
			const count = (n: number) => n.toLocaleString('en-US')
			return `This file has ${count(totals[key])} ${RESTORE_LIMIT_LABELS[key]}. A restore takes up to ${count(RESTORE_LIMITS[key])}.`
		}
	}
	return null
}

/**
 * What a schema path points at, in words, for the paths that map easily, and
 * how many of the path's parts that covers.
 */
function describeFilePath(path: PropertyKey[]): [string, number] | null {
	const [section, first, list, second] = path
	const n = (index: unknown) => Number(index) + 1
	if (typeof first !== 'number') return null
	const nth = typeof second === 'number'
	if (section === 'recipes') {
		if (list === 'ingredients' && nth) {
			return [`Ingredient ${n(second)} of Recipe ${n(first)}`, 4]
		}
		if (list === 'instructions' && nth) {
			return [`Step ${n(second)} of Recipe ${n(first)}`, 4]
		}
		return [`Recipe ${n(first)}`, 2]
	}
	if (section === 'menus') return [`Menu ${n(first)}`, 2]
	if (section === 'shoppingLists') {
		return list === 'items' && nth
			? [`Item ${n(second)} on Shopping`, 4]
			: ['Part of Shopping', 2]
	}
	if (section === 'mealPlans') {
		return list === 'meals' && nth
			? [`Meal ${n(second)} in week ${n(first)}`, 4]
			: [`Week ${n(first)} in the Plan`, 2]
	}
	return null
}

const MISSING_FIELD_WORDS: Record<string, string> = {
	name: 'name',
	title: 'title',
	date: 'date',
	weekStart: 'week',
}

/**
 * A schema error in words, with where it is in the file inside the sentence
 * for anyone who edits export files by hand. The schema runs with
 * `reportInput`, so a field that is missing shows as an issue whose input is
 * undefined.
 */
function invalidDataError(error: z.ZodError) {
	const issue = error.issues[0]
	const notOurFormat = 'isn’t in the format Quartermaster exports'
	if (!issue) return `Part of this file ${notOurFormat}.`
	const at = issue.path.join('.')
	const where = at ? ` (at ${at})` : ''
	if (issue.code === 'custom') return `${issue.message}${where}.`
	const [subject, covered] = describeFilePath(issue.path) ?? []
	const field = issue.path.at(-1)
	// "has no title" only when the missing field sits on the subject itself.
	const missing =
		issue.code === 'invalid_type' &&
		'input' in issue &&
		issue.input === undefined &&
		issue.path.length === (covered ?? 0) + 1 &&
		typeof field === 'string'
			? MISSING_FIELD_WORDS[field]
			: undefined
	if (subject && missing) return `${subject} has no ${missing}${where}.`
	return `${subject ?? 'Part of this file'} ${notOurFormat}${where}.`
}

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
		const overLimit = overLimitError(parsed, true)
		if (overLimit) return { error: overLimit }
		const result = FullExportSchema.safeParse(parsed, { reportInput: true })
		if (!result.success) return { error: invalidDataError(result.error) }
		return { type: 'full', data: result.data }
	}

	if ('recipeCount' in obj) {
		const overLimit = overLimitError(parsed, false)
		if (overLimit) return { error: overLimit }
		const result = RecipeOnlyExportSchema.safeParse(parsed, {
			reportInput: true,
		})
		if (!result.success) return { error: invalidDataError(result.error) }
		return { type: 'recipe-only', data: result.data }
	}

	return { error: 'This isn’t a Quartermaster export file.' }
}

interface ImportPreview {
	recipes: number
	menus: number
	recipeMetadataValues: number
	householdIngredients: number
	mealPlans: number
	meals: number
	shoppingLists: number
	isFullExport: boolean
}

// Skipped means the Household already has it. Errored means it is in the
// file but couldn't be restored.
type RestoreCounts = { created: number; skipped: number; errored: number }

interface ImportResults {
	recipes: RestoreCounts
	menus: RestoreCounts
	recipeMetadataValues: { created: number; skipped: number }
	householdIngredients: { created: number; skipped: number }
	mealPlans: RestoreCounts
	meals: RestoreCounts
	shoppingLists: { created: number; skipped: number }
}

type ShoppingListItemImport = {
	name: string
	quantity: string | null
	unit: string | null
	category: string | null
	checked: boolean
	source: string
	horizon: string
}

function getShoppingListItemImportKey(item: ShoppingListItemImport) {
	return JSON.stringify([
		item.name.trim().toLocaleLowerCase(),
		item.quantity?.trim() || null,
		item.unit?.trim().toLocaleLowerCase() || null,
		item.category?.trim().toLocaleLowerCase() || null,
		item.checked,
		item.source.trim().toLocaleLowerCase(),
		item.horizon,
	])
}

/**
 * One thing in the file that a restore couldn't bring back. It is counted in
 * the result the user sees and logged with where it sits in the file. The log
 * never carries the user's own text, and neither does a Prisma error message,
 * which can quote the values it was given.
 */
interface RestoreFailure {
	/** Where it sits in the file, such as `mealPlans[2].meals[5]`. */
	at: string
	reason:
		| 'invalid-date'
		| 'invalid-week'
		// A real day, but not in the week of the plan it sits in.
		| 'outside-week'
		| 'nothing-to-restore'
		| 'recipe-not-in-file'
		| 'write-refused'
		// A Shopping item's link to a Meal deleted while the restore ran.
		| 'meal-gone'
	/** How many items it stands for, when a whole week fails at once. */
	count?: number
	/** The Prisma error code, for a write the database refused. */
	code?: string
}

type RecordFailure = (failure: RestoreFailure) => void

/**
 * The write errors a restore counts as one failed item: the database refused
 * the row over a constraint. Mostly that is a row it points at being deleted
 * while the restore ran (P2003, P2025), or the same unique row saved at the
 * same moment (P2002). The libSQL adapter reports every SQLite constraint
 * failure as P2003, a trigger's abort included. Anything else is unexpected,
 * and the restore stops with it. Running the restore again skips what it
 * already saved and picks up the rest.
 */
function refusedWriteCode(error: unknown) {
	const code = (error as { code?: unknown } | null)?.code
	return code === 'P2002' || code === 'P2003' || code === 'P2025' ? code : null
}

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
	recordFailure: RecordFailure,
) {
	const stats = { created: 0, skipped: 0, errored: 0 }
	// Sub-Recipe links of the Recipes this import creates. A skipped duplicate
	// keeps the household's own lines untouched.
	const pendingLinks: Array<{
		recipeId: string
		ingredientId: string
		ref: string
	}> = []

	try {
		for (const [index, recipe] of recipes.entries()) {
			const lowerTitle = recipe.title.toLowerCase()
			const existingId = titleToIdMap.get(lowerTitle)
			if (existingId != null) {
				// A skipped duplicate still resolves its reference key, so Menus that
				// point at it reconnect to the existing household Recipe.
				if (recipe.ref) refToIdMap.set(recipe.ref, existingId)
				stats.skipped++
				continue
			}
			try {
				// Older exports may carry only Prep/Cook. They become a total only
				// when both parts are present, non-negative, and add up to more than
				// zero. An old file's servings is accepted here and never becomes typed
				// yield.
				const legacyTotal =
					recipe.prepTime != null &&
					recipe.cookTime != null &&
					recipe.prepTime >= 0 &&
					recipe.cookTime >= 0 &&
					recipe.prepTime + recipe.cookTime > 0
						? recipe.prepTime + recipe.cookTime
						: undefined
				const instructions = recipe.instructions.map((inst, order) => ({
					content: typeof inst === 'string' ? inst : inst.content,
					order,
				}))
				const ingredientIds = recipe.ingredients.map(() => createId())

				const created = await writeTransaction(prisma, async (tx) => {
					const metadataValueIds = await ensureRecipeMetadataValues(
						tx,
						householdId,
						recipe.metadataValues ?? [],
					)
					return tx.recipe.create({
						data: {
							title: recipe.title,
							description: recipe.description || null,
							activeTime: recipe.activeTime ?? undefined,
							totalTime: recipe.totalTime ?? legacyTotal,
							yieldAmount: recipe.yieldAmount ?? undefined,
							yieldLabel: recipe.yieldLabel ?? undefined,
							isFavorite: recipe.isFavorite ?? false,
							sourceUrl: recipe.sourceUrl || null,
							rawText: recipe.rawText ?? null,
							notes: recipe.notes || null,
							userId,
							householdId,
							metadataAssignments: {
								create: metadataValueIds.map((valueId) => ({ valueId })),
							},
							ingredients: {
								create: recipe.ingredients.map((ing, order) => ({
									id: ingredientIds[order],
									name: ing.name,
									amount: ing.amount || null,
									unit: ing.unit || null,
									notes: ing.notes || null,
									isHeading: ing.isHeading ?? false,
									order,
								})),
							},
							instructions: { create: instructions },
						},
						select: { id: true },
					})
				})
				titleToIdMap.set(lowerTitle, created.id)
				titleById.set(created.id, recipe.title)
				if (recipe.ref) refToIdMap.set(recipe.ref, created.id)
				// The editor never links a heading, so a file cannot either.
				recipe.ingredients.forEach((ing, order) => {
					if (ing.linkedRecipeRef && !ing.isHeading)
						pendingLinks.push({
							recipeId: created.id,
							ingredientId: ingredientIds[order]!,
							ref: ing.linkedRecipeRef,
						})
				})
				stats.created++
			} catch (error) {
				const code = refusedWriteCode(error)
				if (!code) throw error
				recordFailure({
					at: `recipes[${index}]`,
					reason: 'write-refused',
					code,
				})
				stats.errored++
			}
		}
	} finally {
		// Also after an unexpected error: a rerun skips the Recipes saved so far
		// as duplicates, so this is their only chance to get their links.
		await restorePendingLinks()
	}

	return stats

	async function restorePendingLinks() {
		// Links resolve only once every Recipe in the file has a household row, so
		// a Recipe can link to one later in the file. A ref resolves through this
		// file's Recipes alone; one that names no Recipe here stays plain. So does
		// one that resolves back to its own Recipe, which the picker never offers.
		for (const link of pendingLinks) {
			const linkedRecipeId = refToIdMap.get(link.ref)
			if (!linkedRecipeId || linkedRecipeId === link.recipeId) continue
			try {
				await prisma.ingredient.update({
					where: { id: link.ingredientId },
					data: { linkedRecipeId },
				})
			} catch (error) {
				// The link is dropped either way, so the Recipes already restored
				// still count as created. Only the expected race is silent: P2025 when
				// the linking Recipe was deleted mid-import, P2003 when the linked
				// one was. Anything else is logged.
				const code = (error as { code?: unknown } | null)?.code
				if (code !== 'P2025' && code !== 'P2003')
					console.error('Unable to restore a sub-Recipe link', error)
			}
		}
	}
}

type ImportMenu = z.infer<typeof ImportMenuSchema>
type ImportMenuItem = z.infer<typeof ImportMenuItemSchema>

/**
 * Restores Menus after the Recipe pass. References reconnect by export-local
 * reference key, falling back to normalized Recipe title only when a key is
 * absent (older or hand-edited data). On a normalized Menu-title collision
 * the existing target Menu wins and the imported Menu is skipped wholesale.
 * Shared copies retain their own source identity and disambiguate titles;
 * an already-restored shared copy wins without refreshing local edits.
 */
async function importMenus(
	menus: ImportMenu[],
	recipeIndex: RecipeIndex,
	householdId: string,
	recordFailure: RecordFailure,
) {
	const stats = { created: 0, skipped: 0, errored: 0 }
	const sharedMenuIdsByTitleKey = new Map<string, string | null>()

	const existingMenus = await prisma.menu.findMany({
		where: { householdId },
		select: { id: true, titleKey: true, copiedFromMenuId: true },
	})
	const takenTitleKeys = new Set(existingMenus.map((menu) => menu.titleKey))

	const savedSources = new Map(
		existingMenus.flatMap((menu) =>
			menu.copiedFromMenuId ? [[menu.copiedFromMenuId, menu.id] as const] : [],
		),
	)
	for (const [index, menu] of menus.entries()) {
		if (menu.copiedFromMenuId) {
			const savedId = savedSources.get(menu.copiedFromMenuId)
			// Meals name their source Menu as it appeared in the export. Keep
			// that link even when this copy is renamed; a failed restore must
			// not fall back to a different Menu with the same title.
			sharedMenuIdsByTitleKey.set(menuTitleKey(menu.title), savedId ?? null)
			if (savedId) {
				stats.skipped++
				continue
			}
		}
		let title = menu.title
		let titleKey = menuTitleKey(title)
		if (takenTitleKeys.has(titleKey) && !menu.copiedFromMenuId) {
			stats.skipped++
			continue
		}
		// A shared copy's recovery identity is independent of its title.
		for (let n = 2; takenTitleKeys.has(titleKey); n++) {
			const suffix = ` (${n})`
			title = `${menu.title.slice(0, 100 - suffix.length)}${suffix}`
			titleKey = menuTitleKey(title)
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
			// One nested create per Menu, so it restores whole or not at all.
			const created = await prisma.menu.create({
				data: {
					title,
					titleKey,
					description: menu.description || null,
					defaultGuestCount: menu.defaultGuestCount ?? null,
					copiedFromMenuId: menu.copiedFromMenuId ?? null,
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
			if (menu.copiedFromMenuId) {
				savedSources.set(menu.copiedFromMenuId, created.id)
				sharedMenuIdsByTitleKey.set(menuTitleKey(menu.title), created.id)
			}
			stats.created++
		} catch (error) {
			const code = refusedWriteCode(error)
			if (!code) throw error
			recordFailure({ at: `menus[${index}]`, reason: 'write-refused', code })
			stats.errored++
		}
	}

	return { stats, sharedMenuIdsByTitleKey }
}

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
async function importMealPlans(
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

type ImportShoppingList = z.infer<typeof ImportShoppingListSchema>

/**
 * Restores Shopping items into the household's one list, skipping rows it
 * already has, then reconnects their Meal contributions. The schema has
 * already checked every item, so a write that fails here is unexpected and
 * stops the restore.
 */
async function importShopping(
	shoppingLists: ImportShoppingList[],
	mealIdByRef: Map<string, string>,
	userId: string,
	householdId: string,
	recordFailure: RecordFailure,
) {
	const stats = { created: 0, skipped: 0 }
	const shoppingList = await ensureShoppingList(prisma, {
		userId,
		householdId,
		name: shoppingLists[0]!.name,
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
			horizon: true,
		},
	})
	const itemIdByKey = new Map(
		existingItems.map((item) => [getShoppingListItemImportKey(item), item.id]),
	)
	const contributionSeeds: Array<{
		itemId: string
		contribution: NonNullable<
			(typeof shoppingLists)[number]['items'][number]['mealContributions']
		>[number]
	}> = []

	for (const list of shoppingLists) {
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
				horizon: item.horizon,
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
		stats.created += newItems.length
		stats.skipped += skipped
	}

	const existingContributions = await prisma.mealShoppingContribution.findMany({
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
		availableOrphanCounts.set(key, (availableOrphanCounts.get(key) ?? 0) + 1)
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
		try {
			await prisma.mealShoppingContribution.createMany({
				data: newContributions,
			})
		} catch (error) {
			const code = refusedWriteCode(error)
			if (!code) throw error
			// createMany is all or nothing: Prisma splits a large one into several
			// INSERTs inside one transaction (10,000 rows with a bad last one keep
			// none), so the retry can't write a link twice.
			// A Meal restored above was deleted before its links were written, or
			// someone saved the same link meanwhile. Drop the links to Meals that
			// are gone and the ones already there, and write the rest once more.
			const mealIds = [
				...new Set(
					newContributions.flatMap((c) => (c.mealId ? [c.mealId] : [])),
				),
			]
			const liveMealIds = new Set(
				(
					await prisma.meal.findMany({
						where: { id: { in: mealIds } },
						select: { id: true },
					})
				).map((meal) => meal.id),
			)
			const savedKeys = new Set(
				(
					await prisma.mealShoppingContribution.findMany({
						where: { item: { listId: shoppingList.id }, mealId: { not: null } },
						select: { itemId: true, mealId: true, canonicalName: true },
					})
				).map((entry) =>
					contributionKey({ ...entry, name: '', quantity: null, unit: null }),
				),
			)
			const toMissingMeals = newContributions.filter(
				(c) => c.mealId != null && !liveMealIds.has(c.mealId),
			)
			const retry = newContributions.filter(
				(c) =>
					c.mealId == null ||
					(liveMealIds.has(c.mealId) && !savedKeys.has(contributionKey(c))),
			)
			if (toMissingMeals.length > 0) {
				recordFailure({
					at: 'shoppingLists',
					reason: 'meal-gone',
					count: toMissingMeals.length,
					code,
				})
			}
			if (retry.length > 0) {
				await prisma.mealShoppingContribution.createMany({ data: retry })
			}
		}
	}

	return stats
}

// Room for the multipart boundary and part headers around the file. The form
// sends the file itself as the part, so its bytes arrive unchanged.
const RESTORE_MAX_BODY_BYTES = RESTORE_MAX_FILE_BYTES + 16 * 1024

// A tab still running the page from before the form sent multipart posts the
// old encoding.
const OLD_PAGE = 'This page is out of date. Reload the page and try again.'
const NO_FILE = 'No import data provided'

/**
 * Reads the export file from the form, refusing one over the cap before
 * anything parses it. Nothing but multipart is accepted, since urlencoding
 * can triple the size.
 */
async function readRestoreFile(
	request: Request,
): Promise<{ text: string } | { error: string; status: number }> {
	const contentType = request.headers.get('Content-Type') ?? ''
	if (!contentType.startsWith('multipart/form-data')) {
		return { error: OLD_PAGE, status: 400 }
	}
	if (Number(request.headers.get('Content-Length')) > RESTORE_MAX_BODY_BYTES) {
		return { error: FILE_TOO_BIG, status: 413 }
	}
	let body: string
	try {
		// A Content-Length is only a claim, so the bytes are counted as they
		// arrive too.
		body = await readBoundedText(new Response(request.body), {
			maxBytes: RESTORE_MAX_BODY_BYTES,
			signal: request.signal,
			encoded: false,
		})
	} catch (error) {
		if (error instanceof BodyTooLargeError) {
			return { error: FILE_TOO_BIG, status: 413 }
		}
		throw error
	}
	let formData: FormData
	try {
		formData = await new Response(body, {
			headers: { 'Content-Type': contentType },
		}).formData()
	} catch {
		return { error: NO_FILE, status: 400 }
	}
	const file = formData.get('importData')
	if (file == null) return { error: NO_FILE, status: 400 }
	const text = typeof file === 'string' ? file : await file.text()
	if (Buffer.byteLength(text) > RESTORE_MAX_FILE_BYTES) {
		return { error: FILE_TOO_BIG, status: 413 }
	}
	return { text }
}

// Bounds on the shape of the JSON text, checked before JSON.parse builds it.
// The deepest a real export nests is about 11 levels. The other two allow
// twice and four times every object a file within RESTORE_LIMITS holds,
// which leaves room for the lists without a total of their own. The largest
// Household in production is far below both.
const RESTORE_LIMITS_TOTAL =
	RESTORE_LIMITS.recipeLines +
	RESTORE_LIMITS.menuCards +
	RESTORE_LIMITS.meals +
	RESTORE_LIMITS.mealCards +
	RESTORE_LIMITS.shoppingItems +
	2 * RESTORE_LIMITS.shoppingMealLinks
export const RESTORE_JSON_LIMITS = {
	depth: 16,
	containers: 2 * RESTORE_LIMITS_TOTAL,
	separators: 4 * RESTORE_LIMITS_TOTAL,
}
const TOO_COMPLEX =
	'This file holds far more than a Quartermaster export can, so it can’t be restored.'

/**
 * Scans the JSON text for its nesting depth and its count of objects, arrays
 * and commas, without parsing it. JSON.parse builds every value before the
 * schema sees any of them, so a file of nested empty brackets near the size
 * cap would build millions of objects.
 */
function jsonShapeError(text: string) {
	let depth = 0
	let containers = 0
	let separators = 0
	let inString = false
	for (let i = 0; i < text.length; i++) {
		const char = text.charCodeAt(i)
		if (inString) {
			if (char === 0x5c)
				i++ // a backslash escapes the next character
			else if (char === 0x22) inString = false
		} else if (char === 0x22) {
			inString = true
		} else if (char === 0x7b || char === 0x5b) {
			depth++
			containers++
			if (
				depth > RESTORE_JSON_LIMITS.depth ||
				containers > RESTORE_JSON_LIMITS.containers
			) {
				return TOO_COMPLEX
			}
		} else if (char === 0x7d || char === 0x5d) {
			depth--
		} else if (char === 0x2c) {
			separators++
			if (separators > RESTORE_JSON_LIMITS.separators) return TOO_COMPLEX
		}
	}
	return null
}

// One restore at a time in this process: each holds a parsed file in memory
// and makes thousands of writes. A request that arrives while one runs is
// turned away before its body is read, so parallel uploads don't each hold
// copies of a file. The lock itself is taken once the body is in, so a slow
// upload can't hold it.
let restoreRunning = false
const RESTORE_BUSY = 'Another restore is running. Try again in a minute.'
const RESTORE_STOPPED =
	'The restore stopped partway. What it restored is kept. Import the same file again to finish.'

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	if (restoreRunning) {
		return data({ error: RESTORE_BUSY, results: null }, { status: 409 })
	}
	const file = await readRestoreFile(request)
	if ('error' in file) {
		return data({ error: file.error, results: null }, { status: file.status })
	}
	if (restoreRunning) {
		return data({ error: RESTORE_BUSY, results: null }, { status: 409 })
	}
	restoreRunning = true
	try {
		const shapeError = jsonShapeError(file.text)
		if (shapeError) {
			return data({ error: shapeError, results: null }, { status: 400 })
		}

		let parsed: unknown
		try {
			parsed = JSON.parse(file.text)
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

		try {
			return await restore(importResult, { userId, householdId })
		} catch (error) {
			// The route's error boundary would replace the page, so the error is
			// reported here and the page stays with a reply the user can act on.
			if (!request.signal.aborted) {
				const report = { operation: 'restore', ...describeError(error) }
				console.error('Restore stopped by an unexpected error', report)
				captureServerEvent(userId, 'server_error', report)
			}
			return data({ error: RESTORE_STOPPED, results: null }, { status: 500 })
		}
	} finally {
		restoreRunning = false
	}
}

/**
 * An unexpected error without its message: a Prisma message can quote the
 * values it was given, which are the user's own text. The name, the Prisma
 * code and the stack frames are enough to find where it came from.
 */
function describeError(error: unknown) {
	const code = (error as { code?: unknown } | null)?.code
	return {
		errorName: error instanceof Error ? error.name : typeof error,
		code: typeof code === 'string' ? code : undefined,
		stack:
			error instanceof Error
				? error.stack
						?.split('\n')
						.filter((line) => line.trimStart().startsWith('at '))
						.join('\n')
				: undefined,
	}
}

/**
 * Writes a parsed export into the Household, section by section. Each item is
 * its own write, so an unexpected error leaves what came before it saved.
 */
async function restore(
	importResult: Exclude<ReturnType<typeof parseImportData>, { error: string }>,
	{ userId, householdId }: { userId: string; householdId: string },
) {
	const recipes = importResult.data.recipes
	// Everything in a full export restores on every tier.
	const fullData = importResult.type === 'full' ? importResult.data : null

	const results: ImportResults = {
		recipes: { created: 0, skipped: 0, errored: 0 },
		menus: { created: 0, skipped: 0, errored: 0 },
		recipeMetadataValues: { created: 0, skipped: 0 },
		householdIngredients: { created: 0, skipped: 0 },
		mealPlans: { created: 0, skipped: 0, errored: 0 },
		meals: { created: 0, skipped: 0, errored: 0 },
		shoppingLists: { created: 0, skipped: 0 },
	}

	const failures: RestoreFailure[] = []
	const recordFailure: RecordFailure = (failure) => {
		failures.push(failure)
		console.error(
			`Restore: ${failure.at} couldn't be restored (${failure.reason})`,
			{ householdId, ...failure },
		)
	}

	// Recipe classifications go in before Recipes, so values no Recipe uses
	// still come back. Where a value already exists, its display name wins.
	if (fullData?.recipeMetadataValues?.length) {
		await writeTransaction(prisma, async (tx) => {
			const existing = await tx.recipeMetadataValue.findMany({
				where: { householdId },
				select: { dimension: true, nameKey: true },
			})
			const existingIdentities = new Set(
				existing.map((value) =>
					recipeMetadataIdentity(
						RecipeMetadataDimensionSchema.parse(value.dimension),
						value.nameKey,
					),
				),
			)
			for (const value of fullData.recipeMetadataValues ?? []) {
				const identity = recipeMetadataIdentity(value.dimension, value.nameKey)
				if (existingIdentities.has(identity)) {
					results.recipeMetadataValues.skipped++
					continue
				}
				await ensureRecipeMetadataValues(tx, householdId, [value])
				existingIdentities.add(identity)
				results.recipeMetadataValues.created++
			}
		})
	}

	const recipeIndex: RecipeIndex = {
		titleToIdMap: new Map(),
		refToIdMap: new Map(),
		titleById: new Map(),
	}
	const existingRecipes = await prisma.recipe.findMany({
		where: { householdId },
		select: { id: true, title: true },
	})
	for (const r of existingRecipes) {
		recipeIndex.titleToIdMap.set(r.title.toLowerCase(), r.id)
		recipeIndex.titleById.set(r.id, r.title)
	}
	results.recipes = await importRecipes(
		recipes,
		recipeIndex,
		userId,
		householdId,
		recordFailure,
	)

	// Menus after Recipes, so their references can reconnect.
	let sharedMenuIdsByTitleKey = new Map<string, string | null>()
	if (fullData?.menus?.length) {
		const imported = await importMenus(
			fullData.menus,
			recipeIndex,
			householdId,
			recordFailure,
		)
		results.menus = imported.stats
		sharedMenuIdsByTitleKey = imported.sharedMenuIdsByTitleKey
	}

	// Staples: rows the Household already has win, so a restore never rewrites
	// a choice the Household has already made.
	if (fullData?.householdIngredients !== undefined) {
		await writeTransaction(prisma, async (tx) => {
			const existing = await tx.householdIngredient.findMany({
				where: { householdId },
				select: { canonicalKey: true },
			})
			const existingKeys = new Set(existing.map((item) => item.canonicalKey))
			for (const ingredient of fullData.householdIngredients ?? []) {
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
		})
	}

	let mealIdByRef = new Map<string, string>()
	if (fullData?.mealPlans) {
		const imported = await importMealPlans(
			fullData.mealPlans,
			fullData.recipes,
			recipeIndex,
			sharedMenuIdsByTitleKey,
			householdId,
			recordFailure,
		)
		results.mealPlans = imported.stats.mealPlans
		results.meals = imported.stats.meals
		mealIdByRef = imported.mealIdByRef
	}

	if (fullData?.shoppingLists?.length) {
		results.shoppingLists = await importShopping(
			fullData.shoppingLists,
			mealIdByRef,
			userId,
			householdId,
			recordFailure,
		)
	}

	if (failures.length > 0) {
		// Its own event: a user's file with bad parts isn't a server error.
		captureServerEvent(userId, 'restore_failed_items', {
			householdId,
			failureCount: failures.length,
			// Enough to find the pattern without sending thousands of rows.
			failures: failures
				.slice(0, 20)
				.map(({ at, reason, count, code }) => ({ at, reason, count, code })),
		})
	}

	return { error: null, results }
}

function getPreview(jsonData: unknown): ImportPreview | { error: string } {
	const result = parseImportData(jsonData)
	if ('error' in result) return result

	const isFullExport = result.type === 'full'
	const fullData = isFullExport ? result.data : null

	return {
		recipes: result.data.recipes.length,
		menus: fullData?.menus?.length ?? 0,
		recipeMetadataValues: fullData?.recipeMetadataValues?.length ?? 0,
		householdIngredients: fullData?.householdIngredients?.length ?? 0,
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
	const [exportFile, setExportFile] = useState<File | null>(null)

	const isSubmitting = fetcher.state === 'submitting'
	const [cleared, setCleared] = useState(false)
	const results = cleared ? null : (fetcher.data?.results ?? null)
	const serverError = cleared ? null : (fetcher.data?.error ?? null)

	// Toast once per result. The toast is a side effect, so it runs here.
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
				r.recipeMetadataValues.created +
				r.householdIngredients.created +
				r.mealPlans.created +
				r.meals.created +
				r.shoppingLists.created
			const notRestored = notRestoredMessage(r)
			if (notRestored) {
				toast.warning(
					total > 0 ? `Imported ${total} items. ${notRestored}` : notRestored,
				)
			} else if (total > 0) {
				toast.success(`Imported ${total} items`)
			} else {
				toast.info(
					'Nothing new to import. Everything in the file is already here.',
				)
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
		setExportFile(null)

		if (!file.name.endsWith('.json')) {
			setFileError('Choose a .json file')
			return
		}

		if (file.size > RESTORE_MAX_FILE_BYTES) {
			setFileError(FILE_TOO_BIG)
			return
		}

		const reader = new FileReader()
		reader.onload = (event) => {
			const text = event.target?.result
			if (typeof text !== 'string') {
				setFileError('Couldn’t read that file')
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
			if ('error' in previewData) {
				setFileError(previewData.error)
				return
			}

			setExportFile(file)
			setPreview(previewData)
		}
		reader.onerror = () => setFileError('Couldn’t read that file')
		reader.readAsText(file)
	}

	function handleSubmit() {
		if (!exportFile) return
		const formData = new FormData()
		// The file itself, as a multipart part: its bytes go as they are. Sent as
		// text, every line break would grow to two bytes on the way.
		formData.set('importData', exportFile)
		void fetcher.submit(formData, {
			method: 'POST',
			encType: 'multipart/form-data',
		})
	}

	function handleReset() {
		setPreview(null)
		setFileError(null)
		setExportFile(null)
		setCleared(true)
		if (fileInputRef.current) fileInputRef.current.value = ''
	}

	return (
		<div>
			<p className="text-muted-foreground mb-6">
				Import a file you exported from Quartermaster, a full export or Recipes
				only. Anything already here is skipped.
			</p>

			{results ? (
				<div className="space-y-4">
					<div className="bg-muted/40 rounded-lg p-6">
						<h2 className="mb-4 text-lg font-semibold">Import complete</h2>
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
							{(results.recipeMetadataValues.created > 0 ||
								results.recipeMetadataValues.skipped > 0) && (
								<ResultRow
									label="Recipe classifications"
									created={results.recipeMetadataValues.created}
									skipped={results.recipeMetadataValues.skipped}
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
								results.mealPlans.skipped > 0 ||
								results.mealPlans.errored > 0) && (
								<ResultRow
									label="Plan entries"
									created={results.mealPlans.created}
									skipped={results.mealPlans.skipped}
									errored={results.mealPlans.errored}
								/>
							)}
							{(results.meals.created > 0 ||
								results.meals.skipped > 0 ||
								results.meals.errored > 0) && (
								<ResultRow
									label="Meals"
									created={results.meals.created}
									skipped={results.meals.skipped}
									errored={results.meals.errored}
								/>
							)}
							{(results.shoppingLists.created > 0 ||
								results.shoppingLists.skipped > 0) && (
								<ResultRow
									label="Shopping items"
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
							<Link to="/recipes">View Recipes</Link>
						</Button>
					</div>
				</div>
			) : (
				<>
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
							<p className="text-foreground-destructive mt-3 text-sm">
								{fileError}
							</p>
						)}
						{serverError && !results && (
							<p className="text-foreground-destructive mt-3 text-sm">
								{serverError}
							</p>
						)}

						<p className="text-muted-foreground mt-4 text-xs">
							Exports don&apos;t include images, so none are imported.
						</p>
					</div>

					{preview && (
						<div className="mt-4 space-y-4">
							<div className="bg-muted/40 rounded-lg p-6">
								<h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wider uppercase">
									{preview.isFullExport ? 'Full export' : 'Recipes-only export'}
								</h2>
								<div className="space-y-1.5 text-sm">
									<PreviewRow label="Recipes" count={preview.recipes} />
									{preview.menus > 0 && (
										<PreviewRow label="Menus" count={preview.menus} />
									)}
									{preview.recipeMetadataValues > 0 && (
										<PreviewRow
											label="Recipe classifications"
											count={preview.recipeMetadataValues}
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
											label="Plan entries"
											count={preview.mealPlans}
										/>
									)}
									{preview.meals > 0 && (
										<PreviewRow label="Meals" count={preview.meals} />
									)}
									{preview.shoppingLists > 0 && (
										<PreviewRow
											label="Shopping"
											count={preview.shoppingLists}
										/>
									)}
								</div>
								<p className="text-muted-foreground mt-3 text-xs">
									Recipes and Menus with a title you already have, and Staples
									with a name you already have, are skipped.
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
									{isSubmitting ? 'Importing…' : 'Import'}
								</StatusButton>
							</div>
						</div>
					)}
				</>
			)}
		</div>
	)
}

/** "2 Recipes and 1 Meal couldn’t be restored.", or null when all landed. */
function notRestoredMessage(results: ImportResults) {
	const parts = (
		[
			[results.recipes.errored, 'Recipe', 'Recipes'],
			[results.menus.errored, 'Menu', 'Menus'],
			[results.mealPlans.errored, 'Plan entry', 'Plan entries'],
			[results.meals.errored, 'Meal', 'Meals'],
		] as const
	)
		.filter(([count]) => count > 0)
		.map(([count, one, many]) => `${count} ${count === 1 ? one : many}`)
	if (parts.length === 0) return null
	const list =
		parts.length === 1
			? parts[0]
			: `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
	return `${list} couldn’t be restored.`
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
					<span className="text-foreground-destructive">{errored} failed</span>
				)}
				{created === 0 && skipped === 0 && errored === 0 && (
					<span className="text-muted-foreground">none</span>
				)}
			</span>
		</div>
	)
}
