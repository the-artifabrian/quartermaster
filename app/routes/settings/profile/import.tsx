import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { createId } from '@paralleldrive/cuid2'
import { useEffect, useRef, useState } from 'react'
import { data, Link, useFetcher } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { captureServerEvent } from '#app/utils/posthog.server.ts'
import { ensureRecipeMetadataValues } from '#app/utils/recipe-metadata.server.ts'
import {
	RecipeMetadataDimensionSchema,
	recipeMetadataIdentity,
} from '#app/utils/recipe-metadata.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { writeTransaction } from '#app/utils/write-transaction.server.ts'
import {
	FILE_TOO_BIG,
	ImportShoppingListSchema,
	parseImportData,
	RESTORE_MAX_FILE_BYTES,
} from './+export-format.ts'
import { type Route } from './+types/import.ts'
import { type SettingsPageHandle } from './_layout.tsx'
import { jsonShapeError, readRestoreFile } from './restore-file.server.ts'
import { importMealPlans } from './restore-meals.server.ts'
import { importMenus } from './restore-menus.server.ts'
import { importRecipes, type RecipeIndex } from './restore-recipes.server.ts'
import {
	type ImportResults,
	type RecordFailure,
	refusedWriteCode,
	type RestoreFailure,
} from './restore-results.server.ts'

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

	// Household ingredients (Staples included): rows the Household already has
	// win, so a restore never rewrites a choice the Household has already made.
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
