import { parseWithZod } from '@conform-to/zod'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import * as cheerio from 'cheerio'
import {
	data,
	Form,
	Link,
	redirect,
	useActionData,
	useNavigation,
} from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	parseIngredient,
	parseISODuration,
} from '#app/utils/ingredient-parser.server.ts'
import { ImportUrlSchema } from '#app/utils/recipe-validation.ts'
import { type Route } from './+types/import.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Import Recipe | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserId(request)
	return {}
}

type ExtractedRecipe = {
	title: string
	description: string | null
	servings: number
	prepTime: number | null
	cookTime: number | null
	sourceUrl: string
	ingredients: Array<{
		name: string
		amount?: string
		unit?: string
		notes?: string
	}>
	instructions: Array<{ content: string }>
}

type DuplicateMatch = {
	id: string
	title: string
	sourceUrl: string | null
	matchReason: 'same-url' | 'similar-title'
}

function isAllowedUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return false
		}
		const hostname = parsed.hostname
		// Block localhost and private/reserved ranges
		if (
			hostname === 'localhost' ||
			hostname === '127.0.0.1' ||
			hostname === '[::1]' ||
			hostname === '0.0.0.0' ||
			hostname.endsWith('.local') ||
			hostname.startsWith('10.') ||
			hostname.startsWith('192.168.') ||
			hostname.startsWith('169.254.') ||
			/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
		) {
			return false
		}
		return true
	} catch {
		return false
	}
}

function findRecipeInJsonLd(obj: unknown): Record<string, unknown> | null {
	if (!obj || typeof obj !== 'object') return null

	if (Array.isArray(obj)) {
		for (const item of obj) {
			const found = findRecipeInJsonLd(item)
			if (found) return found
		}
		return null
	}

	const record = obj as Record<string, unknown>

	// Check @type
	const type = record['@type']
	if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
		return record
	}

	// Check @graph
	if (record['@graph']) {
		return findRecipeInJsonLd(record['@graph'])
	}

	return null
}

function parseServings(value: unknown): number {
	if (!value) return 4
	const str = Array.isArray(value) ? value[0] : String(value)
	const match = String(str).match(/\d+/)
	return match ? parseInt(match[0], 10) : 4
}

function parseInstructions(value: unknown): Array<{ content: string }> {
	if (!value) return []

	if (typeof value === 'string') {
		return value
			.split(/\n+/)
			.map((s) => s.trim())
			.filter(Boolean)
			.map((content) => ({ content }))
	}

	if (Array.isArray(value)) {
		const result: Array<{ content: string }> = []
		for (const item of value) {
			if (typeof item === 'string') {
				const cleaned = item.trim()
				if (cleaned) result.push({ content: cleaned })
			} else if (item && typeof item === 'object') {
				const obj = item as Record<string, unknown>
				// HowToStep
				if (obj.text) {
					const text = String(obj.text).trim()
					if (text) result.push({ content: text })
				}
				// HowToSection
				else if (obj.itemListElement) {
					const sectionSteps = parseInstructions(obj.itemListElement)
					result.push(...sectionSteps)
				}
			}
		}
		return result
	}

	return []
}

function extractRecipe(
	jsonLd: Record<string, unknown>,
	url: string,
): ExtractedRecipe {
	const rawIngredients = (jsonLd.recipeIngredient as string[]) || []
	const ingredients = rawIngredients
		.map((line) => parseIngredient(line))
		.filter((ing): ing is NonNullable<typeof ing> => ing !== null)

	const instructions = parseInstructions(jsonLd.recipeInstructions)

	return {
		title: String(jsonLd.name || 'Untitled Recipe'),
		description: jsonLd.description ? String(jsonLd.description) : null,
		servings: parseServings(jsonLd.recipeYield),
		prepTime: jsonLd.prepTime
			? (parseISODuration(String(jsonLd.prepTime)) ?? null)
			: null,
		cookTime: jsonLd.cookTime
			? (parseISODuration(String(jsonLd.cookTime)) ?? null)
			: null,
		sourceUrl: url,
		ingredients,
		instructions,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'fetch') {
		const submission = parseWithZod(formData, { schema: ImportUrlSchema })
		if (submission.status !== 'success') {
			return data(
				{
					intent: 'fetch' as const,
					error: 'Please enter a valid URL.',
					recipe: null,
					result: submission.reply(),
					duplicates: null,
				},
				{ status: 400 },
			)
		}

		const { url } = submission.value

		if (!isAllowedUrl(url)) {
			return data(
				{
					intent: 'fetch' as const,
					error:
						'This URL cannot be imported. Please use a public HTTP(S) URL.',
					recipe: null,
					result: null,
					duplicates: null,
				},
				{ status: 400 },
			)
		}

		try {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), 10000)

			const response = await fetch(url, {
				signal: controller.signal,
				headers: {
					'User-Agent':
						'Mozilla/5.0 (compatible; Quartermaster/1.0; +recipe-import)',
					Accept: 'text/html',
				},
			})
			clearTimeout(timeout)

			if (!response.ok) {
				return data(
					{
						intent: 'fetch' as const,
						error: `Failed to fetch URL (${response.status})`,
						recipe: null,
						result: null,
						duplicates: null,
					},
					{ status: 400 },
				)
			}

			const html = await response.text()
			const $ = cheerio.load(html)

			let recipeData: Record<string, unknown> | null = null

			$('script[type="application/ld+json"]').each((_, el) => {
				if (recipeData) return
				try {
					const parsed = JSON.parse($(el).html() || '')
					recipeData = findRecipeInJsonLd(parsed)
				} catch {
					// skip invalid JSON
				}
			})

			if (!recipeData) {
				return data(
					{
						intent: 'fetch' as const,
						error:
							'No recipe data found on this page. The site may not use structured recipe data (JSON-LD).',
						recipe: null,
						result: null,
						duplicates: null,
					},
					{ status: 400 },
				)
			}

			const recipe = extractRecipe(recipeData, url)

			// Check for duplicates
			const duplicates: DuplicateMatch[] = []

			const urlMatches = await prisma.recipe.findMany({
				where: { userId, sourceUrl: url },
				select: { id: true, title: true, sourceUrl: true },
			})
			for (const match of urlMatches) {
				duplicates.push({ ...match, matchReason: 'same-url' })
			}

			const urlMatchIds = new Set(urlMatches.map((m) => m.id))
			const titleMatches = await prisma.recipe.findMany({
				where: {
					userId,
					title: { equals: recipe.title },
					id: { notIn: [...urlMatchIds] },
				},
				select: { id: true, title: true, sourceUrl: true },
			})
			for (const match of titleMatches) {
				duplicates.push({ ...match, matchReason: 'similar-title' })
			}

			return data({
				intent: 'fetch' as const,
				recipe,
				error: null,
				result: null,
				duplicates: duplicates.length > 0 ? duplicates : null,
			})
		} catch (error) {
			const message =
				error instanceof Error && error.name === 'AbortError'
					? 'Request timed out. The site took too long to respond.'
					: 'Failed to fetch the URL. Please check the address and try again.'
			return data(
				{
					intent: 'fetch' as const,
					error: message,
					recipe: null,
					result: null,
					duplicates: null,
				},
				{ status: 400 },
			)
		}
	}

	if (intent === 'save') {
		const title = formData.get('title') as string
		const description = (formData.get('description') as string) || null
		const servings = parseInt(formData.get('servings') as string, 10) || 4
		const prepTime = formData.get('prepTime')
			? parseInt(formData.get('prepTime') as string, 10)
			: null
		const cookTime = formData.get('cookTime')
			? parseInt(formData.get('cookTime') as string, 10)
			: null
		const sourceUrl = (formData.get('sourceUrl') as string) || null

		// Parse ingredients
		const ingredients: Array<{
			name: string
			amount?: string
			unit?: string
			notes?: string
		}> = []
		let i = 0
		while (formData.has(`ingredients[${i}].name`)) {
			const name = formData.get(`ingredients[${i}].name`) as string
			if (name.trim()) {
				ingredients.push({
					name,
					amount:
						(formData.get(`ingredients[${i}].amount`) as string) || undefined,
					unit: (formData.get(`ingredients[${i}].unit`) as string) || undefined,
					notes:
						(formData.get(`ingredients[${i}].notes`) as string) || undefined,
				})
			}
			i++
		}

		// Parse instructions
		const instructions: Array<{ content: string }> = []
		i = 0
		while (formData.has(`instructions[${i}].content`)) {
			const content = formData.get(`instructions[${i}].content`) as string
			if (content.trim()) {
				instructions.push({ content })
			}
			i++
		}

		if (!title) {
			return data(
				{
					intent: 'save' as const,
					error: 'Title is required.',
					recipe: null,
					result: null,
					duplicates: null,
				},
				{ status: 400 },
			)
		}

		const recipe = await prisma.recipe.create({
			data: {
				title,
				description,
				servings,
				prepTime,
				cookTime,
				sourceUrl,
				userId,
				ingredients: {
					create: ingredients.map((ing, order) => ({
						name: ing.name,
						amount: ing.amount || null,
						unit: ing.unit || null,
						notes: ing.notes || null,
						order,
					})),
				},
				instructions: {
					create: instructions.map((inst, order) => ({
						content: inst.content,
						order,
					})),
				},
			},
			select: { id: true },
		})

		return redirect(`/recipes/${recipe.id}`)
	}

	return data(
		{
			intent: null,
			error: 'Invalid action',
			recipe: null,
			result: null,
			duplicates: null,
		},
		{ status: 400 },
	)
}

export default function ImportRecipe() {
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'

	const recipe = actionData && 'recipe' in actionData ? actionData.recipe : null
	const error = actionData && 'error' in actionData ? actionData.error : null
	const duplicates =
		actionData && 'duplicates' in actionData ? actionData.duplicates : null
	const hasRecipe = recipe && !error

	return (
		<div className="container max-w-2xl py-6">
			<Link
				to="/recipes"
				className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
			>
				<Icon name="arrow-left" size="sm" />
				Back to recipes
			</Link>
			<h1 className="mb-6 text-2xl font-bold">Import from URL</h1>
			<p className="text-muted-foreground mb-6">
				Paste a URL from a recipe website. We'll extract the recipe details
				automatically from sites that use structured data.
			</p>

			{/* Phase A: URL input */}
			{!hasRecipe && (
				<Form method="POST" className="space-y-4">
					<input type="hidden" name="intent" value="fetch" />
					<div className="space-y-2">
						<Label htmlFor="url">Recipe URL</Label>
						<Input
							id="url"
							name="url"
							type="url"
							placeholder="https://example.com/recipe/..."
							autoFocus
							required
						/>
					</div>
					{error && (
						<div className="border-destructive bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
							{error}
						</div>
					)}
					<div className="flex justify-end gap-4">
						<Button
							type="button"
							variant="outline"
							onClick={() => history.back()}
						>
							Cancel
						</Button>
						<StatusButton
							type="submit"
							status={isSubmitting ? 'pending' : 'idle'}
							disabled={isSubmitting}
						>
							{isSubmitting ? 'Fetching...' : 'Fetch Recipe'}
						</StatusButton>
					</div>
				</Form>
			)}

			{/* Phase B: Preview & Save */}
			{hasRecipe && (
				<div className="space-y-6">
					<div className="space-y-4 rounded-lg border p-6">
						<h2 className="text-xl font-semibold">{recipe.title}</h2>
						{recipe.description && (
							<p className="text-muted-foreground text-sm">
								{recipe.description}
							</p>
						)}
						<div className="text-muted-foreground flex flex-wrap gap-4 text-sm">
							<span>Servings: {recipe.servings}</span>
							{recipe.prepTime && <span>Prep: {recipe.prepTime} min</span>}
							{recipe.cookTime && <span>Cook: {recipe.cookTime} min</span>}
						</div>

						{recipe.ingredients.length > 0 && (
							<div>
								<h3 className="mb-2 font-medium">
									Ingredients ({recipe.ingredients.length})
								</h3>
								<ul className="space-y-1 text-sm">
									{recipe.ingredients.map((ing, i) => (
										<li key={i} className="flex gap-1">
											<span className="text-muted-foreground">-</span>
											{ing.amount && (
												<span className="font-medium">{ing.amount}</span>
											)}
											{ing.unit && <span>{ing.unit}</span>}
											<span>{ing.name}</span>
											{ing.notes && (
												<span className="text-muted-foreground">
													, {ing.notes}
												</span>
											)}
										</li>
									))}
								</ul>
							</div>
						)}

						{recipe.instructions.length > 0 && (
							<div>
								<h3 className="mb-2 font-medium">
									Instructions ({recipe.instructions.length} steps)
								</h3>
								<ol className="space-y-2 text-sm">
									{recipe.instructions.map((inst, i) => (
										<li key={i} className="flex gap-2">
											<span className="text-muted-foreground shrink-0">
												{i + 1}.
											</span>
											<span>{inst.content}</span>
										</li>
									))}
								</ol>
							</div>
						)}
					</div>

					{duplicates && duplicates.length > 0 && (
						<div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/50">
							<div className="flex items-start gap-3">
								<Icon
									name="question-mark-circled"
									className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
								/>
								<div className="space-y-2">
									<p className="font-medium text-amber-800 dark:text-amber-200">
										You may already have this recipe
									</p>
									<ul className="space-y-1 text-sm text-amber-700 dark:text-amber-300">
										{duplicates.map((dup) => (
											<li key={dup.id}>
												<Link
													to={`/recipes/${dup.id}`}
													target="_blank"
													className="underline hover:no-underline"
												>
													{dup.title}
												</Link>{' '}
												<span className="text-amber-600 dark:text-amber-400">
													({dup.matchReason === 'same-url'
														? 'same URL'
														: 'same title'})
												</span>
											</li>
										))}
									</ul>
									<p className="text-sm text-amber-600 dark:text-amber-400">
										You can still save this recipe if you'd like a second copy.
									</p>
								</div>
							</div>
						</div>
					)}

					<Form method="POST">
						<input type="hidden" name="intent" value="save" />
						<input type="hidden" name="title" value={recipe.title} />
						<input
							type="hidden"
							name="description"
							value={recipe.description ?? ''}
						/>
						<input type="hidden" name="servings" value={recipe.servings} />
						{recipe.prepTime && (
							<input type="hidden" name="prepTime" value={recipe.prepTime} />
						)}
						{recipe.cookTime && (
							<input type="hidden" name="cookTime" value={recipe.cookTime} />
						)}
						<input type="hidden" name="sourceUrl" value={recipe.sourceUrl} />
						{recipe.ingredients.map((ing, i) => (
							<div key={i}>
								<input
									type="hidden"
									name={`ingredients[${i}].name`}
									value={ing.name}
								/>
								<input
									type="hidden"
									name={`ingredients[${i}].amount`}
									value={ing.amount ?? ''}
								/>
								<input
									type="hidden"
									name={`ingredients[${i}].unit`}
									value={ing.unit ?? ''}
								/>
								<input
									type="hidden"
									name={`ingredients[${i}].notes`}
									value={ing.notes ?? ''}
								/>
							</div>
						))}
						{recipe.instructions.map((inst, i) => (
							<input
								key={i}
								type="hidden"
								name={`instructions[${i}].content`}
								value={inst.content}
							/>
						))}
						<div className="flex justify-end gap-4">
							<Button
								type="button"
								variant="outline"
								onClick={() => window.location.reload()}
							>
								Try Another URL
							</Button>
							<StatusButton
								type="submit"
								status={isSubmitting ? 'pending' : 'idle'}
								disabled={isSubmitting}
							>
								Save Recipe
							</StatusButton>
						</div>
					</Form>
				</div>
			)}
		</div>
	)
}
