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
import { EnhanceRecipeModal } from '#app/components/enhance-recipe-modal.tsx'
import { SubstitutionHint } from '#app/components/ingredient-substitution.tsx'
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
import { type EnhanceableFields } from '#app/utils/recipe-enhance-llm.server.ts'
import { getUserTier } from '#app/utils/subscription.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { CookingLogSchema } from '#app/utils/cooking-log-validation.ts'
import { prisma } from '#app/utils/db.server.ts'
import { scaleAmount } from '#app/utils/fractions.ts'
import {
	subtractRecipeIngredientsFromInventory,
	previewInventorySubtraction,
} from '#app/utils/inventory-subtract.server.ts'
import {
	buildInventoryLookup,
	getCanonicalIngredientName,
	ingredientMatchesAnyInventoryItem,
	isStapleIngredient,
} from '#app/utils/recipe-matching.server.ts'
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
			isAiGenerated: true,
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

	const [cookingLogs, tierInfo, inventoryItems] = await Promise.all([
		prisma.cookingLog.findMany({
			where: { recipeId, userId },
			orderBy: { cookedAt: 'desc' },
			take: 10,
			select: {
				id: true,
				cookedAt: true,
				notes: true,
			},
		}),
		getUserTier(userId),
		prisma.inventoryItem.findMany({
			where: { householdId },
			select: { name: true },
		}),
	])

	const missingIngredientIds: string[] = []
	const lookup = buildInventoryLookup(inventoryItems)
	for (const ingredient of recipe.ingredients) {
		if (ingredient.isHeading) continue
		if (isStapleIngredient(ingredient)) continue
		if (!ingredientMatchesAnyInventoryItem(ingredient, lookup)) {
			missingIngredientIds.push(ingredient.id)
		}
	}

	return {
		recipe,
		cookingLogs,
		isProActive: tierInfo.isProActive,
		missingIngredientIds,
	}
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

	const { isProActive } = await getUserTier(userId)

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
		if (!isProActive) return { success: false, requiresPro: true }
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

		const subtractInventory =
			isProActive && formData.get('subtractInventory') === 'on'
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

	if (intent === 'applyEnhancement') {
		if (!isProActive) return { success: false, requiresPro: true }

		const updateData: Record<string, string | number> = {}

		const description = formData.get('enhance_description')
		if (typeof description === 'string' && description) {
			updateData.description = description
		}
		const servings = formData.get('enhance_servings')
		if (typeof servings === 'string' && servings) {
			updateData.servings = parseInt(servings, 10)
		}
		const prepTime = formData.get('enhance_prepTime')
		if (typeof prepTime === 'string' && prepTime) {
			updateData.prepTime = parseInt(prepTime, 10)
		}
		const cookTime = formData.get('enhance_cookTime')
		if (typeof cookTime === 'string' && cookTime) {
			updateData.cookTime = parseInt(cookTime, 10)
		}

		// Collect tag names from enhance_tag_0, enhance_tag_1, ...
		const tagNames: string[] = []
		for (let i = 0; i < 16; i++) {
			const tag = formData.get(`enhance_tag_${i}`)
			if (typeof tag === 'string' && tag) {
				tagNames.push(tag)
			} else {
				break
			}
		}

		// Resolve tags to IDs and connect (additive)
		let tagConnect: Array<{ id: string }> = []
		if (tagNames.length > 0) {
			const tags = await prisma.tag.findMany({
				where: { name: { in: tagNames } },
				select: { id: true },
			})
			tagConnect = tags.map((t) => ({ id: t.id }))
		}

		await prisma.recipe.update({
			where: { id: recipeId },
			data: {
				...updateData,
				...(tagConnect.length > 0 && {
					tags: { connect: tagConnect },
				}),
			},
		})

		void emitHouseholdEvent({
			type: 'recipe_updated',
			payload: { recipeId, title: recipe.title },
			userId,
			householdId,
		})

		trackEvent(userId, householdId, 'recipe_enhance_applied', {
			recipeId,
			fields: Object.keys(updateData),
			tagCount: tagConnect.length,
		})

		return { success: true }
	}

	if (intent === 'add-to-shopping-list') {
		const servingRatio = parseFloat(String(formData.get('servingRatio') ?? '1'))
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
					!i.isHeading && i.name.toLowerCase() === ingredientName.toLowerCase(),
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
			shoppingList.items.map((item) => getCanonicalIngredientName(item.name)),
		)

		const newItems = shoppingItems.filter(
			(item) => !existingCanonical.has(getCanonicalIngredientName(item.name)),
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
	const { recipe, cookingLogs, isProActive, missingIngredientIds } = loaderData
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
	const shoppingFetcher = useFetcher({ key: 'add-to-shopping' })
	const prevCookFetcherState = useRef(cookFetcher.state)
	const [showIMadeThisModal, setShowIMadeThisModal] = useState(false)
	const [historyExpanded, setHistoryExpanded] = useState(false)
	const [substitutions, setSubstitutions] = useState<
		Map<string, AppliedSubstitution>
	>(() => new Map())
	const enhanceFetcher = useFetcher<{
		error: string | null
		suggestions: EnhanceableFields | null
	}>({ key: 'enhance-recipe' })
	const [showEnhanceModal, setShowEnhanceModal] = useState(false)
	const prevEnhanceFetcherState = useRef(enhanceFetcher.state)

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

	// Open enhance modal or show error when enhance fetch completes
	useEffect(() => {
		if (
			prevEnhanceFetcherState.current !== 'idle' &&
			enhanceFetcher.state === 'idle' &&
			enhanceFetcher.data
		) {
			if (enhanceFetcher.data.suggestions) {
				setShowEnhanceModal(true)
			} else if (enhanceFetcher.data.error) {
				toast.error(enhanceFetcher.data.error)
			}
		}
		prevEnhanceFetcherState.current = enhanceFetcher.state
	}, [enhanceFetcher.state, enhanceFetcher.data])

	function handleEnhance() {
		const formData = new FormData()
		formData.set('recipeId', recipe.id)
		enhanceFetcher.submit(formData, {
			method: 'POST',
			action: '/resources/enhance-recipe',
		})
	}

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
		// Fire preview fetch (Pro only — free users just log the cook)
		if (isProActive) {
			const formData = new FormData()
			formData.set('intent', 'previewSubtraction')
			formData.set('servingRatio', ratio.toString())
			void previewFetcher.submit(formData, { method: 'POST' })
		}
	}

	function applySubstitution(
		ingredientId: string,
		originalName: string,
		replacement: string,
	) {
		setSubstitutions((prev) => {
			const next = new Map(prev)
			next.set(ingredientId, {
				originalName,
				replacementShort: extractPrimaryIngredient(replacement),
			})
			return next
		})
	}

	function revertSubstitution(ingredientId: string) {
		setSubstitutions((prev) => {
			const next = new Map(prev)
			next.delete(ingredientId)
			return next
		})
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
				{recipe.isAiGenerated && (
					<span className="mt-2 inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
						<Icon name="sparkles" className="size-3" />
						AI Generated
					</span>
				)}
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
									aria-label={
										isFavorite ? 'Remove from favorites' : 'Add to favorites'
									}
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
							<Button
								asChild
								variant="ghost"
								size="icon"
								aria-label="Edit recipe"
							>
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
								aria-label="Print recipe"
								onClick={() => window.print()}
							>
								<Icon name="file-text" size="md" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Print recipe</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								aria-label="Share recipe"
								onClick={handleShare}
							>
								<Icon name="share" size="md" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Share recipe</TooltipContent>
					</Tooltip>
					{isProActive && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									aria-label="Enhance with AI"
									onClick={handleEnhance}
									disabled={enhanceFetcher.state !== 'idle'}
									className="text-violet-500 hover:text-violet-600"
								>
									{enhanceFetcher.state !== 'idle' ? (
										<Icon
											name="update"
											className="size-5 animate-spin"
										/>
									) : (
										<Icon name="sparkles" size="md" />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent>Enhance with AI</TooltipContent>
						</Tooltip>
					)}
				</div>

				{/* Content zone: Ingredients + Instructions */}
				<div className="mt-5 grid gap-5 md:mt-8 md:grid-cols-[5fr_7fr] md:gap-8 print:grid-cols-1 print:gap-4">
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
								missingIngredientIds={missingIngredientIds}
								isProActive={isProActive}
								recipeId={recipe.id}
								substitutions={substitutions}
								onApplySubstitution={applySubstitution}
								onRevertSubstitution={revertSubstitution}
								shoppingFetcher={shoppingFetcher}
							/>
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
												content={
													substitutions.size > 0
														? applySubstitutionsToText(
																instruction.content,
																substitutions,
															)
														: instruction.content
												}
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
			<div className="fixed inset-x-4 bottom-18 z-30 md:hidden print:hidden">
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
					{isProActive && (
						<Button
							variant="ghost"
							size="icon"
							aria-label="Enhance with AI"
							onClick={handleEnhance}
							disabled={enhanceFetcher.state !== 'idle'}
							className="text-violet-500 hover:text-violet-600"
						>
							{enhanceFetcher.state !== 'idle' ? (
								<Icon
									name="update"
									className="size-5 animate-spin"
								/>
							) : (
								<Icon name="sparkles" size="md" />
							)}
						</Button>
					)}
				</div>
			</div>

			{/* "I Made This" modal */}
			{showIMadeThisModal && (
				<IMadeThisModal
					ratio={ratio}
					cookFetcher={cookFetcher}
					previewFetcher={previewFetcher}
					onClose={() => setShowIMadeThisModal(false)}
					isProActive={isProActive}
				/>
			)}

			{showEnhanceModal && enhanceFetcher.data?.suggestions && (
				<EnhanceRecipeModal
					recipe={recipe}
					suggestions={enhanceFetcher.data.suggestions}
					onClose={() => setShowEnhanceModal(false)}
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
	isProActive,
}: {
	ratio: number
	cookFetcher: ReturnType<typeof useFetcher>
	previewFetcher: ReturnType<typeof useFetcher>
	onClose: () => void
	isProActive: boolean
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
			className="fixed inset-0 z-60 flex items-end justify-center sm:items-center"
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
					{isProActive
						? 'Log this cook and update your inventory.'
						: 'Log this cook to your history.'}
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

					{/* Inventory impact preview (Pro only) */}
					{isProActive && (
						<>
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
															<span className="text-red-600">
																will be removed
															</span>
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
						</>
					)}
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

// --- Ingredient list with heading support, inventory status, substitutions ---

function IngredientList({
	ingredients,
	checkedIngredients,
	onToggle,
	ratio,
	missingIngredientIds,
	isProActive,
	recipeId,
	substitutions,
	onApplySubstitution,
	onRevertSubstitution,
	shoppingFetcher,
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
	missingIngredientIds: string[]
	isProActive: boolean
	recipeId: string
	substitutions: Map<string, AppliedSubstitution>
	onApplySubstitution: (
		ingredientId: string,
		originalName: string,
		replacement: string,
	) => void
	onRevertSubstitution: (ingredientId: string) => void
	shoppingFetcher: ReturnType<typeof useFetcher>
}) {
	const missingSet = new Set(missingIngredientIds)
	const nonHeadingCount = ingredients.filter((i) => !i.isHeading).length
	const substitutedCount = missingIngredientIds.filter((id) =>
		substitutions.has(id),
	).length
	const haveCount =
		nonHeadingCount - missingIngredientIds.length + substitutedCount
	const missingCount = missingIngredientIds.length - substitutedCount

	const shoppingData = shoppingFetcher.data as
		| { addedToShoppingList?: number }
		| undefined
	const addedToList = shoppingData?.addedToShoppingList
	const isAddingToList = shoppingFetcher.state !== 'idle'

	function handleAddToShoppingList() {
		const formData = new FormData()
		formData.set('intent', 'add-to-shopping-list')
		formData.set('servingRatio', ratio.toString())
		void shoppingFetcher.submit(formData, { method: 'POST' })
	}

	return (
		<>
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
					const isMissing = missingSet.has(ingredient.id)
					const sub = substitutions.get(ingredient.id)

					return (
						<li
							key={ingredient.id}
							role="checkbox"
							aria-checked={isChecked}
							tabIndex={0}
							className={cn(
								'flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 transition-colors select-none',
								'hover:bg-accent/5',
							)}
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
									'min-w-0 flex-1 transition-colors',
									isChecked && 'text-muted-foreground/50 line-through',
								)}
							>
								{ingredient.amount && (
									<span className="font-medium">
										{scaleAmount(ingredient.amount, ratio)}{' '}
									</span>
								)}
								{ingredient.unit && <span>{ingredient.unit} </span>}
								{sub ? (
									<>
										<span className="text-amber-700 dark:text-amber-400">
											{sub.replacementShort}
										</span>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													aria-label={`Revert to ${sub.originalName}`}
													className="ml-0.5 inline-flex translate-y-px text-amber-500/70 hover:text-amber-700 dark:hover:text-amber-300"
													onClick={(e) => {
														e.stopPropagation()
														onRevertSubstitution(ingredient.id)
													}}
												>
													<Icon name="reset" className="size-3" />
												</button>
											</TooltipTrigger>
											<TooltipContent>
												Revert to {sub.originalName}
											</TooltipContent>
										</Tooltip>
									</>
								) : isMissing && isProActive ? (
									<SubstitutionHint
										ingredientName={ingredient.name}
										isProActive={isProActive}
										recipeId={recipeId}
										onApply={(replacement) =>
											onApplySubstitution(
												ingredient.id,
												ingredient.name,
												replacement,
											)
										}
									>
										{ingredient.name}
									</SubstitutionHint>
								) : (
									<span>{ingredient.name}</span>
								)}
								{ingredient.notes && (
									<span
										className={isChecked ? '' : 'text-muted-foreground'}
									>
										, {ingredient.notes}
									</span>
								)}
							</span>
							</li>
					)
				})}
			</ul>

			{/* Summary footer */}
			<div className="mt-5 space-y-2 border-t pt-3 print:hidden">
				<p className="text-muted-foreground px-1 text-xs">
					You have {haveCount}/{nonHeadingCount} ingredients
				</p>
				{missingCount > 0 && (
					<>
						{addedToList !== undefined ? (
							<div className="px-1 text-center">
								<p className="text-xs text-green-600">
									<Icon name="check" className="mr-1 inline size-3.5" />
									Added {addedToList} item
									{addedToList !== 1 ? 's' : ''} to shopping list
								</p>
								<Link
									to="/shopping"
									className="text-primary mt-1 inline-flex items-center gap-1 text-xs font-medium hover:underline"
								>
									View Shopping List
									<Icon name="arrow-right" className="size-3" />
								</Link>
							</div>
						) : (
							<Button
								variant="outline"
								size="sm"
								className="w-full gap-1.5 text-xs"
								onClick={handleAddToShoppingList}
								disabled={isAddingToList}
							>
								<Icon name="plus" size="sm" />
								{isAddingToList
									? 'Adding...'
									: `Add ${missingCount} missing to Shopping List`}
							</Button>
						)}
					</>
				)}
			</div>
		</>
	)
}

function formatQuantity(q: number | null): string {
	if (q === null) return '?'
	return Number.isInteger(q) ? q.toString() : q.toFixed(1)
}

// --- Substitution utilities ---

type AppliedSubstitution = {
	originalName: string
	replacementShort: string
}

function extractPrimaryIngredient(replacement: string): string {
	// Split on common combiners, take first part
	const primary = replacement.split(/\s*(?:\+|&|\band\b|\bwith\b)\s*/i)[0]!
	// Strip leading amounts/units (e.g., "1 cup butter" → "butter")
	return primary
		.replace(
			/^\d[\d./]*\s*(?:cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|ml|liters?|litres?)?\s*/i,
			'',
		)
		.trim()
}

function applySubstitutionsToText(
	text: string,
	substitutions: Map<string, AppliedSubstitution>,
): string {
	let result = text
	for (const sub of substitutions.values()) {
		const escaped = sub.originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		const regex = new RegExp(`\\b${escaped}\\b`, 'gi')
		result = result.replace(regex, sub.replacementShort)
	}
	return result
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
