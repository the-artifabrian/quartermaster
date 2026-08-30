import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Img } from 'openimg/react'
import { useState, useEffect, useRef } from 'react'
import { useFetcher, useRouteLoaderData, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Divider } from '#app/components/divider.tsx'
import { EnhanceRecipeModal } from '#app/components/enhance-recipe-modal.tsx'
import { OnboardingNudge } from '#app/components/onboarding-nudge.tsx'
import { RecipeActionBar } from '#app/components/recipe-action-bar.tsx'
import { IngredientList } from '#app/components/recipe-ingredient-list.tsx'
import { RecipeIngredientsSheet } from '#app/components/recipe-ingredients-sheet.tsx'
import { RecipeInstructionsList } from '#app/components/recipe-instructions-list.tsx'
import { RecipeMetadataCard } from '#app/components/recipe-metadata-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from '#app/components/ui/popover.tsx'
import {
	addDaysUTC,
	formatDayLabel,
	isToday,
	MEAL_TYPES,
	MEAL_TYPE_LABELS,
	type MealType,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { parseAmount, scaleAmount } from '#app/utils/fractions.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { findMatchingInventoryItem } from '#app/utils/inventory-dedup.server.ts'
import { activeLegacyPantryWhere } from '#app/utils/legacy-pantry.server.ts'
import { formatScaleMultiplier } from '#app/utils/menu-validation.ts'
import {
	convertToMetric,
	displayMetricAmount,
} from '#app/utils/metric-conversion.ts'
import { cn } from '#app/utils/misc.tsx'
import { getRecipeJsonLd } from '#app/utils/recipe-detail.ts'
import { type EnhanceableFields } from '#app/utils/recipe-enhance-llm.server.ts'
import {
	getCanonicalIngredientName,
	normalizeIngredientName,
} from '#app/utils/recipe-matching.server.ts'
import {
	buildShoppingDemand,
	demandIdentity,
} from '#app/utils/shopping-demand.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { guessCategory } from '#app/utils/shopping-list-validation.ts'
import {
	annotateShoppingDemand,
	findMissingRecipeIngredientIds,
	loadShoppingAvailability,
} from '#app/utils/shopping-list.server.ts'
import { getUserTier } from '#app/utils/subscription.server.ts'
import { useCookingProgress } from '#app/utils/use-cooking-progress.ts'
import { getKeepAwakePreference, useWakeLock } from '#app/utils/wake-lock.ts'
import { type Route } from './+types/$recipeId.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
	const recipe = loaderData?.recipe
	const title = recipe?.title
		? `${recipe.title} | Quartermaster`
		: 'Recipe | Quartermaster'
	const description =
		recipe?.description || `View recipe for ${recipe?.title ?? 'a dish'}`

	const rootMatch = matches.find((m) => m?.id === 'root')
	const origin = (
		rootMatch?.loaderData as { requestInfo?: { origin?: string } } | undefined
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
			activeTime: true,
			totalTime: true,
			yieldAmount: true,
			yieldLabel: true,
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
					linkedRecipeId: true,
					linkedRecipe: { select: { title: true } },
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

	const [tierInfo, availability] = await Promise.all([
		getUserTier(userId),
		loadShoppingAvailability(prisma, householdId),
	])

	const missingIngredientIds = findMissingRecipeIngredientIds(
		recipe.ingredients,
		availability,
	)

	return {
		recipe,
		isProActive: tierInfo.isProActive,
		missingIngredientIds,
		hasInventory:
			availability.kind === 'legacy-pantry' &&
			availability.inventoryItems.length > 0,
		usesLegacyPantry: availability.kind === 'legacy-pantry',
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

		return { success: true }
	}

	if (intent === 'mark-have-ingredient') {
		const activeHousehold = await prisma.household.findFirst({
			where: { id: householdId, staplesCutoverAt: null },
			select: { id: true },
		})
		invariantResponse(activeHousehold, 'Legacy Pantry is archived', {
			status: 409,
		})
		const ingredientId = formData.get('ingredientId')
		invariantResponse(
			typeof ingredientId === 'string',
			'Ingredient ID is required',
		)

		const ingredient = await prisma.ingredient.findFirst({
			where: { id: ingredientId, recipeId },
			select: { name: true },
		})
		invariantResponse(ingredient, 'Ingredient not found', { status: 404 })

		// Check for existing duplicate in Pantry
		const existingItems = await prisma.inventoryItem.findMany({
			where: activeLegacyPantryWhere(householdId),
			select: { id: true, name: true },
		})

		const match = findMatchingInventoryItem(ingredient.name, existingItems)
		if (!match) {
			// Clean up the ingredient name for Pantry display:
			// "mashed ripe banana" → "banana", "boneless skinless chicken thighs" → "chicken thigh"
			const cleaned = normalizeIngredientName(ingredient.name)

			await prisma.inventoryItem.create({
				data: {
					name: cleaned,
					userId,
					householdId,
				},
			})
		}

		return { success: true, markedHave: ingredientId }
	}

	if (intent === 'add-single-to-shopping-list') {
		const ingredientId = formData.get('ingredientId')
		invariantResponse(
			typeof ingredientId === 'string',
			'Ingredient ID is required',
		)
		const safeRatio = parseServingRatio(formData)
		const useMetric = formData.get('useMetric') === '1'

		const ingredient = await prisma.ingredient.findFirst({
			where: { id: ingredientId, recipeId },
			select: { name: true, amount: true, unit: true },
		})
		invariantResponse(ingredient, 'Ingredient not found', { status: 404 })

		const amount = ingredient.amount
			? scaleAmount(ingredient.amount, safeRatio, ingredient.unit)
			: null
		const shoppingItem = toShoppingItem(
			ingredient.name,
			amount,
			ingredient.unit,
			useMetric,
		)

		const ensuredShoppingList = await ensureShoppingList(prisma, {
			userId,
			householdId,
		})
		const shoppingList = {
			...ensuredShoppingList,
			// Dedup against all rows, checked or not — the generator's rule
			// (shopping.tsx). Excluding checked rows put a second "butter" next
			// to the one just checked off.
			items: await prisma.shoppingListItem.findMany({
				where: { listId: ensuredShoppingList.id },
			}),
		}

		const existingCanonical = new Set(
			shoppingList.items.map((item) => getCanonicalIngredientName(item.name)),
		)
		const isNew = !existingCanonical.has(
			getCanonicalIngredientName(shoppingItem.name),
		)

		if (isNew) {
			await prisma.shoppingListItem.create({
				data: {
					name: shoppingItem.name,
					quantity: shoppingItem.quantity,
					unit: shoppingItem.unit,
					category: guessCategory(shoppingItem.name),
					source: 'recipe',
					listId: shoppingList.id,
				},
			})

			void emitHouseholdEvent({
				type: 'shopping_list_item_added',
				payload: { name: ingredient.name, source: 'recipe' },
				userId,
				householdId,
			})
		}

		return { success: true, addedSingle: ingredientId, wasNew: isNew }
	}

	if (intent === 'add-to-shopping-list') {
		const safeRatio = parseServingRatio(formData)
		const useMetric = formData.get('useMetric') === '1'

		const fullRecipe = await prisma.recipe.findUnique({
			where: { id: recipeId },
			include: { ingredients: true },
		})
		invariantResponse(fullRecipe, 'Recipe not found')

		// One demand module for every generation entry point (#108): the same
		// heading/optional handling and consolidation as generate-from-Plan, then
		// the same availability seam. Legacy Pantry matches are pre-checked before
		// cutover; household Staple/Out state filters generated demand afterward.
		const demand = buildShoppingDemand({
			recipeBatches: [
				{ ingredients: fullRecipe.ingredients, scaleMultiplier: safeRatio },
			],
		})

		const availability = await loadShoppingAvailability(prisma, householdId)
		const { lines } = annotateShoppingDemand(demand, availability)

		if (lines.length === 0) {
			return { success: true, addedToShoppingList: 0 }
		}

		const ensuredShoppingList = await ensureShoppingList(prisma, {
			userId,
			householdId,
		})
		const shoppingList = {
			...ensuredShoppingList,
			// Dedup against all rows, checked or not — the generator's rule
			// (shopping.tsx).
			items: await prisma.shoppingListItem.findMany({
				where: { listId: ensuredShoppingList.id },
			}),
		}

		// Deduplicate by the module's demand identity so fallback-identity
		// lines still match their rows
		const existingCanonical = new Set(
			shoppingList.items.map((item) => demandIdentity(item.name)),
		)

		const newItems = lines.filter(
			(line) => !existingCanonical.has(line.canonicalName),
		)

		if (newItems.length > 0) {
			await prisma.shoppingListItem.createMany({
				data: newItems.map((line) => {
					const converted = toShoppingItem(
						line.name,
						line.quantity,
						line.unit,
						useMetric,
					)
					return {
						...converted,
						category: line.category,
						checked: line.inStock,
						source: 'recipe',
						listId: shoppingList.id,
					}
				}),
			})
		}

		void emitHouseholdEvent({
			type: 'shopping_list_item_added',
			payload: { name: recipe.title, source: 'recipe' },
			userId,
			householdId,
		})

		return {
			success: true,
			addedToShoppingList: newItems.length,
			// Before cutover, legacy Pantry matches land pre-checked instead of
			// silently dropping (#108); post-cutover lines are always unchecked.
			addedInStock: newItems.filter((line) => line.inStock).length,
		}
	}

	return { success: false }
}

function parseServingRatio(formData: FormData): number {
	const raw = parseFloat(String(formData.get('servingRatio') ?? '1'))
	return isNaN(raw) || raw <= 0 ? 1 : raw
}

function toShoppingItem(
	name: string,
	quantity: string | null,
	unit: string | null,
	useMetric: boolean,
): { name: string; quantity: string | null; unit: string | null } {
	if (!useMetric || !quantity || !unit) {
		return { name, quantity, unit }
	}
	const parsed = parseAmount(quantity)
	if (parsed === null) return { name, quantity, unit }

	const metric = convertToMetric(parsed, unit, name)
	if (!metric) return { name, quantity, unit }

	const display = displayMetricAmount(metric)
	return { name, quantity: display.quantity, unit: display.unit }
}

export default function RecipeDetail({ loaderData }: Route.ComponentProps) {
	const {
		recipe,
		isProActive,
		missingIngredientIds,
		hasInventory,
		usesLegacyPantry,
	} = loaderData
	const rootData = useRouteLoaderData('root') as
		{ requestInfo?: { origin?: string } } | undefined
	const origin = rootData?.requestInfo?.origin
	const recipeJsonLd = getRecipeJsonLd(recipe, origin)
	const [searchParams, setSearchParams] = useSearchParams()
	const favoriteFetcher = useFetcher()
	const isFavorite =
		favoriteFetcher.formData?.get('intent') === 'toggleFavorite'
			? !recipe.isFavorite
			: recipe.isFavorite
	const { checkedIngredients, checkedSteps, toggleIngredient, toggleStep } =
		useCookingProgress(recipe.id)
	const shoppingFetcher = useFetcher({ key: 'add-to-shopping' })
	const enhanceFetcher = useFetcher<{
		error: string | null
		suggestions: EnhanceableFields | null
	}>({ key: 'enhance-recipe' })
	const [showEnhanceModal, setShowEnhanceModal] = useState(false)
	const prevEnhanceFetcherState = useRef(enhanceFetcher.state)
	const [ingredientsExpanded, setIngredientsExpanded] = useState(true)
	const [useMetric, setUseMetric] = useState(false)
	useEffect(() => {
		setUseMetric(localStorage.getItem('qm-use-metric') === 'true')
	}, [])

	// Keep the screen awake while the recipe is open — cooking with wet hands is
	// the primary context; don't make the cook unlock the phone mid-step.
	// (Effect-gated so SSR and the keep-awake preference are respected.)
	const [keepAwake, setKeepAwake] = useState(false)
	useEffect(() => {
		setKeepAwake(getKeepAwakePreference())
	}, [])
	useWakeLock(keepAwake)

	// Add-to-plan popover state
	const [planPickerOpen, setPlanPickerOpen] = useState(false)
	const planFetcher = useFetcher({ key: 'add-to-plan' })
	const prevPlanFetcherState = useRef(planFetcher.state)
	const submittedPlanRef = useRef<{ date: string; label: MealType | null }>({
		date: '',
		label: null,
	})
	const today = new Date()
	const todayUTC = new Date(
		Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
	)
	const [planDate, setPlanDate] = useState(() => serializeDate(todayUTC))
	const [planMealType, setPlanMealType] = useState<MealType | null>('dinner')

	const allStepsChecked =
		recipe.instructions.length > 0 &&
		recipe.instructions.every((i) => checkedSteps.has(i.id))

	// Mid-cook ingredient glances (mobile): show a sticky "Ingredients" pill
	// once the inline ingredient list has scrolled out of view.
	const ingredientsSectionRef = useRef<HTMLDivElement>(null)
	const [ingredientsInView, setIngredientsInView] = useState(true)
	useEffect(() => {
		const el = ingredientsSectionRef.current
		if (!el || typeof IntersectionObserver === 'undefined') return
		const observer = new IntersectionObserver(([entry]) =>
			setIngredientsInView(entry?.isIntersecting ?? true),
		)
		observer.observe(el)
		return () => observer.disconnect()
	}, [])
	const nonHeadingIngredients = recipe.ingredients.filter((i) => !i.isHeading)
	const checkedIngredientCount = nonHeadingIngredients.filter((i) =>
		checkedIngredients.has(i.id),
	).length

	const servingsParam = searchParams.get('servings')
	const currentServings = servingsParam
		? Math.min(999, Math.max(1, parseInt(servingsParam, 10) || recipe.servings))
		: recipe.servings
	const ratio = currentServings / recipe.servings
	const isScaled = currentServings !== recipe.servings

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

	// Close plan picker on success
	useEffect(() => {
		if (
			prevPlanFetcherState.current !== 'idle' &&
			planFetcher.state === 'idle' &&
			planFetcher.data?.status === 'success'
		) {
			setPlanPickerOpen(false)
			const { date, label } = submittedPlanRef.current
			const d = new Date(date + 'T00:00:00.000Z')
			const dayLabel = isToday(d) ? 'Today' : formatDayLabel(d)
			toast.success(
				label
					? `Added to ${dayLabel} ${MEAL_TYPE_LABELS[label]}`
					: `Added to ${dayLabel}`,
			)
		}
		prevPlanFetcherState.current = planFetcher.state
	}, [planFetcher.state, planFetcher.data])

	function handleAddToPlanSubmit() {
		submittedPlanRef.current = { date: planDate, label: planMealType }
		const formData = new FormData()
		formData.set('intent', 'addMeal')
		formData.set('date', planDate)
		if (planMealType) formData.set('label', planMealType)
		formData.set('recipeId', recipe.id)
		// The page's servings stepper is a view-scaler; planning persists the
		// equivalent batch multiplier instead (#98 quantity basis), clamped to
		// the 100× the multiplier schema allows (a 1-serving recipe stepped to
		// 999 would otherwise compose an out-of-range value the server rejects).
		if (currentServings !== recipe.servings && recipe.servings > 0) {
			formData.set(
				'multiplier',
				formatScaleMultiplier(Math.min(100, currentServings / recipe.servings)),
			)
		}
		void planFetcher.submit(formData, {
			method: 'POST',
			action: '/plan',
		})
	}

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

	function toggleMetric() {
		setUseMetric((prev) => {
			localStorage.setItem('qm-use-metric', String(!prev))
			return !prev
		})
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

			<div className="container-content pt-4 pb-20 md:pt-6 md:pb-6 print:pt-0">
				{/* Hero: Title + Image */}
				<div className="flex flex-col md:flex-row md:items-start md:gap-8">
					<div className="min-w-0 flex-1">
						<h1 className="font-serif text-[2rem] leading-[1.15] font-normal tracking-[-0.02em]">
							{recipe.title}
						</h1>
						<Divider className="mt-3 mb-2 max-w-xs print:hidden" />
						<RecipeMetadataCard
							activeTime={recipe.activeTime}
							totalTime={recipe.totalTime}
							yieldAmount={recipe.yieldAmount}
							yieldLabel={recipe.yieldLabel}
							sourceUrl={recipe.sourceUrl}
						/>
					</div>

					{/* Image: full-bleed above the title on mobile, side column on desktop */}
					{recipe.image && (
						<div className="order-first -mx-4 -mt-4 mb-5 shrink-0 sm:-mx-8 md:order-none md:mx-0 md:my-0 md:w-100 print:hidden">
							<Img
								src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`}
								alt={recipe.image.altText ?? recipe.title}
								className="md:border-border aspect-[16/10] w-full object-cover md:aspect-4/3 md:rounded-md md:border"
								width={800}
								height={600}
							/>
						</div>
					)}
				</div>
				{/* Description */}
				{recipe.description && (
					<p className="text-muted-foreground mt-5 text-base leading-relaxed">
						{recipe.description}
					</p>
				)}

				{/* My Notes */}
				{recipe.notes && (
					<div className="mt-6">
						<div className="border-accent bg-accent/5 rounded-lg border-l-[3px] py-3 pr-4 pl-4">
							<p className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
								My Notes
							</p>
							<pre className="font-handwritten text-[1.125rem] leading-relaxed whitespace-pre-wrap">
								{recipe.notes}
							</pre>
						</div>
					</div>
				)}

				{/* Raw Text */}
				{recipe.rawText && (
					<div className="mt-6 print:hidden">
						<div className="bg-muted/40 rounded-lg p-4">
							<p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
								Recipe Notes
							</p>
							<pre className="font-sans text-sm whitespace-pre-wrap">
								{recipe.rawText}
							</pre>
						</div>
					</div>
				)}

				{/* Action bar */}
				<Popover open={planPickerOpen} onOpenChange={setPlanPickerOpen}>
					<PopoverAnchor>
						<RecipeActionBar
							recipeId={recipe.id}
							isFavorite={isFavorite}
							isProActive={isProActive}
							favoriteFetcher={favoriteFetcher}
							enhanceFetcher={enhanceFetcher}
							onAddToPlan={() => setPlanPickerOpen(true)}
							onShare={handleShare}
							onEnhance={handleEnhance}
						/>
					</PopoverAnchor>
					<PopoverContent align="start" className="w-72 p-4">
						<p className="mb-3 text-sm font-medium">Add to meal plan</p>
						<div className="mb-3">
							<p className="text-muted-foreground mb-1.5 text-xs">Day</p>
							<div className="flex flex-wrap gap-1.5">
								{Array.from({ length: 7 }, (_, i) => {
									const d = addDaysUTC(todayUTC, i)
									const val = serializeDate(d)
									const label =
										i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatDayLabel(d)
									return (
										<button
											key={val}
											type="button"
											onClick={() => setPlanDate(val)}
											className={cn(
												'rounded-full border px-2.5 py-1 text-xs transition-colors',
												planDate === val
													? 'border-primary bg-primary text-primary-foreground'
													: 'border-border hover:border-primary/50',
											)}
										>
											{label}
										</button>
									)
								})}
							</div>
						</div>
						<div className="mb-4">
							<p className="text-muted-foreground mb-1.5 text-xs">
								Label (optional)
							</p>
							<div className="flex gap-1.5">
								{MEAL_TYPES.map((mt) => (
									<button
										key={mt}
										type="button"
										onClick={() =>
											setPlanMealType(planMealType === mt ? null : mt)
										}
										className={cn(
											'rounded-full border px-2.5 py-1 text-xs transition-colors',
											planMealType === mt
												? 'border-primary bg-primary text-primary-foreground'
												: 'border-border hover:border-primary/50',
										)}
									>
										{MEAL_TYPE_LABELS[mt]}
									</button>
								))}
							</div>
						</div>
						<Button
							size="sm"
							className="w-full"
							onClick={handleAddToPlanSubmit}
							disabled={planFetcher.state !== 'idle'}
						>
							{planFetcher.state !== 'idle' ? 'Adding...' : 'Add to Plan'}
						</Button>
					</PopoverContent>
				</Popover>

				{usesLegacyPantry && !hasInventory && (
					<OnboardingNudge
						nudgeId="stock-kitchen"
						icon="home"
						title="Next up: choose your Staples"
						description="Save what your household normally keeps and mark anything Out."
						ctaText="Choose Staples"
						ctaHref="/inventory"
						className="mt-4 print:hidden"
					/>
				)}

				{/* Content zone: Ingredients + Instructions */}
				<div className="mt-4 grid gap-5 md:mt-8 md:grid-cols-[5fr_7fr] md:gap-8 print:grid-cols-1 print:gap-4">
					{/* Ingredients - sticky on desktop, interactive checkboxes */}
					<div
						ref={ingredientsSectionRef}
						className="md:sticky md:top-20 md:self-start print:static"
					>
						<div className="print:p-2">
							<div className="mb-3 flex items-center gap-2 md:mb-4">
								<button
									type="button"
									className="flex items-center gap-1.5 md:pointer-events-none"
									onClick={() => setIngredientsExpanded((v) => !v)}
									aria-expanded={ingredientsExpanded}
									aria-controls="ingredients-list"
								>
									<Icon
										name="chevron-down"
										size="sm"
										className={cn(
											'text-muted-foreground transition-transform md:hidden',
											!ingredientsExpanded && '-rotate-90',
										)}
									/>
									<h2 className="font-serif text-lg font-normal">
										Ingredients
									</h2>
								</button>
								<span className="ml-auto flex items-center gap-1 print:hidden">
									{/* after: pseudo on both steppers widens the hit area to
									    ~44px without growing the visual control (D7) */}
									<Button
										variant="outline"
										size="sm"
										className="relative h-8 w-8 p-0 text-xs after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-[''] md:after:hidden"
										onClick={() => updateServings(currentServings - 1)}
										disabled={currentServings <= 1}
										aria-label="Decrease servings"
									>
										-
									</Button>
									<span className="min-w-[3ch] text-center text-sm font-medium">
										{currentServings}
									</span>
									<Button
										variant="outline"
										size="sm"
										className="relative h-8 w-8 p-0 text-xs after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-[''] md:after:hidden"
										onClick={() => updateServings(currentServings + 1)}
										aria-label="Increase servings"
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
							<div
								id="ingredients-list"
								className={cn(!ingredientsExpanded && 'hidden md:block')}
							>
								<IngredientList
									ingredients={recipe.ingredients}
									checkedIngredients={checkedIngredients}
									onToggle={toggleIngredient}
									ratio={ratio}
									missingIngredientIds={missingIngredientIds}
									recipeId={recipe.id}
									shoppingFetcher={shoppingFetcher}
									canMarkUsuallyOnHand={usesLegacyPantry}
									useMetric={useMetric}
									onToggleMetric={toggleMetric}
								/>
							</div>
						</div>
					</div>

					{/* Instructions - interactive crossable steps */}
					<div>
						<RecipeInstructionsList
							instructions={recipe.instructions}
							checkedSteps={checkedSteps}
							onToggleStep={toggleStep}
							recipeName={recipe.title}
							useMetric={useMetric}
						/>
					</div>
				</div>

				{/* Ingredients at hand while deep in the steps (mobile only).
				    Hidden once every step is checked — the cook is done. */}
				<RecipeIngredientsSheet
					visible={!ingredientsInView && !allStepsChecked}
					checkedCount={checkedIngredientCount}
					totalCount={nonHeadingIngredients.length}
					ingredients={recipe.ingredients}
					checkedIngredients={checkedIngredients}
					onToggle={toggleIngredient}
					ratio={ratio}
					missingIngredientIds={missingIngredientIds}
					recipeId={recipe.id}
					shoppingFetcher={shoppingFetcher}
					canMarkUsuallyOnHand={usesLegacyPantry}
					useMetric={useMetric}
				/>

				{/* Print-only source URL footer */}
				{recipe.sourceUrl && (
					<p className="mt-8 hidden text-xs text-gray-500 print:block">
						Source: {recipe.sourceUrl}
					</p>
				)}
			</div>

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
