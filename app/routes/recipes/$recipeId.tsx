import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { goneItemMiddleware } from '#app/components/gone-item.tsx'
import {
	NotInHouseholdBoundary,
	notFoundTitle,
} from '#app/components/not-in-household.tsx'
import {
	type NavBarHandle,
	useNavBarActions,
} from '#app/components/nav-bar.tsx'
import { recipeDetailNav } from '#app/utils/nav-back.ts'
import { Img } from 'openimg/react'
import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import {
	data,
	useFetcher,
	useLocation,
	useNavigate,
	useRouteLoaderData,
	useSearchParams,
	useViewTransitionState,
} from 'react-router'
import { toast } from 'sonner'
import { EnhanceRecipeModal } from '#app/components/enhance-recipe-modal.tsx'
import { ImportedRecipeNotice } from '#app/components/imported-recipe-notice.tsx'
import {
	favoriteFetcherKey,
	RecipeActionBar,
	RecipeNavActions,
	shareRecipePage,
	useEnhanceFetcher,
} from '#app/components/recipe-action-bar.tsx'
import { IngredientList } from '#app/components/recipe-ingredient-list.tsx'
import { RecipeIngredientsSheet } from '#app/components/recipe-ingredients-sheet.tsx'
import { RecipeInstructionsList } from '#app/components/recipe-instructions-list.tsx'
import {
	RecipeFacts,
	RecipeMetadataCard,
} from '#app/components/recipe-metadata-card.tsx'
import { RecipeNotes } from '#app/components/recipe-notes.tsx'
import { RecipeIngredientsControls } from '#app/components/recipe-scale-control.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Chip } from '#app/components/ui/chip.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { PushLink } from '#app/components/push-link.tsx'
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from '#app/components/ui/popover.tsx'
import { BottomSheet, opensAsSheet } from '#app/components/ui/bottom-sheet.tsx'
import { type PlannedMealResult } from '#app/routes/plan/plan-action.server.ts'
import {
	addDaysUTC,
	formatDayLabel,
	isToday,
	loadedToday,
	MEAL_TYPES,
	MEAL_TYPE_LABELS,
	type MealType,
	parseDate,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	isRangeAmount,
	parseAmount,
	scaleAmount,
} from '#app/utils/fractions.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { getRequestToday } from '#app/utils/today.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	IMPORTED_FROM,
	SHORTENED_PARTS,
} from '#app/utils/import-recipe-types.ts'
import {
	formatScaleMultiplier,
	ScaleMultiplierSchema,
} from '#app/utils/menu-validation.ts'
import {
	convertToMetric,
	displayMetricAmount,
} from '#app/utils/metric-conversion.ts'
import { getShareImageUrl, IMG_SIZES } from '#app/utils/image-route.ts'
import { cn } from '#app/utils/misc.tsx'
import { getRecipeJsonLd } from '#app/utils/recipe-detail.ts'
import { MAX_RECIPE_DESCRIPTION_LENGTH } from '#app/utils/recipe-validation.ts'
import { haptic } from '#app/utils/shell-bridge.ts'
import { addRecipeLineToShopping } from '#app/utils/shopping-adds.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { getUserTier } from '#app/utils/subscription.server.ts'
import { useFetcherSettled } from '#app/hooks/use-fetcher-settled.ts'
import { useCookingProgress } from '#app/utils/use-cooking-progress.ts'
import { getKeepAwakePreference, useWakeLock } from '#app/utils/wake-lock.ts'
import { staleWhileRevalidate } from '#app/utils/loader-cache.ts'
import { useStaleRevalidate } from '#app/utils/use-stale-revalidate.ts'
import { type Route } from './+types/$recipeId.ts'

// Going back to this page once its item is gone opens /recipes instead.
export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
	goneItemMiddleware('/recipes'),
]

export const handle: SEOHandle & NavBarHandle = {
	getSitemapEntries: () => null,
	nav: recipeDetailNav,
	navActions: RecipeBarActions,
}

/** Favourite, Share and ⋯ in the nav bar on a phone. */
function RecipeBarActions({ data }: { data: unknown }) {
	const { recipe, isProActive } = data as Route.ComponentProps['loaderData']
	return <RecipeNavActions recipe={recipe} isProActive={isProActive} />
}

export const meta: Route.MetaFunction = ({ loaderData, matches, error }) => {
	const recipe = loaderData?.recipe
	const title = recipe?.title
		? `${recipe.title} | Quartermaster`
		: (notFoundTitle(error, 'Recipe') ?? 'Recipe | Quartermaster')
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
		const imageUrl = getShareImageUrl(origin, recipe.image.objectKey)
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
			activeTime: true,
			totalTime: true,
			yieldAmount: true,
			yieldLabel: true,
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

	const tierInfo = await getUserTier(userId)

	// A just-imported Recipe's notice points at an older one with its title.
	const sameTitle = new URL(request.url).searchParams.has('imported')
		? await prisma.recipe.findFirst({
				where: { householdId, title: recipe.title, id: { not: recipe.id } },
				select: { id: true, title: true },
				orderBy: { createdAt: 'desc' },
			})
		: null

	return {
		recipe,
		userId,
		householdId,
		isProActive: tierInfo.isProActive,
		sameTitle,
		// Add to Plan's Today chip, the browser's day (see getRequestToday).
		today: getRequestToday(request),
	}
}

/** The import an `?imported=` redirect describes, if this visit has one. */
function importedFromSearch(searchParams: URLSearchParams) {
	const from = IMPORTED_FROM.find(
		(value) => value === searchParams.get('imported'),
	)
	if (!from) return null
	const shortened = (searchParams.get('shortened') ?? '').split(',')
	return {
		from,
		shortened: SHORTENED_PARTS.filter((part) => shortened.includes(part)),
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const { recipeId } = params

	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		select: {
			id: true,
			title: true,
			householdId: true,
			isFavorite: true,
			activeTime: true,
			totalTime: true,
		},
	})

	invariantResponse(recipe, 'Recipe not found', { status: 404 })
	invariantResponse(recipe.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	const { isProActive } = await getUserTier(userId)

	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'toggleFavorite') {
		// The tap says which state it wants, so two taps, or two people,
		// can't cancel out. A tab from an older build sends nothing, and then
		// the tap flips it.
		const wanted = formData.get('isFavorite')
		invariantResponse(
			wanted === null || wanted === 'true' || wanted === 'false',
			'isFavorite must be true or false',
			{ status: 400 },
		)
		await prisma.recipe.update({
			where: { id: recipeId },
			data: {
				isFavorite: wanted === null ? !recipe.isFavorite : wanted === 'true',
			},
		})
		return { success: true }
	}

	if (intent === 'applyEnhancement') {
		if (!isProActive) return { success: false, requiresPro: true }

		const updateData: {
			description?: string
			activeTime?: number
			totalTime?: number
		} = {}

		const description = formData.get('enhance_description')
		if (typeof description === 'string') {
			const normalizedDescription = description
				.trim()
				.slice(0, MAX_RECIPE_DESCRIPTION_LENGTH)
			if (normalizedDescription) {
				updateData.description = normalizedDescription
			}
		}
		for (const field of ['activeTime', 'totalTime'] as const) {
			const value = formData.get(`enhance_${field}`)
			const minutes = typeof value === 'string' ? Number(value) : NaN
			if (Number.isSafeInteger(minutes) && minutes > 0) {
				updateData[field] = minutes
			}
		}

		const changesTime =
			updateData.activeTime != null || updateData.totalTime != null
		const resultingActiveTime = updateData.activeTime ?? recipe.activeTime
		const resultingTotalTime = updateData.totalTime ?? recipe.totalTime
		if (
			changesTime &&
			resultingActiveTime != null &&
			resultingTotalTime != null &&
			resultingTotalTime < resultingActiveTime
		) {
			return {
				success: false,
				error:
					'Total time can’t be shorter than active time. Untick one of them.',
			}
		}
		await prisma.recipe.update({
			where: { id: recipeId },
			data: updateData,
		})

		return { success: true }
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
		// Removed by another member while this page was open. Thrown, the 404
		// would replace the Recipe that is still here with the not-found page.
		if (!ingredient) {
			return data(
				{
					success: false,
					error: 'That ingredient isn’t in this Recipe any more.',
				},
				{ status: 404 },
			)
		}

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
		const { isNew, promoted } = await addRecipeLineToShopping(prisma, {
			listId: ensuredShoppingList.id,
			item: shoppingItem,
		})

		if (isNew || promoted) {
			void emitHouseholdEvent({
				originClientId: formData.get('originClientId'),
				type: 'shopping_list_item_added',
				payload: { name: ingredient.name, source: 'recipe' },
				userId,
				householdId,
			})
		}

		return {
			success: true,
			addedSingle: ingredientId,
			wasNew: isNew,
			wasPromoted: promoted,
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
	// A range has no single value to convert; it stays as written.
	if (!useMetric || !quantity || !unit || isRangeAmount(quantity)) {
		return { name, quantity, unit }
	}
	const parsed = parseAmount(quantity)
	if (parsed === null) return { name, quantity, unit }

	const metric = convertToMetric(parsed, unit, name)
	if (!metric) return { name, quantity, unit }

	const display = displayMetricAmount(metric)
	return { name, quantity: display.quantity, unit: display.unit }
}

// Shows the last data for this URL at once on a navigation and revalidates
// behind it; see loader-cache.ts.
export async function clientLoader(args: Route.ClientLoaderArgs) {
	return staleWhileRevalidate(args)
}
clientLoader.hydrate = false as const

export default function RecipeDetail({ loaderData }: Route.ComponentProps) {
	useStaleRevalidate(loaderData)
	const { recipe, isProActive } = loaderData
	// The image moves from its Recipes card while the page slides in or out.
	const imageTransitionsFromList = useViewTransitionState('/recipes')
	const rootData = useRouteLoaderData('root') as
		{ requestInfo?: { origin?: string } } | undefined
	const origin = rootData?.requestInfo?.origin
	const recipeJsonLd = getRecipeJsonLd(recipe, origin)
	const [searchParams, setSearchParams] = useSearchParams()
	// The notice an import's redirect asks for, read once. The address drops
	// it straight away, so a reload, Back, or the iOS app reopening this page
	// never shows it, or its Undo, again.
	const [imported, setImported] = useState(() => {
		const found = importedFromSearch(searchParams)
		return (
			found && {
				...found,
				recipeId: recipe.id,
				sameTitle: loaderData.sameTitle,
			}
		)
	})
	// Its "Open it" link shows another Recipe in this same component.
	if (imported && imported.recipeId !== recipe.id) setImported(null)
	// A clean import just opens the Recipe. The notice (with Edit and Undo)
	// shows only when there is something to look at: a part it could not find
	// or had to shorten, or an older Recipe with the same title.
	const missingIngredients = !recipe.ingredients.some(
		(ingredient) => !ingredient.isHeading,
	)
	const missingInstructions = recipe.instructions.length === 0
	const importNeedsLook = Boolean(
		imported &&
		(missingIngredients ||
			missingInstructions ||
			imported.shortened.length > 0 ||
			imported.sameTitle),
	)
	// The notice plays the saved haptic itself; a clean import plays it here.
	const cleanImportId = imported && !importNeedsLook ? imported.recipeId : null
	useEffect(() => {
		if (cleanImportId) haptic('success')
	}, [cleanImportId])
	const location = useLocation()
	useEffect(() => {
		if (!searchParams.has('imported') && !searchParams.has('shortened')) return
		setSearchParams(
			(prev) => {
				prev.delete('imported')
				prev.delete('shortened')
				return prev
			},
			// Keep the Recipe's OPEN_DETAIL marker, so going back still slides.
			{ replace: true, preventScrollReset: true, state: location.state },
		)
	}, [searchParams, setSearchParams, location.state])
	const {
		checkedIngredients,
		checkedSteps,
		toggleIngredient,
		toggleStep,
		reset,
	} = useCookingProgress({
		userId: loaderData.userId,
		householdId: loaderData.householdId,
		recipeId: recipe.id,
		ingredients: recipe.ingredients,
		instructions: recipe.instructions,
	})
	const enhanceFetcher = useEnhanceFetcher()
	// The nav bar's buttons send through the page, so an error answers here,
	// and they go when the page does (an error after load).
	useNavBarActions(RecipeBarActions)
	const favoriteFetcher = useFetcher({ key: favoriteFetcherKey(recipe.id) })
	// Reset cooking checks shows in the bar's ⋯ while there are some. A layout
	// effect, so it is there in the frame the first check is.
	const hasCookingChecks = checkedIngredients.size + checkedSteps.size > 0
	const latest = useRef({ reset, favoriteFetcher, enhanceFetcher })
	useLayoutEffect(() => {
		latest.current = { reset, favoriteFetcher, enhanceFetcher }
	})
	useLayoutEffect(() => {
		shareRecipePage(recipe.id, {
			toggleFavorite: (favorite) =>
				void latest.current.favoriteFetcher.submit(
					{ intent: 'toggleFavorite', isFavorite: String(favorite) },
					{ method: 'POST', action: `/recipes/${recipe.id}` },
				),
			enhance: () =>
				void latest.current.enhanceFetcher.submit(
					{ recipeId: recipe.id },
					{ method: 'POST', action: '/resources/enhance-recipe' },
				),
			reset: hasCookingChecks ? () => latest.current.reset() : undefined,
		})
		return () => shareRecipePage(recipe.id, null)
	}, [recipe.id, hasCookingChecks])
	const [showEnhanceModal, setShowEnhanceModal] = useState(false)
	const [ingredientsExpanded, setIngredientsExpanded] = useState(true)
	const [useMetric, setUseMetric] = useState(false)
	useEffect(() => {
		setUseMetric(localStorage.getItem('qm-use-metric') === 'true')
	}, [])

	// Keep the screen awake while the recipe is open. People cook with wet
	// hands, so don't make the cook unlock the phone mid-step.
	// (Effect-gated so SSR and the keep-awake preference are respected.)
	const [keepAwake, setKeepAwake] = useState(false)
	useEffect(() => {
		setKeepAwake(getKeepAwakePreference())
	}, [])
	useWakeLock(keepAwake)

	const navigate = useNavigate()
	const [planPickerOpen, setPlanPickerOpen] = useState(false)
	// A phone gets the picker as a bottom sheet, like every other picker in
	// the app, with room for thumb-sized chips; wider screens keep the popover.
	const [planPickerAsSheet, setPlanPickerAsSheet] = useState(false)
	const planFetcher = useFetcher<{
		status: 'success' | 'error'
		meal?: PlannedMealResult
	}>({ key: 'add-to-plan' })
	const submittedPlanRef = useRef<{ date: string; label: MealType | null }>({
		date: '',
		label: null,
	})
	const today = loadedToday(loaderData.today)
	const todayUTC = parseDate(today)
	// Until a day is picked, Add to Plan follows today, which can move on
	// when cached data from yesterday revalidates.
	const [pickedPlanDate, setPlanDate] = useState<string | null>(null)
	const planDate = pickedPlanDate ?? today
	const [planMealType, setPlanMealType] = useState<MealType | null>('dinner')

	const allStepsChecked =
		recipe.instructions.length > 0 &&
		recipe.instructions.every((i) => checkedSteps.has(i.id))

	// Mid-cook ingredient glances: show the floating Ingredients action only
	// after the heading has passed above the viewport. Observing the whole tall
	// column kept it intersecting until the end of long Recipes.
	const ingredientsHeaderRef = useRef<HTMLDivElement>(null)
	const [ingredientsPassed, setIngredientsPassed] = useState(false)
	useEffect(() => {
		const el = ingredientsHeaderRef.current
		if (!el || typeof IntersectionObserver === 'undefined') return
		// The heading has passed once it is under the pinned header (the nav
		// bar is its last row where it shows), not only once it leaves the
		// screen.
		const barBottom = Math.max(
			0,
			Math.round(
				document.querySelector('[data-site-header]')?.getBoundingClientRect()
					.bottom ?? 0,
			),
		)
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry) return
				const viewportTop = entry.rootBounds?.top ?? 0
				setIngredientsPassed(
					!entry.isIntersecting &&
						entry.boundingClientRect.bottom < viewportTop,
				)
			},
			{ rootMargin: `-${barBottom}px 0px 0px 0px` },
		)
		observer.observe(el)
		return () => observer.disconnect()
	}, [])
	const nonHeadingIngredients = recipe.ingredients.filter((i) => !i.isHeading)
	const checkedIngredientCount = nonHeadingIngredients.filter((i) =>
		checkedIngredients.has(i.id),
	).length

	const scaleParam = ScaleMultiplierSchema.safeParse(searchParams.get('scale'))
	const ratio = scaleParam.success ? scaleParam.data : 1

	// Open enhance modal or show error when enhance fetch completes
	useFetcherSettled(enhanceFetcher, (data) => {
		if (data) {
			if (data.suggestions) {
				setShowEnhanceModal(true)
			} else if (data.error) {
				toast.error(data.error)
			}
		}
	})

	// Close plan picker on success
	useFetcherSettled(planFetcher, (data) => {
		if (data?.status === 'success') {
			setPlanPickerOpen(false)
			const { date, label } = submittedPlanRef.current
			const d = parseDate(date)
			const dayLabel = isToday(d, today) ? 'Today' : formatDayLabel(d)
			const where = label ? `${dayLabel} ${MEAL_TYPE_LABELS[label]}` : dayLabel
			const meal = data.meal
			if (meal && !meal.created) {
				// The Meal that already holds this Recipe keeps its own multiplier,
				// so name it, and point at the Meal to change it there.
				toast.info('Already planned', {
					description: `${where} · ${formatScaleMultiplier(meal.scaleMultiplier)}×`,
					duration: 8000,
					action: { label: 'View', onClick: () => navigate(meal.href) },
				})
			} else {
				toast.success(`Added to ${where}`)
			}
		} else if (data?.status === 'error') {
			toast.error(`Could not add ${recipe.title} to Plan`)
		}
	})

	function handleAddToPlanSubmit() {
		submittedPlanRef.current = { date: planDate, label: planMealType }
		const formData = new FormData()
		formData.set('intent', 'addMeal')
		formData.set('date', planDate)
		if (planMealType) formData.set('label', planMealType)
		formData.set('recipeId', recipe.id)
		// The target/multiplier control is only a view of the stored multiplier
		// that Menu, Meal and Shopping use.
		if (ratio !== 1) {
			formData.set('multiplier', formatScaleMultiplier(ratio))
		}
		void planFetcher.submit(formData, {
			method: 'POST',
			action: '/plan',
		})
	}

	function openPlanPicker() {
		// A sheet on a phone, upright or on its side; a popover elsewhere.
		setPlanPickerAsSheet(opensAsSheet())
		// Each opening starts on today, so a day picked before midnight can't
		// send yesterday.
		setPlanDate(null)
		setPlanPickerOpen(true)
	}

	function updateScaleMultiplier(scaleMultiplier: number) {
		setSearchParams(
			(prev) => {
				prev.delete('servings')
				if (scaleMultiplier === 1) {
					prev.delete('scale')
				} else {
					prev.set('scale', formatScaleMultiplier(scaleMultiplier))
				}
				return prev
			},
			// Keep the Recipe's OPEN_DETAIL marker, so going back still slides,
			// and the place in the Recipe the scale was changed from.
			{ replace: true, state: location.state, preventScrollReset: true },
		)
	}

	function toggleMetric() {
		setUseMetric((prev) => {
			localStorage.setItem('qm-use-metric', String(!prev))
			return !prev
		})
	}

	const planPickerBody = (
		<>
			<div className="mb-3">
				<p
					id="plan-picker-day-label"
					className="text-muted-foreground mb-1.5 text-xs"
				>
					Day
				</p>
				<div
					role="group"
					aria-labelledby="plan-picker-day-label"
					className="flex flex-wrap gap-2"
				>
					{Array.from({ length: 7 }, (_, i) => {
						const d = addDaysUTC(todayUTC, i)
						const val = serializeDate(d)
						const label =
							i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatDayLabel(d)
						return (
							<Chip
								key={val}
								onClick={() => setPlanDate(val)}
								pressed={planDate === val}
							>
								{label}
							</Chip>
						)
					})}
				</div>
			</div>
			<div className="mb-4">
				<p
					id="plan-picker-label-label"
					className="text-muted-foreground mb-1.5 text-xs"
				>
					Label (optional)
				</p>
				<div
					role="group"
					aria-labelledby="plan-picker-label-label"
					className="flex flex-wrap gap-2"
				>
					{MEAL_TYPES.map((mt) => (
						<Chip
							key={mt}
							onClick={() => setPlanMealType(planMealType === mt ? null : mt)}
							pressed={planMealType === mt}
						>
							{MEAL_TYPE_LABELS[mt]}
						</Chip>
					))}
				</div>
			</div>
			<Button
				className="w-full"
				onClick={handleAddToPlanSubmit}
				disabled={planFetcher.state !== 'idle'}
			>
				{planFetcher.state !== 'idle' ? 'Adding…' : 'Add to Plan'}
			</Button>
		</>
	)
	return (
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(recipeJsonLd).replace(/</g, '\\u003c'),
				}}
			/>

			{/* Full width on a phone: the Recipes layout is a flex column, where
			    a short Recipe's auto margins would shrink it to its content and
			    leave the photo and Add to Plan short of the edges. */}
			<div className="container-content phone:w-full pt-4 pb-[calc(var(--bottom-nav-h)+5.25rem+var(--bottom-nav-inset))] md:pt-6 md:pb-20 lg:pb-6 print:pt-0 print:pb-0">
				{importNeedsLook && imported ? (
					<ImportedRecipeNotice
						recipeId={recipe.id}
						from={imported.from}
						sourceUrl={recipe.sourceUrl}
						shortened={imported.shortened}
						missingIngredients={missingIngredients}
						missingInstructions={missingInstructions}
						sameTitle={imported.sameTitle}
						onDismiss={() => setImported(null)}
					/>
				) : null}
				<div className="flex flex-col md:flex-row md:items-start md:gap-8">
					<div className="min-w-0 flex-1">
						<h1 className="phone:text-recipe-title phone:leading-(--text-recipe-title--line-height) font-serif text-[2rem] leading-[1.15] tracking-[-0.02em]">
							{recipe.title}
						</h1>
						{/* A phone has its facts under the description. */}
						<RecipeMetadataCard
							activeTime={recipe.activeTime}
							totalTime={recipe.totalTime}
							yieldAmount={recipe.yieldAmount}
							yieldLabel={recipe.yieldLabel}
							sourceUrl={recipe.sourceUrl}
							showYield={false}
							className="phone:hidden"
						/>
					</div>

					{recipe.image && (
						<div className="phone:mb-[22px] order-first -mx-4 -mt-4 mb-5 shrink-0 sm:-mx-8 md:order-none md:mx-0 md:my-0 md:w-[45%] lg:w-100 print:hidden">
							<Img
								src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`}
								alt={recipe.image.altText ?? recipe.title}
								data-recipe-image-transition={
									imageTransitionsFromList ? '' : undefined
								}
								className="md:border-border phone:aspect-auto phone:h-[292px] aspect-[16/10] w-full object-cover md:aspect-4/3 md:rounded-md md:border"
								{...IMG_SIZES.hero}
							/>
						</div>
					)}
				</div>
				{recipe.description && (
					<p className="text-muted-foreground phone:mt-2 phone:font-serif phone:text-xl phone:leading-[1.35] phone:font-normal phone:italic mt-5 text-base leading-relaxed text-pretty">
						{recipe.description}
					</p>
				)}
				<RecipeFacts
					activeTime={recipe.activeTime}
					totalTime={recipe.totalTime}
					yieldAmount={recipe.yieldAmount}
					yieldLabel={recipe.yieldLabel}
					scaleMultiplier={ratio}
					sourceUrl={recipe.sourceUrl}
					className="phone:flex mt-[18px] hidden"
				/>

				<Popover
					open={planPickerOpen && !planPickerAsSheet}
					onOpenChange={setPlanPickerOpen}
				>
					{/* Around whichever row shows, so the popover (640 to 767px)
					    opens under the phone's Add to Plan too. */}
					<PopoverAnchor>
						<div className="phone:flex mt-5 hidden gap-2">
							<Button
								onClick={openPlanPicker}
								className="h-12 min-w-0 flex-1 text-base font-semibold"
							>
								<Icon name="calendar" size="md" />
								Add to Plan
							</Button>
							<Button
								asChild
								variant="secondary"
								className="h-12 px-5 text-base font-semibold"
							>
								<PushLink
									to={`/recipes/${recipe.id}/edit`}
									aria-label="Edit Recipe"
								>
									<Icon name="pencil-1" size="md" />
									Edit
								</PushLink>
							</Button>
						</div>
						<RecipeActionBar
							recipe={recipe}
							isProActive={isProActive}
							onAddToPlan={openPlanPicker}
							onResetCookingChecks={hasCookingChecks ? reset : undefined}
						/>
					</PopoverAnchor>
					<PopoverContent
						align="start"
						collisionPadding={16}
						className="max-h-(--radix-popover-content-available-height) w-96 overflow-y-auto p-4"
					>
						<p className="mb-3 text-sm font-medium">Add to Plan</p>
						{planPickerBody}
					</PopoverContent>
				</Popover>
				<BottomSheet
					open={planPickerOpen && planPickerAsSheet}
					onClose={() => setPlanPickerOpen(false)}
					labelledBy="recipe-plan-picker-title"
					title="Add to Plan"
				>
					{planPickerBody}
				</BottomSheet>

				{/* Personal notes sit under the actions, collapsed, so the header
				    stays compact and Ingredients start within the first screen. */}
				{recipe.notes && <RecipeNotes notes={recipe.notes} className="mt-4" />}

				<div className="mt-4 grid gap-5 md:mt-8 lg:grid-cols-[6fr_7fr] lg:gap-6 print:grid-cols-1 print:gap-4">
					<div className="min-w-0 lg:sticky lg:top-[calc(var(--nav-bar-bottom,4rem)+1rem)] lg:self-start print:static">
						<div className="print:p-2">
							<div ref={ingredientsHeaderRef}>
								<RecipeIngredientsControls
									scaleMultiplier={ratio}
									yieldAmount={recipe.yieldAmount}
									yieldLabel={recipe.yieldLabel}
									onScaleMultiplierChange={updateScaleMultiplier}
									ingredientsExpanded={ingredientsExpanded}
									onToggleIngredients={() =>
										setIngredientsExpanded((value) => !value)
									}
									useMetric={useMetric}
									onToggleMetric={toggleMetric}
								/>
							</div>
							<div
								id="ingredients-list"
								className={cn(!ingredientsExpanded && 'hidden lg:block')}
							>
								<IngredientList
									ingredients={recipe.ingredients}
									checkedIngredients={checkedIngredients}
									onToggle={toggleIngredient}
									ratio={ratio}
									recipeId={recipe.id}
									useMetric={useMetric}
								/>
							</div>
						</div>
					</div>

					<div className="min-w-0">
						<RecipeInstructionsList
							instructions={recipe.instructions}
							checkedSteps={checkedSteps}
							onToggleStep={toggleStep}
							useMetric={useMetric}
						/>
					</div>
				</div>

				{/* Ingredients at hand while deep in the steps (mobile only).
				    Hidden once every step is checked, since the cook is done. */}
				<RecipeIngredientsSheet
					visible={ingredientsPassed && !allStepsChecked}
					checkedCount={checkedIngredientCount}
					totalCount={nonHeadingIngredients.length}
					ingredients={recipe.ingredients}
					checkedIngredients={checkedIngredients}
					onToggle={toggleIngredient}
					ratio={ratio}
					recipeId={recipe.id}
					useMetric={useMetric}
				/>

				{recipe.sourceUrl && (
					<p className="mt-8 hidden text-xs text-gray-500 print:block">
						Source: {recipe.sourceUrl}
					</p>
				)}
			</div>

			<EnhanceRecipeModal
				open={showEnhanceModal}
				recipe={recipe}
				suggestions={enhanceFetcher.data?.suggestions}
				onClose={() => setShowEnhanceModal(false)}
			/>
		</>
	)
}

export function ErrorBoundary() {
	return <NotInHouseholdBoundary kind="Recipe" />
}
