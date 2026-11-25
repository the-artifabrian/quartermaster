// The restore's schemas and limits. The export routes build this shape on their own.

import { z } from 'zod'
import {
	householdIngredientDisplayName,
	householdIngredientKey,
} from '#app/utils/household-ingredient.ts'
import { MAX_RAW_TEXT_LENGTH } from '#app/utils/recipe-validation.ts'
import {
	RecipeMetadataDimensionSchema,
	RecipeMetadataNameSchema,
	recipeMetadataNameKey,
} from '#app/utils/recipe-metadata.ts'
import {
	NEXT_SHOP,
	ShoppingHorizonSchema,
} from '#app/utils/shopping-horizon.ts'

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

export const ImportHouseholdIngredientSchema = z
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
export const ImportMealPlanEntrySchema = z.object({
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
export const ImportMealItemSchema = z.object({
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

export const ImportMealSchema = z
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

export const ImportMealPlanSchema = z.object({
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

export const ImportShoppingListSchema = z.object({
	name: z.string().min(1).max(200).optional().default('Shopping List'),
	items: boundedArray(ImportShoppingListItemSchema, 500),
})

// One schema for both card kinds. Recipe fields and note fields are each
// optional so the other kind parses, and `kind` decides which are read.
export const ImportMenuItemSchema = z.object({
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

export const ImportMenuSchema = z.object({
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
export type ImportRecipe = z.infer<typeof ImportRecipeSchema>

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
export const FILE_TOO_BIG =
	'That file is too big. A restore takes files up to 10 MB.'

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

export function parseImportData(
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
