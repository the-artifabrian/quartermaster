import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useRef, useState } from 'react'
import { data, Link, useFetcher } from 'react-router'
import { toast } from 'sonner'
import { Button } from '#app/components/ui/button.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { captureServerEvent } from '#app/utils/posthog.server.ts'
import {
	FILE_TOO_BIG,
	parseImportData,
	RESTORE_MAX_FILE_BYTES,
} from './+backup-format.ts'
import { type Route } from './+types/import.ts'
import { type SettingsPageHandle } from './_layout.tsx'
import { jsonShapeError, readRestoreFile } from './restore-file.server.ts'
import { type ImportResults } from './restore-results.server.ts'
import { restore } from './restore.server.ts'

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
						<h2 className="phone:text-recipe-section phone:font-serif phone:font-medium mb-4 text-lg font-semibold">
							Import complete
						</h2>
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
							<span className="phone:text-label phone:text-muted-foreground phone:font-semibold text-sm font-medium">
								Select export file
							</span>
							<input
								ref={fileInputRef}
								type="file"
								accept=".json"
								onChange={handleFileChange}
								className="file:bg-primary-fill file:text-primary-foreground hover:file:bg-primary-fill/90 phone:text-base phone:file:min-h-11 phone:file:text-base mt-2 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:px-4 file:py-2 file:text-sm file:font-medium"
							/>
						</label>

						{fileError && (
							<p className="text-foreground-destructive phone:text-label mt-3 text-sm">
								{fileError}
							</p>
						)}
						{serverError && !results && (
							<p className="text-foreground-destructive phone:text-label mt-3 text-sm">
								{serverError}
							</p>
						)}

						<p className="text-muted-foreground phone:text-label mt-4 text-xs">
							Exports don&apos;t include images, so none are imported.
						</p>
					</div>

					{preview && (
						<div className="mt-4 space-y-4">
							<div className="bg-muted/40 rounded-lg p-6">
								<h2 className="text-muted-foreground phone:text-label phone:tracking-normal phone:normal-case mb-3 text-sm font-semibold tracking-wider uppercase">
									{preview.isFullExport ? 'Full export' : 'Recipes-only export'}
								</h2>
								<div className="phone:text-base space-y-1.5 text-sm">
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
								<p className="text-muted-foreground phone:text-label mt-3 text-xs">
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
		<div className="phone:text-base flex items-center justify-between text-sm">
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
