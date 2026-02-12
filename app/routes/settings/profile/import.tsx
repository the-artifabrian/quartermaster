import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useRef, useState } from 'react'
import { data, Link, useFetcher } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/import.ts'

export const handle: SEOHandle = {
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

const ImportTagSchema = z.object({
	name: z.string().min(1).max(50),
	category: z.string().max(50).optional(),
})

const ImportRecipeSchema = z.object({
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
	tags: z.array(ImportTagSchema).max(50).optional(),
	image: z.any().optional(),
})

const ImportInventoryItemSchema = z.object({
	name: z.string().min(1).max(200),
	location: z.enum(['pantry', 'fridge', 'freezer']),
	quantity: z.number().nullable().optional(),
	unit: z.string().max(50).nullable().optional(),
	expiresAt: z.string().nullable().optional(),
	lowStock: z.boolean().optional(),
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

const ImportCookingLogSchema = z.object({
	cookedAt: z.string(),
	rating: z.number().int().min(1).max(5).nullable().optional(),
	notes: z.string().max(5000).nullable().optional(),
	recipe: z.string().min(1).max(100),
})

const ImportMealPlanTemplateEntrySchema = z.object({
	dayOfWeek: z.number().int().min(0).max(6),
	mealType: z.string().max(50),
	servings: z.number().int().positive().nullable().optional(),
	recipe: z.string().min(1).max(100),
})

const ImportMealPlanTemplateSchema = z.object({
	name: z.string().min(1).max(200),
	entries: z.array(ImportMealPlanTemplateEntrySchema).max(50),
})

const FullExportSchema = z
	.object({
		format: z.literal('quartermaster-full-export-v1'),
		recipes: z.array(ImportRecipeSchema).max(500),
		inventory: z.array(ImportInventoryItemSchema).max(1000).optional(),
		mealPlans: z.array(ImportMealPlanSchema).max(200).optional(),
		shoppingLists: z.array(ImportShoppingListSchema).max(100).optional(),
		cookingLogs: z.array(ImportCookingLogSchema).max(5000).optional(),
		mealPlanTemplates: z
			.array(ImportMealPlanTemplateSchema)
			.max(100)
			.optional(),
	})
	.passthrough()

const RecipeOnlyExportSchema = z
	.object({
		recipeCount: z.number(),
		recipes: z.array(ImportRecipeSchema).max(500),
	})
	.passthrough()

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
			error: `Invalid data: ${result.error.errors[0]?.message ?? 'validation failed'}`,
		}
	}

	if ('recipeCount' in obj) {
		const result = RecipeOnlyExportSchema.safeParse(parsed)
		if (result.success)
			return { type: 'recipe-only', data: result.data }
		return {
			error: `Invalid data: ${result.error.errors[0]?.message ?? 'validation failed'}`,
		}
	}

	return { error: 'Unrecognized format. Expected a Quartermaster export file.' }
}

// --- Preview types ---

interface ImportPreview {
	recipes: number
	inventory: number
	mealPlans: number
	shoppingLists: number
	cookingLogs: number
	mealPlanTemplates: number
	isFullExport: boolean
}

interface ImportResults {
	recipes: { created: number; skipped: number; errored: number }
	inventory: { created: number; skipped: number }
	mealPlans: { created: number; skipped: number }
	shoppingLists: { created: number }
	cookingLogs: { created: number; skipped: number }
	mealPlanTemplates: { created: number; skipped: number }
}

// --- Action ---

async function importRecipes(
	recipes: ImportRecipe[],
	titleToIdMap: Map<string, string>,
	userId: string,
	householdId: string,
) {
	const stats = { created: 0, skipped: 0, errored: 0 }

	// Pre-fetch all tags for efficient lookup
	const allTags = await prisma.tag.findMany({
		select: { id: true, name: true },
	})
	const tagNameToId = new Map(
		allTags.map((t) => [t.name.toLowerCase(), t.id]),
	)

	for (const recipe of recipes) {
		const lowerTitle = recipe.title.toLowerCase()
		if (titleToIdMap.has(lowerTitle)) {
			stats.skipped++
			continue
		}
		try {
			const instructions = recipe.instructions.map((inst, order) => ({
				content: typeof inst === 'string' ? inst : inst.content,
				order,
			}))

			const tagIds = (recipe.tags || [])
				.map((t) => tagNameToId.get(t.name.toLowerCase()))
				.filter((id): id is string => id != null)

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
					tags: tagIds.length
						? { connect: tagIds.map((id) => ({ id })) }
						: undefined,
				},
				select: { id: true },
			})
			titleToIdMap.set(lowerTitle, created.id)
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
		return data(
			{ error: importResult.error, results: null },
			{ status: 400 },
		)
	}

	const recipes = importResult.data.recipes
	const fullData = importResult.type === 'full' ? importResult.data : null

	const results: ImportResults = {
		recipes: { created: 0, skipped: 0, errored: 0 },
		inventory: { created: 0, skipped: 0 },
		mealPlans: { created: 0, skipped: 0 },
		shoppingLists: { created: 0 },
		cookingLogs: { created: 0, skipped: 0 },
		mealPlanTemplates: { created: 0, skipped: 0 },
	}

	// --- 1. Recipes ---
	const titleToIdMap = new Map<string, string>()
	try {
		const existingRecipes = await prisma.recipe.findMany({
			where: { householdId },
			select: { id: true, title: true },
		})
		for (const r of existingRecipes) {
			titleToIdMap.set(r.title.toLowerCase(), r.id)
		}

		results.recipes = await importRecipes(
			recipes,
			titleToIdMap,
			userId,
			householdId,
		)
	} catch {
		results.recipes.errored = recipes.length
	}

	// --- 2. Inventory ---
	if (fullData?.inventory) {
		try {
			const existingInventory = await prisma.inventoryItem.findMany({
				where: { householdId },
				select: { name: true, location: true },
			})
			const existingKeys = new Set(
				existingInventory.map(
					(i) => `${i.name.toLowerCase()}|${i.location}`,
				),
			)

			for (const item of fullData.inventory) {
				const key = `${item.name.toLowerCase()}|${item.location}`
				if (existingKeys.has(key)) {
					results.inventory.skipped++
					continue
				}
				try {
					await prisma.inventoryItem.create({
						data: {
							name: item.name,
							location: item.location,
							quantity: item.quantity ?? null,
							unit: item.unit || null,
							expiresAt: item.expiresAt
								? new Date(item.expiresAt)
								: null,
							lowStock: item.lowStock ?? false,
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

	// --- 3. Meal Plans ---
	if (fullData?.mealPlans) {
		for (const plan of fullData.mealPlans) {
			try {
				const weekStart = new Date(plan.weekStart)

				let mealPlan = await prisma.mealPlan.findUnique({
					where: { userId_weekStart: { userId, weekStart } },
				})
				if (!mealPlan) {
					mealPlan = await prisma.mealPlan.create({
						data: { weekStart, userId, householdId },
					})
				}

				for (const entry of plan.entries) {
					const recipeId = titleToIdMap.get(
						entry.recipe.toLowerCase(),
					)
					if (!recipeId) {
						results.mealPlans.skipped++
						continue
					}
					try {
						await prisma.mealPlanEntry.create({
							data: {
								date: new Date(entry.date),
								mealType: entry.mealType,
								servings: entry.servings ?? null,
								cooked: entry.cooked ?? false,
								mealPlanId: mealPlan.id,
								recipeId,
							},
						})
						results.mealPlans.created++
					} catch {
						results.mealPlans.skipped++
					}
				}
			} catch {
				// skip this meal plan
			}
		}
	}

	// --- 4. Shopping Lists ---
	if (fullData?.shoppingLists) {
		for (const list of fullData.shoppingLists) {
			try {
				await prisma.shoppingList.create({
					data: {
						name: list.name,
						userId,
						householdId,
						items: {
							create: list.items.map((item) => ({
								name: item.name,
								quantity: item.quantity || null,
								unit: item.unit || null,
								category: item.category || null,
								checked: item.checked ?? false,
								source: item.source || 'manual',
							})),
						},
					},
				})
				results.shoppingLists.created++
			} catch {
				// skip
			}
		}
	}

	// --- 5. Cooking Logs ---
	if (fullData?.cookingLogs) {
		for (const log of fullData.cookingLogs) {
			const recipeId = titleToIdMap.get(log.recipe.toLowerCase())
			if (!recipeId) {
				results.cookingLogs.skipped++
				continue
			}
			try {
				await prisma.cookingLog.create({
					data: {
						cookedAt: new Date(log.cookedAt),
						rating: log.rating ?? null,
						notes: log.notes || null,
						recipeId,
						userId,
					},
				})
				results.cookingLogs.created++
			} catch {
				results.cookingLogs.skipped++
			}
		}
	}

	// --- 6. Meal Plan Templates ---
	if (fullData?.mealPlanTemplates) {
		for (const template of fullData.mealPlanTemplates) {
			try {
				const entries = template.entries
					.map((entry) => {
						const recipeId = titleToIdMap.get(
							entry.recipe.toLowerCase(),
						)
						if (!recipeId) return null
						return {
							dayOfWeek: entry.dayOfWeek,
							mealType: entry.mealType,
							servings: entry.servings ?? null,
							recipeId,
						}
					})
					.filter(
						(e): e is NonNullable<typeof e> => e != null,
					)

				if (entries.length === 0) {
					results.mealPlanTemplates.skipped++
					continue
				}

				await prisma.mealPlanTemplate.create({
					data: {
						name: template.name,
						userId,
						householdId,
						entries: { create: entries },
					},
				})
				results.mealPlanTemplates.created++
			} catch {
				results.mealPlanTemplates.skipped++
			}
		}
	}

	// Emit household event
	const totalCreated = results.recipes.created + results.inventory.created
	if (totalCreated > 0) {
		void emitHouseholdEvent({
			type: 'data_imported',
			payload: {
				recipeCount: results.recipes.created,
				inventoryCount: results.inventory.created,
			},
			userId,
			householdId,
		})
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
		inventory: fullData?.inventory?.length ?? 0,
		mealPlans:
			fullData?.mealPlans?.reduce(
				(sum, p) => sum + p.entries.length,
				0,
			) ?? 0,
		shoppingLists: fullData?.shoppingLists?.length ?? 0,
		cookingLogs: fullData?.cookingLogs?.length ?? 0,
		mealPlanTemplates: fullData?.mealPlanTemplates?.length ?? 0,
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
				r.inventory.created +
				r.mealPlans.created +
				r.shoppingLists.created +
				r.cookingLogs.created +
				r.mealPlanTemplates.created
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
		<div className="container max-w-2xl py-6">
			<Link
				to="/settings/profile"
				className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
			>
				<Icon name="arrow-left" size="sm" />
				Back to settings
			</Link>
			<h1 className="mb-2 text-2xl font-bold">Import Data</h1>
			<p className="text-muted-foreground mb-6">
				Import a previously exported Quartermaster file. Both full
				exports and recipe-only exports are supported. Duplicates are
				automatically skipped.
			</p>

			{/* Phase 3: Results */}
			{results ? (
				<div className="space-y-4">
					<div className="bg-card rounded-xl border p-6 shadow-warm">
						<h2 className="mb-4 text-lg font-semibold">
							Import Complete
						</h2>
						<div className="space-y-3">
							<ResultRow
								label="Recipes"
								created={results.recipes.created}
								skipped={results.recipes.skipped}
								errored={results.recipes.errored}
							/>
							{(results.inventory.created > 0 ||
								results.inventory.skipped > 0) && (
								<ResultRow
									label="Inventory items"
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
							{results.shoppingLists.created > 0 && (
								<ResultRow
									label="Shopping lists"
									created={results.shoppingLists.created}
								/>
							)}
							{(results.cookingLogs.created > 0 ||
								results.cookingLogs.skipped > 0) && (
								<ResultRow
									label="Cooking logs"
									created={results.cookingLogs.created}
									skipped={results.cookingLogs.skipped}
								/>
							)}
							{(results.mealPlanTemplates.created > 0 ||
								results.mealPlanTemplates.skipped > 0) && (
								<ResultRow
									label="Meal plan templates"
									created={
										results.mealPlanTemplates.created
									}
									skipped={
										results.mealPlanTemplates.skipped
									}
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
					<div className="bg-card rounded-xl border p-6 shadow-warm">
						<label className="block">
							<span className="text-sm font-medium">
								Select export file
							</span>
							<input
								ref={fileInputRef}
								type="file"
								accept=".json"
								onChange={handleFileChange}
								className="mt-2 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
							/>
						</label>

						{fileError && (
							<p className="mt-3 text-sm text-destructive">
								{fileError}
							</p>
						)}
						{serverError && !results && (
							<p className="mt-3 text-sm text-destructive">
								{serverError}
							</p>
						)}

						<p className="text-muted-foreground mt-4 text-xs">
							Images are not included in exports and will be
							skipped during import.
						</p>
					</div>

					{/* Phase 2: Preview */}
					{preview && (
						<div className="mt-4 space-y-4">
							<div className="bg-card rounded-xl border p-6 shadow-warm">
								<h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
									{preview.isFullExport
										? 'Full Export'
										: 'Recipe-Only Export'}
								</h2>
								<div className="space-y-1.5 text-sm">
									<PreviewRow
										label="Recipes"
										count={preview.recipes}
									/>
									{preview.inventory > 0 && (
										<PreviewRow
											label="Inventory items"
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
									{preview.cookingLogs > 0 && (
										<PreviewRow
											label="Cooking logs"
											count={preview.cookingLogs}
										/>
									)}
									{preview.mealPlanTemplates > 0 && (
										<PreviewRow
											label="Meal plan templates"
											count={preview.mealPlanTemplates}
										/>
									)}
								</div>
								<p className="text-muted-foreground mt-3 text-xs">
									Existing recipes (matched by title) and
									inventory items (matched by name + location)
									will be automatically skipped.
								</p>
							</div>

							<div className="flex justify-end gap-3">
								<Button
									variant="outline"
									onClick={handleReset}
								>
									Cancel
								</Button>
								<StatusButton
									type="button"
									status={
										isSubmitting ? 'pending' : 'idle'
									}
									disabled={isSubmitting}
									onClick={handleSubmit}
								>
									{isSubmitting
										? 'Importing...'
										: 'Import'}
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
					<span className="text-muted-foreground">
						{skipped} skipped
					</span>
				)}
				{errored > 0 && (
					<span className="text-destructive">
						{errored} failed
					</span>
				)}
				{created === 0 && skipped === 0 && errored === 0 && (
					<span className="text-muted-foreground">none</span>
				)}
			</span>
		</div>
	)
}
