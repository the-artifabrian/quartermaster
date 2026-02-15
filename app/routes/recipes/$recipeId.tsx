import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useState, useEffect, useRef } from 'react'
import {
	Form,
	Link,
	useFetcher,
	useRouteLoaderData,
	useSearchParams,
} from 'react-router'
import { InstructionWithTimers } from '#app/components/instruction-with-timers.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '#app/components/ui/tooltip.tsx'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { CookingLogSchema } from '#app/utils/cooking-log-validation.ts'
import { prisma } from '#app/utils/db.server.ts'
import { scaleAmount } from '#app/utils/fractions.ts'
import {
	subtractRecipeIngredientsFromInventory,
	previewInventorySubtraction,
} from '#app/utils/inventory-subtract.server.ts'
import { getCanonicalIngredientName } from '#app/utils/recipe-matching.server.ts'
import { cn, useDoubleCheck } from '#app/utils/misc.tsx'
import { guessCategory } from '#app/utils/shopping-list-validation.ts'
import { trackEvent } from '#app/utils/usage-tracking.server.ts'
import { type Route } from './+types/$recipeId.ts'

type SubtractionPreviewData = {
	willSubtract: Array<{
		name: string
		currentQuantity: number | null
		currentUnit: string | null
		subtractAmount: number | null
		newQuantity: number | null
		willBeRemoved: boolean
		willBeFlaggedLow: boolean
	}>
	noMatch: string[]
}

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = ({ data, matches }) => {
	const recipe = data?.recipe
	const title = recipe?.title
		? `${recipe.title} | Quartermaster`
		: 'Recipe | Quartermaster'
	const description =
		recipe?.description || `View recipe for ${recipe?.title ?? 'a dish'}`

	const rootMatch = matches.find((m) => m?.id === 'root')
	const origin = (
		rootMatch?.data as { requestInfo?: { origin?: string } } | undefined
	)?.requestInfo?.origin

	const meta: ReturnType<Route.MetaFunction> = [
		{ title },
		{ name: 'description', content: description },
		{ property: 'og:title', content: title },
		{ property: 'og:description', content: description },
		{ property: 'og:type', content: 'article' },
		{ property: 'og:site_name', content: 'Quartermaster' },
	]

	if (origin && recipe) {
		meta.push({
			property: 'og:url',
			content: `${origin}/recipes/${recipe.id}`,
		})
	}

	if (origin && recipe?.image?.objectKey) {
		const imageUrl = `${origin}/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}&w=1200&h=630&fit=cover`
		meta.push(
			{ property: 'og:image', content: imageUrl },
			{ name: 'twitter:card', content: 'summary_large_image' },
			{ name: 'twitter:image', content: imageUrl },
		)
	} else {
		meta.push({ name: 'twitter:card', content: 'summary' })
	}

	meta.push(
		{ name: 'twitter:title', content: title },
		{ name: 'twitter:description', content: description },
	)

	return meta
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const { recipeId } = params

	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		select: {
			id: true,
			title: true,
			description: true,
			servings: true,
			prepTime: true,
			cookTime: true,
			isFavorite: true,
			sourceUrl: true,
			rawText: true,
			notes: true,
			householdId: true,
			image: { select: { objectKey: true, altText: true } },
			ingredients: {
				select: {
					id: true,
					name: true,
					amount: true,
					unit: true,
					notes: true,
					isHeading: true,
				},
				orderBy: { order: 'asc' },
			},
			instructions: {
				select: {
					id: true,
					content: true,
				},
				orderBy: { order: 'asc' },
			},
			tags: {
				select: { id: true, name: true, category: true },
			},
		},
	})

	invariantResponse(recipe, 'Recipe not found', { status: 404 })
	invariantResponse(recipe.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	const cookingLogs = await prisma.cookingLog.findMany({
		where: { recipeId, userId },
		orderBy: { cookedAt: 'desc' },
		take: 10,
		select: {
			id: true,
			cookedAt: true,
			notes: true,
		},
	})

	return { recipe, cookingLogs }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const { recipeId } = params

	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		select: { id: true, title: true, householdId: true, isFavorite: true },
	})

	invariantResponse(recipe, 'Recipe not found', { status: 404 })
	invariantResponse(recipe.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'toggleFavorite') {
		await prisma.recipe.update({
			where: { id: recipeId },
			data: { isFavorite: !recipe.isFavorite },
		})
		void emitHouseholdEvent({
			type: 'recipe_favorited',
			payload: {
				recipeId,
				title: recipe.title,
				isFavorite: !recipe.isFavorite,
			},
			userId,
			householdId,
		})
		return { success: true }
	}

	if (intent === 'previewSubtraction') {
		const servingRatio = parseFloat(String(formData.get('servingRatio') ?? '1'))
		const preview = await previewInventorySubtraction(
			recipeId,
			householdId,
			isNaN(servingRatio) || servingRatio <= 0 ? 1 : servingRatio,
		)
		if (formData.get('source') === 'whatDoINeed') {
			void trackEvent(userId, householdId, 'what_do_i_need', { recipeId })
		}
		return { success: true, preview }
	}

	if (intent === 'logCook') {
		const submission = parseWithZod(formData, { schema: CookingLogSchema })
		if (submission.status !== 'success') {
			return { success: false }
		}

		await prisma.cookingLog.create({
			data: {
				recipeId,
				userId,
				cookedAt: submission.value.cookedAt ?? new Date(),
				notes: submission.value.notes || null,
			},
		})

		void emitHouseholdEvent({
			type: 'cook_logged',
			payload: { recipeId, title: recipe.title },
			userId,
			householdId,
		})

		const subtractInventory = formData.get('subtractInventory') === 'on'
		if (subtractInventory) {
			const servingRatio = parseFloat(
				String(formData.get('servingRatio') ?? '1'),
			)
			const inventorySummary = await subtractRecipeIngredientsFromInventory(
				recipeId,
				householdId,
				isNaN(servingRatio) || servingRatio <= 0 ? 1 : servingRatio,
			)
			return { success: true, inventorySummary }
		}

		return { success: true, inventorySummary: null }
	}

	if (intent === 'deleteCookLog') {
		const logId = formData.get('logId')
		invariantResponse(typeof logId === 'string', 'Log ID is required')

		const log = await prisma.cookingLog.findFirst({
			where: { id: logId, userId, recipeId },
		})
		invariantResponse(log, 'Log not found', { status: 404 })

		await prisma.cookingLog.delete({ where: { id: logId } })
		return { success: true }
	}

	if (intent === 'add-to-shopping-list') {
		const servingRatio = parseFloat(
			String(formData.get('servingRatio') ?? '1'),
		)
		const safeRatio =
			isNaN(servingRatio) || servingRatio <= 0 ? 1 : servingRatio

		// Re-run preview to get missing items
		const preview = await previewInventorySubtraction(
			recipeId,
			householdId,
			safeRatio,
		)

		// Build items to add from noMatch + deficit items
		const fullRecipe = await prisma.recipe.findUnique({
			where: { id: recipeId },
			include: { ingredients: true },
		})
		invariantResponse(fullRecipe, 'Recipe not found')

		const shoppingItems: Array<{
			name: string
			quantity: string | null
			unit: string | null
		}> = []

		// Items not in inventory at all
		for (const ingredientName of preview.noMatch) {
			const ingredient = fullRecipe.ingredients.find(
				(i) =>
					!i.isHeading &&
					i.name.toLowerCase() === ingredientName.toLowerCase(),
			)
			if (ingredient) {
				const amount = ingredient.amount
					? scaleAmount(ingredient.amount, safeRatio)
					: null
				shoppingItems.push({
					name: ingredient.name,
					quantity: amount,
					unit: ingredient.unit,
				})
			} else {
				shoppingItems.push({
					name: ingredientName,
					quantity: null,
					unit: null,
				})
			}
		}

		// Items with insufficient inventory (deficit)
		for (const item of preview.willSubtract) {
			if (
				item.subtractAmount !== null &&
				item.currentQuantity !== null &&
				item.subtractAmount > item.currentQuantity
			) {
				const deficit = item.subtractAmount - item.currentQuantity
				shoppingItems.push({
					name: item.name,
					quantity: formatQuantity(deficit),
					unit: item.currentUnit,
				})
			}
		}

		if (shoppingItems.length === 0) {
			return { success: true, addedToShoppingList: 0 }
		}

		// Get or create shopping list
		let shoppingList = await prisma.shoppingList.findFirst({
			where: { householdId },
			include: { items: { where: { checked: false } } },
		})
		if (!shoppingList) {
			shoppingList = await prisma.shoppingList.create({
				data: { userId, householdId },
				include: { items: { where: { checked: false } } },
			})
		}

		// Deduplicate by canonical name
		const existingCanonical = new Set(
			shoppingList.items.map((item) =>
				getCanonicalIngredientName(item.name),
			),
		)

		const newItems = shoppingItems.filter(
			(item) =>
				!existingCanonical.has(getCanonicalIngredientName(item.name)),
		)

		if (newItems.length > 0) {
			await prisma.shoppingListItem.createMany({
				data: newItems.map((item) => ({
					name: item.name,
					quantity: item.quantity,
					unit: item.unit,
					category: guessCategory(item.name),
					source: 'recipe',
					listId: shoppingList.id,
				})),
			})
		}

		void emitHouseholdEvent({
			type: 'shopping_list_item_added',
			payload: { name: recipe.title, source: 'recipe' },
			userId,
			householdId,
		})

		return { success: true, addedToShoppingList: newItems.length }
	}

	return { success: false }
}

// --- Utility functions ---

function toIsoDuration(minutes: number | null | undefined): string | undefined {
	if (!minutes) return undefined
	const h = Math.floor(minutes / 60)
	const m = minutes % 60
	return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}`
}

function getRecipeJsonLd(
	recipe: {
		title: string
		description: string | null
		servings: number
		prepTime: number | null
		cookTime: number | null
		image: { objectKey: string; altText: string | null } | null
		ingredients: Array<{
			name: string
			amount: string | null
			unit: string | null
			isHeading?: boolean
		}>
		instructions: Array<{ content: string }>
		tags: Array<{ name: string; category: string }>
	},
	origin: string | undefined,
) {
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)

	const jsonLd: Record<string, unknown> = {
		'@context': 'https://schema.org',
		'@type': 'Recipe',
		name: recipe.title,
		...(recipe.description && { description: recipe.description }),
		...(recipe.servings && { recipeYield: `${recipe.servings} servings` }),
		...(recipe.prepTime && { prepTime: toIsoDuration(recipe.prepTime) }),
		...(recipe.cookTime && { cookTime: toIsoDuration(recipe.cookTime) }),
		...(totalTime > 0 && { totalTime: toIsoDuration(totalTime) }),
		recipeIngredient: recipe.ingredients
			.filter((i) => !i.isHeading)
			.map((i) => [i.amount, i.unit, i.name].filter(Boolean).join(' ')),
		recipeInstructions: recipe.instructions.map((step, idx) => ({
			'@type': 'HowToStep',
			position: idx + 1,
			text: step.content,
		})),
	}

	const mealTypes = recipe.tags
		.filter((t) => t.category === 'meal-type')
		.map((t) => t.name)
	if (mealTypes.length > 0) jsonLd.recipeCategory = mealTypes

	const cuisines = recipe.tags
		.filter((t) => t.category === 'cuisine')
		.map((t) => t.name)
	if (cuisines.length > 0) jsonLd.recipeCuisine = cuisines

	if (origin && recipe.image?.objectKey) {
		jsonLd.image = `${origin}/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}&w=1200&h=630&fit=cover`
	}

	return jsonLd
}

// --- Main component ---

export default function RecipeDetail({ loaderData }: Route.ComponentProps) {
	const { recipe, cookingLogs } = loaderData
	const rootData = useRouteLoaderData('root') as
		| { requestInfo?: { origin?: string } }
		| undefined
	const origin = rootData?.requestInfo?.origin
	const recipeJsonLd = getRecipeJsonLd(recipe, origin)
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)
	const [searchParams, setSearchParams] = useSearchParams()
	const favoriteFetcher = useFetcher()
	const isFavorite =
		favoriteFetcher.formData?.get('intent') === 'toggleFavorite'
			? !recipe.isFavorite
			: recipe.isFavorite
	const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(
		() => new Set(),
	)
	const [checkedSteps, setCheckedSteps] = useState<Set<string>>(() => new Set())
	const cookFetcher = useFetcher({ key: 'log-cook' })
	const previewFetcher = useFetcher({ key: 'preview-subtraction' })
	const needFetcher = useFetcher({ key: 'what-do-i-need' })
	const prevCookFetcherState = useRef(cookFetcher.state)
	const [showIMadeThisModal, setShowIMadeThisModal] = useState(false)
	const [showNeedModal, setShowNeedModal] = useState(false)
	const [historyExpanded, setHistoryExpanded] = useState(false)

	const servingsParam = searchParams.get('servings')
	const currentServings = servingsParam
		? Math.min(999, Math.max(1, parseInt(servingsParam, 10) || recipe.servings))
		: recipe.servings
	const ratio = currentServings / recipe.servings
	const isScaled = currentServings !== recipe.servings

	// Close modal after successful cook log submission
	useEffect(() => {
		if (
			prevCookFetcherState.current !== 'idle' &&
			cookFetcher.state === 'idle' &&
			cookFetcher.data?.success
		) {
			setShowIMadeThisModal(false)

			const summary = cookFetcher.data.inventorySummary
			if (summary) {
				const parts: string[] = []
				if (summary.removed.length > 0) {
					parts.push(`Removed ${summary.removed.join(', ')}.`)
				}
				if (summary.updated.length > 0) {
					parts.push(`Updated ${summary.updated.join(', ')}.`)
				}
				if (summary.flaggedLow.length > 0) {
					parts.push(`${summary.flaggedLow.join(', ')} marked low.`)
				}
				toast.success('Inventory updated', {
					description:
						parts.length > 0
							? parts.join(' ')
							: 'No matching inventory items found.',
				})
			} else {
				toast.success('Cook logged!')
			}
		}
		prevCookFetcherState.current = cookFetcher.state
	}, [cookFetcher.state, cookFetcher.data])

	function updateServings(newServings: number) {
		const clamped = Math.min(999, Math.max(1, newServings))
		setSearchParams(
			(prev) => {
				if (clamped === recipe.servings) {
					prev.delete('servings')
				} else {
					prev.set('servings', clamped.toString())
				}
				return prev
			},
			{ replace: true },
		)
	}

	function toggleIngredient(id: string) {
		setCheckedIngredients((prev) => {
			const next = new Set(prev)
			if (next.has(id)) {
				next.delete(id)
			} else {
				next.add(id)
			}
			return next
		})
	}

	function toggleStep(id: string) {
		setCheckedSteps((prev) => {
			const next = new Set(prev)
			if (next.has(id)) {
				next.delete(id)
			} else {
				next.add(id)
			}
			return next
		})
	}

	function handleIMadeThis() {
		setShowIMadeThisModal(true)
		// Fire preview fetch
		const formData = new FormData()
		formData.set('intent', 'previewSubtraction')
		formData.set('servingRatio', ratio.toString())
		void previewFetcher.submit(formData, { method: 'POST' })
	}

	function handleWhatDoINeed() {
		setShowNeedModal(true)
		const formData = new FormData()
		formData.set('intent', 'previewSubtraction')
		formData.set('servingRatio', ratio.toString())
		formData.set('source', 'whatDoINeed')
		void needFetcher.submit(formData, { method: 'POST' })
	}

	async function handleShare() {
		const url = `${origin ?? window.location.origin}/share/${recipe.id}`
		try {
			await navigator.clipboard.writeText(url)
			toast.success('Link copied to clipboard')
		} catch {
			toast.error('Unable to copy — try copying the URL manually')
		}
	}

	return (
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(recipeJsonLd).replace(/</g, '\\u003c'),
				}}
			/>

			{/* Header */}
			<div className="container max-w-4xl px-4 pt-4 md:px-8 md:pt-6">
				<Link
					to="/recipes"
					className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm md:mb-3 print:hidden"
				>
					<Icon name="arrow-left" size="sm" />
					Recipes
				</Link>
				<h1 className="font-serif text-3xl font-bold tracking-tight md:text-4xl">
					{recipe.title}
				</h1>
			</div>

			{/* Meta card + content */}
			<div className="container max-w-4xl px-4 md:px-8">
				{(recipe.prepTime ||
					recipe.cookTime ||
					recipe.sourceUrl ||
					recipe.tags.length > 0) && (
					<div className="bg-card shadow-warm-lg mt-4 rounded-2xl border p-3 md:p-5 print:border-0 print:p-2 print:shadow-none">
						<div className="flex flex-wrap items-center gap-3 text-sm">
							{recipe.prepTime && (
								<span className="text-muted-foreground flex items-center gap-1">
									<Icon name="clock" size="sm" className="text-accent" />
									Prep: {recipe.prepTime} min
								</span>
							)}
							{recipe.cookTime && (
								<>
									{recipe.prepTime && (
										<span className="text-border hidden md:inline">|</span>
									)}
									<span className="text-muted-foreground flex items-center gap-1">
										<Icon name="clock" size="sm" className="text-accent" />
										Cook: {recipe.cookTime} min
									</span>
								</>
							)}
							{totalTime > 0 && (
								<>
									<span className="text-border hidden md:inline">|</span>
									<span className="text-foreground font-medium">
										Total: {totalTime} min
									</span>
								</>
							)}

							{/* Source URL inline */}
							{recipe.sourceUrl && (
								<>
									{(recipe.prepTime || recipe.cookTime) && (
										<span className="text-border hidden md:inline">|</span>
									)}
									<a
										href={recipe.sourceUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline"
									>
										<Icon name="link-2" size="sm" />
										{(() => {
											try {
												return new URL(recipe.sourceUrl).hostname.replace(
													/^www\./,
													'',
												)
											} catch {
												return 'Source'
											}
										})()}
									</a>
								</>
							)}
						</div>

						{/* Tags inside meta card */}
						{recipe.tags.length > 0 && (
							<div className="mt-3 flex flex-wrap gap-1.5">
								{recipe.tags.map((tag) => (
									<span
										key={tag.id}
										className="bg-accent/10 border-accent/20 rounded-full border px-2.5 py-0.5 text-xs font-medium"
									>
										{tag.name}
									</span>
								))}
							</div>
						)}
					</div>
				)}

				{/* Description */}
				{recipe.description && (
					<p className="text-muted-foreground mt-6 text-lg">
						{recipe.description}
					</p>
				)}

				{/* My Notes - promoted above content */}
				{recipe.notes && (
					<div className="mt-6">
						<div className="border-accent/30 bg-accent/5 rounded-lg border-l-4 py-3 pr-4 pl-4">
							<p className="text-accent mb-1 text-xs font-semibold tracking-wide uppercase">
								My Notes
							</p>
							<pre className="font-sans text-sm whitespace-pre-wrap">
								{recipe.notes}
							</pre>
						</div>
					</div>
				)}

				{/* Raw Text */}
				{recipe.rawText && (
					<div className="mt-6 print:hidden">
						<div className="bg-card shadow-warm rounded-2xl border p-4">
							<p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
								Recipe Notes
							</p>
							<pre className="font-sans text-sm whitespace-pre-wrap">
								{recipe.rawText}
							</pre>
						</div>
					</div>
				)}

				{/* Action bar - inline on desktop */}
				<div className="mt-6 hidden items-center gap-2 md:flex print:hidden">
					<Button
						onClick={handleIMadeThis}
						className="gap-2 bg-green-600 hover:bg-green-700"
					>
						<Icon name="check" size="sm" />I Made This
					</Button>
					<favoriteFetcher.Form method="POST">
						<input type="hidden" name="intent" value="toggleFavorite" />
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="submit"
									variant="ghost"
									size="icon"
									className={
										isFavorite ? 'text-red-500 hover:text-red-600' : ''
									}
								>
									<Icon
										name={isFavorite ? 'heart-filled' : 'heart'}
										size="md"
									/>
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								{isFavorite ? 'Remove from favorites' : 'Add to favorites'}
							</TooltipContent>
						</Tooltip>
					</favoriteFetcher.Form>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button asChild variant="ghost" size="icon">
								<Link to={`/recipes/${recipe.id}/edit`}>
									<Icon name="pencil-1" size="md" />
								</Link>
							</Button>
						</TooltipTrigger>
						<TooltipContent>Edit recipe</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => window.print()}
							>
								<Icon name="file-text" size="md" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Print recipe</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon" onClick={handleShare}>
								<Icon name="share" size="md" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Share recipe</TooltipContent>
					</Tooltip>
				</div>

				{/* Content zone: Ingredients + Instructions */}
				<div className="mt-5 grid gap-5 md:mt-8 md:grid-cols-[2fr_3fr] md:gap-8 print:grid-cols-1 print:gap-4">
					{/* Ingredients - sticky on desktop, interactive checkboxes */}
					<div className="md:sticky md:top-20 md:self-start print:static">
						<div className="bg-card shadow-warm rounded-2xl border p-4 md:p-6 print:border-0 print:p-2 print:shadow-none">
							<div className="mb-3 flex items-center gap-2 md:mb-4">
								<h2 className="text-lg font-semibold">Ingredients</h2>
								<span className="ml-auto flex items-center gap-1 print:hidden">
									<Button
										variant="outline"
										size="sm"
										className="h-8 w-8 p-0 text-xs"
										onClick={() => updateServings(currentServings - 1)}
										disabled={currentServings <= 1}
									>
										-
									</Button>
									<span className="min-w-[3ch] text-center text-sm font-medium">
										{currentServings}
									</span>
									<Button
										variant="outline"
										size="sm"
										className="h-8 w-8 p-0 text-xs"
										onClick={() => updateServings(currentServings + 1)}
									>
										+
									</Button>
									{isScaled ? (
										<button
											onClick={() => updateServings(recipe.servings)}
											className="text-primary text-xs hover:underline"
										>
											Reset
										</button>
									) : (
										<span className="text-muted-foreground text-sm">
											servings
										</span>
									)}
								</span>
							</div>
							<IngredientList
								ingredients={recipe.ingredients}
								checkedIngredients={checkedIngredients}
								onToggle={toggleIngredient}
								ratio={ratio}
							/>
							<Button
								variant="ghost"
								size="sm"
								className="mt-3 w-full gap-1.5 text-xs print:hidden"
								onClick={handleWhatDoINeed}
							>
								<Icon name="magnifying-glass" size="sm" />
								What do I need?
							</Button>
						</div>
					</div>

					{/* Instructions - interactive crossable steps */}
					<div>
						<h2 className="mb-4 text-lg font-semibold">Instructions</h2>
						<ol className="space-y-4">
							{recipe.instructions.map((instruction, index) => {
								const isChecked = checkedSteps.has(instruction.id)
								return (
									<li
										key={instruction.id}
										role="checkbox"
										aria-checked={isChecked}
										tabIndex={0}
										className={cn(
											'flex cursor-pointer gap-4 rounded-lg px-3 py-3 transition-all select-none',
											'hover:bg-muted/50',
										)}
										onClick={() => toggleStep(instruction.id)}
										onKeyDown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault()
												toggleStep(instruction.id)
											}
										}}
									>
										<span
											className={cn(
												'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors',
												isChecked
													? 'bg-primary/20 text-primary'
													: 'bg-accent/10 text-accent border-accent/20 border',
											)}
										>
											{isChecked ? <Icon name="check" size="sm" /> : index + 1}
										</span>
										<p
											className={cn(
												'pt-1 text-base transition-colors',
												isChecked && 'text-muted-foreground/50 line-through',
											)}
										>
											<InstructionWithTimers
												content={instruction.content}
												stepNumber={index + 1}
												recipeName={recipe.title}
											/>
										</p>
									</li>
								)
							})}
						</ol>
					</div>
				</div>

				{/* Cooking History - collapsible */}
				{cookingLogs.length > 0 ? (
					<div className="mt-10 print:hidden">
						<button
							onClick={() => setHistoryExpanded((v) => !v)}
							className="hover:text-foreground mb-4 flex w-full items-center gap-2 text-left text-lg font-semibold"
						>
							<Icon
								name="chevron-down"
								size="sm"
								className={cn(
									'transition-transform',
									!historyExpanded && '-rotate-90',
								)}
							/>
							Cooking History ({cookingLogs.length})
						</button>
						{historyExpanded && (
							<div className="space-y-3">
								{cookingLogs.map((log) => (
									<CookingLogEntry key={log.id} log={log} />
								))}
							</div>
						)}
					</div>
				) : (
					<div className="mt-10 print:hidden">
						<p className="text-muted-foreground text-sm italic">
							You haven't cooked this yet. Give it a try!
						</p>
					</div>
				)}

				{/* Bottom spacer for mobile floating bar */}
				<div className="h-24 md:hidden print:hidden" />
			</div>

			{/* Floating action bar - mobile only */}
			<div className="fixed inset-x-4 bottom-16 z-30 md:hidden print:hidden">
				<div className="bg-card/95 shadow-warm-lg flex items-center gap-1.5 rounded-2xl border p-2.5 backdrop-blur-md">
					<Button
						onClick={handleIMadeThis}
						className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
					>
						<Icon name="check" size="sm" />I Made This
					</Button>
					<favoriteFetcher.Form method="POST">
						<input type="hidden" name="intent" value="toggleFavorite" />
						<Button
							type="submit"
							variant="ghost"
							size="icon"
							aria-label={
								isFavorite ? 'Remove from favorites' : 'Add to favorites'
							}
							className={isFavorite ? 'text-red-500 hover:text-red-600' : ''}
						>
							<Icon name={isFavorite ? 'heart-filled' : 'heart'} size="md" />
						</Button>
					</favoriteFetcher.Form>
					<Button asChild variant="ghost" size="icon" aria-label="Edit recipe">
						<Link to={`/recipes/${recipe.id}/edit`}>
							<Icon name="pencil-1" size="md" />
						</Link>
					</Button>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Print recipe"
						onClick={() => window.print()}
					>
						<Icon name="file-text" size="md" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Share recipe"
						onClick={handleShare}
					>
						<Icon name="share" size="md" />
					</Button>
				</div>
			</div>

			{/* "I Made This" modal */}
			{showIMadeThisModal && (
				<IMadeThisModal
					ratio={ratio}
					cookFetcher={cookFetcher}
					previewFetcher={previewFetcher}
					onClose={() => setShowIMadeThisModal(false)}
				/>
			)}

			{/* "What Do I Need?" modal */}
			{showNeedModal && (
				<WhatDoINeedModal
					recipe={recipe}
					ratio={ratio}
					needFetcher={needFetcher}
					onClose={() => setShowNeedModal(false)}
				/>
			)}
		</>
	)
}

// --- "I Made This" modal ---

function IMadeThisModal({
	ratio,
	cookFetcher,
	previewFetcher,
	onClose,
}: {
	ratio: number
	cookFetcher: ReturnType<typeof useFetcher>
	previewFetcher: ReturnType<typeof useFetcher>
	onClose: () => void
}) {
	useEffect(() => {
		function handleEscape(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', handleEscape)
		return () => document.removeEventListener('keydown', handleEscape)
	}, [onClose])

	const previewData = previewFetcher.data as
		| { preview?: SubtractionPreviewData }
		| undefined
	const preview = previewData?.preview
	const isLoadingPreview = previewFetcher.state !== 'idle'
	const hasInventoryImpact = preview && preview.willSubtract.length > 0

	return (
		<div
			className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
			role="dialog"
			aria-modal="true"
			aria-labelledby="i-made-this-title"
		>
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
			/>
			{/* Modal */}
			<div className="bg-card shadow-warm-lg relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-6 sm:rounded-2xl">
				<div className="mb-1 flex items-center justify-between">
					<h2 id="i-made-this-title" className="font-serif text-xl font-bold">
						I Made This
					</h2>
					<button
						onClick={onClose}
						aria-label="Close"
						className="text-muted-foreground hover:text-foreground rounded-md p-1"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>
				<p className="text-muted-foreground mb-4 text-sm">
					Log this cook and update your inventory.
				</p>
				<cookFetcher.Form method="POST" className="space-y-4">
					<input type="hidden" name="intent" value="logCook" />
					<input type="hidden" name="servingRatio" value={ratio} />
					<div>
						<label
							htmlFor="cookedAt"
							className="text-muted-foreground mb-1 block text-sm"
						>
							Date
						</label>
						<input
							type="date"
							id="cookedAt"
							name="cookedAt"
							defaultValue={format(new Date(), 'yyyy-MM-dd')}
							className="border-input bg-background rounded-md border px-3 py-1.5 text-base md:text-sm"
						/>
					</div>
					<div>
						<label
							htmlFor="cookNotes"
							className="text-muted-foreground mb-1 block text-sm"
						>
							Notes (optional)
						</label>
						<textarea
							id="cookNotes"
							name="notes"
							rows={2}
							placeholder="How did it turn out? Any adjustments?"
							className="border-input bg-background w-full rounded-md border px-3 py-2 text-base md:text-sm"
						/>
					</div>

					{/* Inventory impact preview */}
					<div className="rounded-lg border p-3">
						<h3 className="mb-2 text-sm font-semibold">Inventory Impact</h3>
						{isLoadingPreview ? (
							<p className="text-muted-foreground text-sm">
								Checking inventory...
							</p>
						) : hasInventoryImpact ? (
							<>
								<ul className="space-y-1.5">
									{preview.willSubtract.map((item) => (
										<li
											key={item.name}
											className="flex items-center justify-between text-sm"
										>
											<span>{item.name}</span>
											<span className="text-muted-foreground text-xs">
												{item.willBeFlaggedLow ? (
													<span className="text-amber-600">
														will be flagged low
													</span>
												) : item.willBeRemoved ? (
													<span className="text-red-600">will be removed</span>
												) : (
													<>
														{formatQuantity(item.currentQuantity)}{' '}
														{item.currentUnit ?? ''} →{' '}
														{formatQuantity(item.newQuantity)}{' '}
														{item.currentUnit ?? ''}
													</>
												)}
											</span>
										</li>
									))}
								</ul>
								{preview.noMatch.length > 0 && (
									<p className="text-muted-foreground mt-2 text-xs">
										Not in inventory: {preview.noMatch.join(', ')}
									</p>
								)}
							</>
						) : preview ? (
							<p className="text-muted-foreground text-sm">
								No matching inventory items to subtract.
								{preview.noMatch.length > 0 && (
									<span className="mt-1 block text-xs">
										Not in inventory: {preview.noMatch.join(', ')}
									</span>
								)}
							</p>
						) : null}
					</div>

					<label className="flex items-center gap-2 py-1 text-sm">
						<input
							key={hasInventoryImpact ? 'has-impact' : 'no-impact'}
							type="checkbox"
							name="subtractInventory"
							defaultChecked={!!hasInventoryImpact}
							disabled={!hasInventoryImpact}
							className="size-5 rounded"
						/>
						Subtract ingredients from inventory
					</label>
					<div className="flex gap-2">
						<Button type="submit" className="flex-1">
							Confirm
						</Button>
						<Button type="button" variant="ghost" onClick={onClose}>
							Cancel
						</Button>
					</div>
				</cookFetcher.Form>
			</div>
		</div>
	)
}

// --- "What Do I Need?" modal ---

function WhatDoINeedModal({
	recipe,
	ratio,
	needFetcher,
	onClose,
}: {
	recipe: {
		ingredients: Array<{
			name: string
			amount: string | null
			unit: string | null
			isHeading: boolean
		}>
	}
	ratio: number
	needFetcher: ReturnType<typeof useFetcher>
	onClose: () => void
}) {
	const [checked, setChecked] = useState<Set<number>>(() => new Set())
	const shoppingFetcher = useFetcher()

	useEffect(() => {
		function handleEscape(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', handleEscape)
		return () => document.removeEventListener('keydown', handleEscape)
	}, [onClose])

	const data = needFetcher.data as
		| { preview?: SubtractionPreviewData }
		| undefined
	const preview = data?.preview
	const isLoading = needFetcher.state !== 'idle'

	const shoppingData = shoppingFetcher.data as
		| { addedToShoppingList?: number }
		| undefined
	const addedToList = shoppingData?.addedToShoppingList
	const isAddingToList = shoppingFetcher.state !== 'idle'

	// Build list of missing items
	const missingItems: Array<{
		name: string
		amount: string | null
		unit: string | null
	}> = []

	if (preview) {
		// Items not in inventory at all
		for (const ingredientName of preview.noMatch) {
			const ingredient = recipe.ingredients.find(
				(i) =>
					!i.isHeading && i.name.toLowerCase() === ingredientName.toLowerCase(),
			)
			if (ingredient) {
				missingItems.push({
					name: ingredient.name,
					amount: ingredient.amount
						? scaleAmount(ingredient.amount, ratio)
						: null,
					unit: ingredient.unit,
				})
			} else {
				missingItems.push({ name: ingredientName, amount: null, unit: null })
			}
		}

		// Items with insufficient inventory (deficit)
		for (const item of preview.willSubtract) {
			if (
				item.subtractAmount !== null &&
				item.currentQuantity !== null &&
				item.subtractAmount > item.currentQuantity
			) {
				const deficit = item.subtractAmount - item.currentQuantity
				missingItems.push({
					name: item.name,
					amount: formatQuantity(deficit),
					unit: item.currentUnit,
				})
			}
		}
	}

	function toggleItem(index: number) {
		setChecked((prev) => {
			const next = new Set(prev)
			if (next.has(index)) {
				next.delete(index)
			} else {
				next.add(index)
			}
			return next
		})
	}

	function handleAddToShoppingList() {
		const formData = new FormData()
		formData.set('intent', 'add-to-shopping-list')
		formData.set('servingRatio', ratio.toString())
		void shoppingFetcher.submit(formData, { method: 'POST' })
	}

	const remaining = missingItems.length - checked.size
	const allChecked = missingItems.length > 0 && remaining === 0

	return (
		<div
			className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
			role="dialog"
			aria-modal="true"
			aria-labelledby="what-do-i-need-title"
		>
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
			/>
			{/* Modal */}
			<div className="bg-card shadow-warm-lg relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-6 sm:rounded-2xl">
				<div className="mb-1 flex items-center justify-between">
					<h2
						id="what-do-i-need-title"
						className="font-serif text-xl font-bold"
					>
						What Do I Need?
					</h2>
					<button
						onClick={onClose}
						aria-label="Close"
						className="text-muted-foreground hover:text-foreground rounded-md p-1"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>

				{isLoading ? (
					<p className="text-muted-foreground py-6 text-center text-sm">
						Checking your inventory...
					</p>
				) : missingItems.length === 0 ? (
					<div className="py-6 text-center">
						<Icon name="check" className="mx-auto mb-2 size-8 text-green-600" />
						<p className="font-medium">You have everything you need!</p>
						<p className="text-muted-foreground mt-1 text-sm">
							All ingredients are in your inventory.
						</p>
					</div>
				) : allChecked ? (
					<div className="py-6 text-center">
						<Icon name="check" className="mx-auto mb-2 size-8 text-green-600" />
						<p className="font-medium">All sorted!</p>
						<p className="text-muted-foreground mt-1 text-sm">
							You've got everything checked off.
						</p>
					</div>
				) : (
					<>
						<p className="text-muted-foreground mb-3 text-sm">
							{remaining} of {missingItems.length} item
							{missingItems.length !== 1 ? 's' : ''} still needed:
						</p>
						<ul className="space-y-0.5">
							{missingItems.map((item, i) => {
								const isChecked = checked.has(i)
								return (
									<li
										key={i}
										role="checkbox"
										aria-checked={isChecked}
										tabIndex={0}
										className={cn(
											'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors select-none',
											'hover:bg-accent/5',
										)}
										onClick={() => toggleItem(i)}
										onKeyDown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault()
												toggleItem(i)
											}
										}}
									>
										<span
											className={cn(
												'flex size-5 shrink-0 items-center justify-center rounded border transition-colors',
												isChecked
													? 'border-primary bg-primary text-primary-foreground'
													: 'border-muted-foreground/25',
											)}
										>
											{isChecked && <Icon name="check" className="size-3.5" />}
										</span>
										<span
											className={cn(
												'transition-colors',
												isChecked && 'text-muted-foreground/50 line-through',
											)}
										>
											{item.amount && (
												<span className="font-medium">{item.amount} </span>
											)}
											{item.unit && <span>{item.unit} </span>}
											{item.name}
										</span>
									</li>
								)
							})}
						</ul>

						{/* Add to Shopping List */}
						<div className="mt-4 border-t pt-3">
							{addedToList !== undefined ? (
								<div className="text-center">
									<p className="text-sm text-green-600">
										<Icon name="check" className="mr-1 inline size-4" />
										Added {addedToList} item
										{addedToList !== 1 ? 's' : ''} to shopping list
									</p>
									<Link
										to="/shopping"
										className="text-primary mt-2 inline-flex items-center gap-1 text-sm font-medium hover:underline"
									>
										View Shopping List
										<Icon name="arrow-right" size="sm" />
									</Link>
								</div>
							) : (
								<Button
									variant="outline"
									className="w-full gap-1.5"
									onClick={handleAddToShoppingList}
									disabled={isAddingToList}
								>
									<Icon name="plus" size="sm" />
									{isAddingToList
										? 'Adding...'
										: `Add ${missingItems.length} to Shopping List`}
								</Button>
							)}
						</div>
					</>
				)}
			</div>
		</div>
	)
}

// --- Ingredient list with heading support ---

function IngredientList({
	ingredients,
	checkedIngredients,
	onToggle,
	ratio,
}: {
	ingredients: Array<{
		id: string
		name: string
		amount: string | null
		unit: string | null
		notes: string | null
		isHeading: boolean
	}>
	checkedIngredients: Set<string>
	onToggle: (id: string) => void
	ratio: number
}) {
	return (
		<ul className="space-y-1">
			{ingredients.map((ingredient) => {
				if (ingredient.isHeading) {
					return (
						<li key={ingredient.id}>
							<p className="text-muted-foreground mt-3 mb-1 px-2 text-sm font-semibold tracking-wide first:mt-0">
								{ingredient.name}
							</p>
						</li>
					)
				}

				const isChecked = checkedIngredients.has(ingredient.id)
				return (
					<li
						key={ingredient.id}
						role="checkbox"
						aria-checked={isChecked}
						tabIndex={0}
						className="hover:bg-accent/5 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors select-none"
						onClick={() => onToggle(ingredient.id)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault()
								onToggle(ingredient.id)
							}
						}}
					>
						<span
							className={cn(
								'flex size-5 shrink-0 items-center justify-center rounded border transition-colors',
								isChecked
									? 'border-primary bg-primary text-primary-foreground'
									: 'border-muted-foreground/25',
							)}
						>
							{isChecked && <Icon name="check" className="size-3.5" />}
						</span>
						<span
							className={cn(
								'transition-colors',
								isChecked && 'text-muted-foreground/50 line-through',
							)}
						>
							{ingredient.amount && (
								<span className="font-medium">
									{scaleAmount(ingredient.amount, ratio)}{' '}
								</span>
							)}
							{ingredient.unit && <span>{ingredient.unit} </span>}
							<span>{ingredient.name}</span>
							{ingredient.notes && (
								<span className={isChecked ? '' : 'text-muted-foreground'}>
									, {ingredient.notes}
								</span>
							)}
						</span>
					</li>
				)
			})}
		</ul>
	)
}

function formatQuantity(q: number | null): string {
	if (q === null) return '?'
	return Number.isInteger(q) ? q.toString() : q.toFixed(1)
}

// --- Cooking log entry ---

function CookingLogEntry({
	log,
}: {
	log: {
		id: string
		cookedAt: Date
		notes: string | null
	}
}) {
	const dc = useDoubleCheck()

	return (
		<div className="bg-card shadow-warm flex items-start gap-3 rounded-2xl border p-4">
			<div className="min-w-0 flex-1">
				<span className="text-sm font-medium">
					{format(new Date(log.cookedAt), 'MMM d, yyyy')}
				</span>
				{log.notes && (
					<p className="text-muted-foreground mt-1 text-sm">{log.notes}</p>
				)}
			</div>
			<Form method="POST">
				<input type="hidden" name="intent" value="deleteCookLog" />
				<input type="hidden" name="logId" value={log.id} />
				<StatusButton
					{...dc.getButtonProps({
						type: 'submit',
					})}
					size="sm"
					variant={dc.doubleCheck ? 'destructive' : 'ghost'}
					status="idle"
				>
					<Icon name="trash" size="sm">
						{dc.doubleCheck ? 'Sure?' : ''}
					</Icon>
				</StatusButton>
			</Form>
		</div>
	)
}
