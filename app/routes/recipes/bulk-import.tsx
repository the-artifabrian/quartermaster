import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useCallback, useEffect, useRef, useState } from 'react'
import { data, Link, useFetcher } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import {
	parseRecipeText,
	splitMultipleRecipes,
	type ParsedRecipe,
} from '#app/utils/bulk-recipe-parser.ts'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { useDebounce } from '#app/utils/misc.tsx'
import { type Route } from './+types/bulk-import.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Bulk Import | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithHousehold(request)
	return {}
}

const BulkImportIngredientSchema = z.object({
	name: z.string().min(1).max(200),
	amount: z.string().max(50).optional(),
	unit: z.string().max(50).optional(),
	notes: z.string().max(500).optional(),
})

const BulkImportRecipeSchema = z.object({
	title: z.string().min(1).max(100),
	description: z.string().max(500).optional(),
	ingredients: z.array(BulkImportIngredientSchema).max(200),
	instructions: z
		.array(z.object({ content: z.string().min(1).max(5000) }))
		.max(200),
})

const BulkImportPayloadSchema = z.array(BulkImportRecipeSchema).min(1).max(50)

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const formData = await request.formData()
	const rawJson = formData.get('recipes')

	if (typeof rawJson !== 'string') {
		return data(
			{
				created: 0,
				skipped: [],
				errors: [{ title: 'Unknown', error: 'Invalid payload' }],
			},
			{ status: 400 },
		)
	}

	let recipes: z.infer<typeof BulkImportPayloadSchema>
	try {
		const parsed = JSON.parse(rawJson)
		recipes = BulkImportPayloadSchema.parse(parsed)
	} catch (err) {
		if (err instanceof z.ZodError) {
			const details = err.errors
				.slice(0, 5)
				.map((e) => `${e.path.join('.')}: ${e.message}`)
				.join('; ')
			return data(
				{
					created: 0,
					skipped: [],
					errors: [{ title: 'Validation error', error: details }],
				},
				{ status: 400 },
			)
		}
		return data(
			{
				created: 0,
				skipped: [],
				errors: [{ title: 'Unknown', error: 'Invalid recipe data' }],
			},
			{ status: 400 },
		)
	}

	const existingTitles = new Set(
		(
			await prisma.recipe.findMany({
				where: { householdId },
				select: { title: true },
			})
		).map((r) => r.title.toLowerCase()),
	)

	const created: string[] = []
	const skipped: string[] = []
	const errors: Array<{ title: string; error: string }> = []

	for (const recipe of recipes) {
		if (existingTitles.has(recipe.title.toLowerCase())) {
			skipped.push(recipe.title)
			continue
		}
		try {
			await prisma.recipe.create({
				data: {
					title: recipe.title,
					description: recipe.description || null,
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
					instructions: {
						create: recipe.instructions.map((inst, order) => ({
							content: inst.content,
							order,
						})),
					},
				},
			})
			created.push(recipe.title)
			existingTitles.add(recipe.title.toLowerCase())
		} catch (err) {
			errors.push({
				title: recipe.title,
				error: 'Failed to save recipe',
			})
		}
	}

	if (created.length > 0) {
		void emitHouseholdEvent({
			type: 'recipes_bulk_imported',
			payload: { count: created.length },
			userId,
			householdId,
		})
	}

	return { created: created.length, skipped, errors }
}

function readFileAsText(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result as string)
		reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
		reader.readAsText(file)
	})
}

export default function BulkImport() {
	const fetcher = useFetcher<typeof action>()
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const [previews, setPreviews] = useState<ParsedRecipe[]>([])
	const [sessionCount, setSessionCount] = useState(0)
	const [nudgeDismissed, setNudgeDismissed] = useState(false)
	const [uploadedFileNames, setUploadedFileNames] = useState<string[]>([])
	const [isReadingFiles, setIsReadingFiles] = useState(false)
	const [isDragOver, setIsDragOver] = useState(false)

	const isSubmitting = fetcher.state === 'submitting'
	const hasUploadedFiles = uploadedFileNames.length > 0

	const handleChange = useDebounce((value: string) => {
		if (!value.trim()) {
			setPreviews([])
			return
		}
		const chunks = splitMultipleRecipes(value)
		setPreviews(chunks.map(parseRecipeText))
	}, 300)

	async function handleFileUpload(files: FileList | null) {
		if (!files || files.length === 0) return
		setIsReadingFiles(true)
		try {
			const fileArray = Array.from(files)
			const contents = await Promise.all(fileArray.map(readFileAsText))
			const allParsed: ParsedRecipe[] = []
			for (const text of contents) {
				const chunks = splitMultipleRecipes(text)
				allParsed.push(...chunks.map(parseRecipeText))
			}
			setUploadedFileNames(fileArray.map((f) => f.name))
			setPreviews(allParsed)
			if (textareaRef.current) {
				textareaRef.current.value = ''
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to read files')
		} finally {
			setIsReadingFiles(false)
		}
	}

	const clearFiles = useCallback(() => {
		setUploadedFileNames([])
		setPreviews([])
		if (fileInputRef.current) {
			fileInputRef.current.value = ''
		}
	}, [])

	// Handle fetcher completion — toast + clear are external side effects
	const lastFetcherData = useRef(fetcher.data)
	useEffect(() => {
		if (!fetcher.data || fetcher.data === lastFetcherData.current) return
		lastFetcherData.current = fetcher.data
		const { created, skipped, errors } = fetcher.data
		if (created > 0) {
			setSessionCount((prev) => prev + created)
			toast.success(`Imported ${created} recipe${created === 1 ? '' : 's'}`)
			if (textareaRef.current) {
				textareaRef.current.value = ''
				textareaRef.current.focus()
			}
			clearFiles()
		}
		if (skipped && skipped.length > 0) {
			toast.info(
				`Skipped ${skipped.length} duplicate${skipped.length === 1 ? '' : 's'}: ${skipped.join(', ')}`,
			)
		}
		if (errors.length > 0) {
			toast.error(
				`Failed to import ${errors.length}: ${errors.map((e) => e.title).join(', ')}`,
			)
		}
	}, [fetcher.data, clearFiles])

	const validPreviews = previews.filter(
		(p) => p.title && p.ingredients.length > 0,
	)

	function handleSubmit() {
		const payload = validPreviews.map((p) => ({
			title: p.title,
			description: p.description,
			ingredients: p.ingredients,
			instructions: p.instructions,
		}))
		const formData = new FormData()
		formData.set('recipes', JSON.stringify(payload))
		void fetcher.submit(formData, { method: 'POST' })
	}

	return (
		<div className="container max-w-2xl py-6 pb-20 md:pb-6">
			<Link
				to="/recipes"
				className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
			>
				<Icon name="arrow-left" size="sm" />
				Back to recipes
			</Link>
			<h1 className="mb-2 text-2xl font-bold">Bulk Import</h1>
			<p className="text-muted-foreground mb-6">
				Upload{' '}
				<code className="bg-muted rounded px-1.5 py-0.5 text-xs">.md</code> or{' '}
				<code className="bg-muted rounded px-1.5 py-0.5 text-xs">.txt</code>{' '}
				files, or paste recipe text below. Use{' '}
				<code className="bg-muted rounded px-1.5 py-0.5 text-xs">---</code> to
				separate multiple recipes. Max 50 per batch.
			</p>

			{sessionCount > 0 && (
				<div className="bg-accent/20 text-foreground mb-4 rounded-lg px-4 py-2 text-sm">
					{sessionCount} recipe{sessionCount === 1 ? '' : 's'} imported this
					session
				</div>
			)}

			{sessionCount > 0 && !nudgeDismissed && (
				<div className="bg-card border-border shadow-warm relative mb-4 rounded-2xl border p-5">
					<button
						type="button"
						onClick={() => setNudgeDismissed(true)}
						className="text-muted-foreground hover:text-foreground absolute top-3 right-3"
						aria-label="Dismiss"
					>
						<Icon name="cross-1" size="sm" />
					</button>
					<div className="flex items-start gap-3">
						<Icon
							name="cookie"
							className="text-primary mt-0.5 size-6 shrink-0"
						/>
						<div>
							<h3 className="font-semibold">Ready to plan your week?</h3>
							<p className="text-muted-foreground mt-1 text-sm">
								Pick a few of your {sessionCount} new recipe
								{sessionCount === 1 ? '' : 's'} and plan this week's meals.
							</p>
							<div className="mt-3 flex flex-wrap items-center gap-3">
								<Button asChild>
									<Link to="/plan">
										Plan your week
										<Icon name="arrow-right" size="sm" />
									</Link>
								</Button>
								<Link
									to="/recipes"
									className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-2"
								>
									Browse recipes first
								</Link>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* File upload zone */}
			{hasUploadedFiles ? (
				<div className="border-border bg-card mb-4 rounded-lg border p-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Icon
								name="file-text"
								size="md"
								className="text-muted-foreground"
							/>
							<span className="text-sm font-medium">
								{uploadedFileNames.length} file
								{uploadedFileNames.length === 1 ? '' : 's'} loaded (
								{previews.length} recipe{previews.length === 1 ? '' : 's'})
							</span>
						</div>
						<Button variant="ghost" size="sm" onClick={clearFiles}>
							Clear files
						</Button>
					</div>
					<p className="text-muted-foreground mt-1 text-xs">
						{uploadedFileNames.slice(0, 5).join(', ')}
						{uploadedFileNames.length > 5
							? `, and ${uploadedFileNames.length - 5} more`
							: ''}
					</p>
				</div>
			) : (
				<>
					<div
						className={`mb-4 flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors ${isDragOver ? 'border-primary bg-accent/50' : 'border-input hover:bg-accent/50'}`}
						onDragOver={(e) => {
							e.preventDefault()
							setIsDragOver(true)
						}}
						onDragLeave={() => setIsDragOver(false)}
						onDrop={(e) => {
							e.preventDefault()
							setIsDragOver(false)
							void handleFileUpload(e.dataTransfer.files)
						}}
						onClick={() => fileInputRef.current?.click()}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault()
								fileInputRef.current?.click()
							}
						}}
						role="button"
						tabIndex={0}
					>
						<Icon
							name="file-text"
							size="lg"
							className="text-muted-foreground"
						/>
						<span className="text-sm font-medium">
							{isReadingFiles
								? 'Reading files...'
								: isDragOver
									? 'Drop files here'
									: 'Choose files or drag & drop'}
						</span>
						<span className="text-muted-foreground text-xs">
							.md and .txt files supported
						</span>
						<input
							ref={fileInputRef}
							type="file"
							accept=".md,.txt"
							multiple
							className="hidden"
							onChange={(e) => handleFileUpload(e.target.files)}
						/>
					</div>
					<textarea
						ref={textareaRef}
						rows={16}
						autoFocus
						className="bg-background border-input placeholder:text-muted-foreground mb-4 w-full rounded-lg border p-4 font-mono text-sm focus:ring-2 focus:ring-offset-2 focus:outline-none"
						placeholder={`Chicken Stir Fry

Ingredients
- 2 cups chicken breast, diced
- 1 tbsp soy sauce
- 3 cloves garlic

Instructions
1. Heat oil in a pan.
2. Add chicken and cook until browned.
3. Add garlic and soy sauce.

---

(paste another recipe here)`}
						onChange={(e) => handleChange(e.target.value)}
					/>
				</>
			)}

			{/* Preview */}
			{previews.length > 0 && (
				<div className="mb-4 space-y-3">
					<h2 className="text-sm font-medium">
						Preview ({previews.length} recipe
						{previews.length === 1 ? '' : 's'})
					</h2>
					{previews.map((recipe, i) => (
						<div
							key={i}
							className="border-border bg-card rounded-lg border p-4"
						>
							<div className="flex items-start justify-between gap-2">
								<div>
									<h3 className="font-medium">
										{recipe.title || (
											<span className="text-muted-foreground italic">
												No title
											</span>
										)}
									</h3>
									{recipe.description && (
										<p className="text-muted-foreground mt-0.5 text-sm">
											{recipe.description}
										</p>
									)}
									<p className="text-muted-foreground mt-1 text-xs">
										{recipe.ingredients.length} ingredient
										{recipe.ingredients.length === 1 ? '' : 's'}
										{' · '}
										{recipe.instructions.length} step
										{recipe.instructions.length === 1 ? '' : 's'}
									</p>
								</div>
								{recipe.warnings.length > 0 && (
									<div className="shrink-0">
										<Icon
											name="question-mark-circled"
											className="text-amber-500"
											size="sm"
										/>
									</div>
								)}
							</div>
							{recipe.warnings.length > 0 && (
								<div className="mt-2 space-y-1">
									{recipe.warnings.map((w, j) => (
										<p
											key={j}
											className="text-xs text-amber-600 dark:text-amber-400"
										>
											{w}
										</p>
									))}
								</div>
							)}
						</div>
					))}
				</div>
			)}

			<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
				<Button variant="outline" asChild>
					<Link to="/recipes">Cancel</Link>
				</Button>
				<StatusButton
					type="button"
					status={isSubmitting ? 'pending' : 'idle'}
					disabled={validPreviews.length === 0 || isSubmitting}
					onClick={handleSubmit}
				>
					{isSubmitting
						? 'Importing...'
						: `Import ${validPreviews.length} Recipe${validPreviews.length === 1 ? '' : 's'}`}
				</StatusButton>
			</div>
		</div>
	)
}
