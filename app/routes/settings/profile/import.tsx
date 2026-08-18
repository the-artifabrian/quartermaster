import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useRef, useState } from 'react'
import { data, Link, useFetcher } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	ensureMealPlan,
	ensureMealPlanEntry,
} from '#app/utils/meal-plan.server.ts'
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

const ImportMealPlanEntrySchema = z.object({
	date: z.string(),
	mealType: z.string().max(50),
	servings: z.number().int().positive().nullable().optional(),
	cooked: z.boolean().optional(),
	recipe: z.string().min(1).max(100),
})

const ImportMealPlanSchema = z.object({
	weekStart: z.string(),
	entries: z.array(ImportMealPlanEntrySchema).max(100),
})

const ImportShoppingListItemSchema = z.object({
	name: z.string().min(1).max(200),
	quantity: z.string().max(50).nullable().optional(),
	unit: z.string().max(50).nullable().optional(),
	category: z.string().max(50).nullable().optional(),
	checked: z.boolean().optional(),
	source: z.string().max(50).optional(),
})

const ImportShoppingListSchema = z.object({
	name: z.string().min(1).max(200).optional().default('Shopping List'),
	items: z.array(ImportShoppingListItemSchema).max(500),
})

const ImportMenuShoppingLineSchema = z.object({
	name: z.string().min(1).max(200),
	quantity: z.string().max(50).nullable().optional(),
	unit: z.string().max(50).nullable().optional(),
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
	inventory: number
	mealPlans: number
	shoppingLists: number
	isFullExport: boolean
}

interface ImportResults {
	recipes: { created: number; skipped: number; errored: number }
	menus: { created: number; skipped: number; errored: number }
	inventory: { created: number; skipped: number }
	mealPlans: { created: number; skipped: number }
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
	// Pro-only data (inventory, meal plans, shopping lists) is skipped for
	// free users — only recipes are imported.
	const fullData =
		importResult.type === 'full' && isProActive ? importResult.data : null

	const results: ImportResults = {
		recipes: { created: 0, skipped: 0, errored: 0 },
		menus: { created: 0, skipped: 0, errored: 0 },
		inventory: { created: 0, skipped: 0 },
		mealPlans: { created: 0, skipped: 0 },
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
	const fullMenus =
		importResult.type === 'full' ? (importResult.data.menus ?? null) : null
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

	// --- 4. Meal Plans ---
	if (fullData?.mealPlans) {
		for (const plan of fullData.mealPlans) {
			try {
				const weekStart = new Date(plan.weekStart)

				const mealPlan = await ensureMealPlan(prisma, {
					householdId,
					weekStart,
				})

				for (const entry of plan.entries) {
					const recipeId = titleToIdMap.get(entry.recipe.toLowerCase())
					if (!recipeId) {
						results.mealPlans.skipped++
						continue
					}
					try {
						const result = await ensureMealPlanEntry(prisma, {
							date: new Date(entry.date),
							mealType: entry.mealType,
							servings: entry.servings ?? null,
							cooked: entry.cooked ?? false,
							mealPlanId: mealPlan.id,
							recipeId,
						})
						results.mealPlans[result.created ? 'created' : 'skipped']++
					} catch {
						results.mealPlans.skipped++
					}
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
					name: true,
					quantity: true,
					unit: true,
					category: true,
					checked: true,
					source: true,
				},
			})
			const existingKeys = new Set(
				existingItems.map(getShoppingListItemImportKey),
			)

			for (const list of fullData.shoppingLists) {
				const batchKeys = new Set<string>()
				let skipped = 0
				const newItems: ShoppingListItemImport[] = []
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
					if (existingKeys.has(key) || batchKeys.has(key)) {
						skipped++
						continue
					}
					batchKeys.add(key)
					newItems.push(normalizedItem)
				}

				if (newItems.length > 0) {
					await prisma.shoppingListItem.createMany({
						data: newItems.map((item) => ({
							...item,
							listId: shoppingList.id,
						})),
					})
					for (const key of batchKeys) existingKeys.add(key)
				}
				results.shoppingLists.created += newItems.length
				results.shoppingLists.skipped += skipped
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
		inventory: fullData?.inventory?.length ?? 0,
		mealPlans:
			fullData?.mealPlans?.reduce((sum, p) => sum + p.entries.length, 0) ?? 0,
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
				r.inventory.created +
				r.mealPlans.created +
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
							{(results.mealPlans.created > 0 ||
								results.mealPlans.skipped > 0) && (
								<ResultRow
									label="Meal plan entries"
									created={results.mealPlans.created}
									skipped={results.mealPlans.skipped}
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
									{preview.mealPlans > 0 && (
										<PreviewRow
											label="Meal plan entries"
											count={preview.mealPlans}
										/>
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
