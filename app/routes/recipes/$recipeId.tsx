import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { toast } from 'sonner'
import { useState, useEffect, useRef } from 'react'
import { useCookingProgress } from '#app/utils/use-cooking-progress.ts'
import {
	Link,
	useFetcher,
	useRouteLoaderData,
	useSearchParams,
} from 'react-router'
import { EnhanceRecipeModal } from '#app/components/enhance-recipe-modal.tsx'
import { RecipeActionBar } from '#app/components/recipe-action-bar.tsx'
import { CookingLogEntry } from '#app/components/recipe-cooking-log-entry.tsx'
import { IMadeThisModal } from '#app/components/recipe-i-made-this-modal.tsx'
import { IngredientList } from '#app/components/recipe-ingredient-list.tsx'
import { RecipeInstructionsList } from '#app/components/recipe-instructions-list.tsx'
import { RecipeMetadataCard } from '#app/components/recipe-metadata-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
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
	type SubtractionSummary,
} from '#app/utils/inventory-subtract.server.ts'
import {
	buildInventoryLookup,
	getCanonicalIngredientName,
	ingredientMatchesAnyInventoryItem,
	isStapleIngredient,
} from '#app/utils/recipe-matching.server.ts'
import { cn } from '#app/utils/misc.tsx'
import {
	type AppliedSubstitution,
	extractPrimaryIngredient,
	formatQuantity,
	getRecipeJsonLd,
} from '#app/utils/recipe-detail.ts'
import { guessCategory } from '#app/utils/shopping-list-validation.ts'
import { trackEvent } from '#app/utils/usage-tracking.server.ts'
import { type Route } from './+types/$recipeId.ts'

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

		await prisma.recipe.update({
			where: { id: recipeId },
			data: updateData,
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

// --- Main component ---

export default function RecipeDetail({ loaderData }: Route.ComponentProps) {
	const { recipe, cookingLogs, isProActive, missingIngredientIds } = loaderData
	const rootData = useRouteLoaderData('root') as
		| { requestInfo?: { origin?: string } }
		| undefined
	const origin = rootData?.requestInfo?.origin
	const recipeJsonLd = getRecipeJsonLd(recipe, origin)
	const [searchParams, setSearchParams] = useSearchParams()
	const favoriteFetcher = useFetcher()
	const isFavorite =
		favoriteFetcher.formData?.get('intent') === 'toggleFavorite'
			? !recipe.isFavorite
			: recipe.isFavorite
	const {
		checkedIngredients,
		checkedSteps,
		toggleIngredient,
		toggleStep,
		clearProgress,
	} = useCookingProgress(recipe.id)
	const cookFetcher = useFetcher({ key: 'log-cook' })
	const previewFetcher = useFetcher({ key: 'preview-subtraction' })
	const shoppingFetcher = useFetcher({ key: 'add-to-shopping' })
	const prevCookFetcherState = useRef(cookFetcher.state)
	const [showIMadeThisModal, setShowIMadeThisModal] = useState(false)
	const [cookResult, setCookResult] = useState<SubtractionSummary | null>(null)
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

	// Handle cook log submission result
	useEffect(() => {
		if (
			prevCookFetcherState.current !== 'idle' &&
			cookFetcher.state === 'idle' &&
			cookFetcher.data?.success
		) {
			clearProgress()
			const summary = cookFetcher.data
				.inventorySummary as SubtractionSummary | null

			if (summary && summary.skipped.length > 0) {
				// Transition modal to review state
				setCookResult(summary)
			} else {
				// No skipped items — close modal and show toast
				setShowIMadeThisModal(false)
				if (summary) {
					const parts: string[] = []
					if (summary.removed.length > 0) {
						parts.push(`Removed ${summary.removed.join(', ')}.`)
					}
					if (summary.updated.length > 0) {
						parts.push(`Updated ${summary.updated.join(', ')}.`)
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
		}
		prevCookFetcherState.current = cookFetcher.state
	}, [cookFetcher.state, cookFetcher.data, clearProgress])

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
		void enhanceFetcher.submit(formData, {
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

	function handleIMadeThis() {
		setCookResult(null)
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

	function handleModalClose() {
		if (cookResult) {
			const parts: string[] = []
			if (cookResult.removed.length > 0) {
				parts.push(`Removed ${cookResult.removed.join(', ')}.`)
			}
			if (cookResult.updated.length > 0) {
				parts.push(`Updated ${cookResult.updated.join(', ')}.`)
			}
			if (parts.length > 0) {
				toast.success('Inventory updated', { description: parts.join(' ') })
			}
		}
		setShowIMadeThisModal(false)
		setCookResult(null)
	}

	async function handleShare() {
		const url = `${origin ?? window.location.origin}/share/${recipe.id}`
		try {
			await navigator.clipboard.writeText(url)
			toast.success('Public link copied', {
				description: 'Anyone with this link can view the recipe.',
			})
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
				<RecipeMetadataCard
					prepTime={recipe.prepTime}
					cookTime={recipe.cookTime}
					sourceUrl={recipe.sourceUrl}
				/>

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

				{/* Action bar (desktop inline + mobile floating) */}
				<RecipeActionBar
					recipeId={recipe.id}
					isFavorite={isFavorite}
					isProActive={isProActive}
					favoriteFetcher={favoriteFetcher}
					enhanceFetcher={enhanceFetcher}
					onIMadeThis={handleIMadeThis}
					onShare={handleShare}
					onEnhance={handleEnhance}
				/>

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
					<RecipeInstructionsList
						instructions={recipe.instructions}
						checkedSteps={checkedSteps}
						onToggleStep={toggleStep}
						substitutions={substitutions}
						recipeName={recipe.title}
					/>
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

			{/* "I Made This" modal */}
			{showIMadeThisModal && (
				<IMadeThisModal
					ratio={ratio}
					cookFetcher={cookFetcher}
					previewFetcher={previewFetcher}
					onClose={handleModalClose}
					isProActive={isProActive}
					cookResult={cookResult}
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
