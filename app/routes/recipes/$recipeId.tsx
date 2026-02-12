import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
	Form,
	Link,
	useFetcher,
	useRouteLoaderData,
	useSearchParams,
} from 'react-router'
import { CookingTimer } from '#app/components/cooking-timer.tsx'
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
import { subtractRecipeIngredientsFromInventory } from '#app/utils/inventory-subtract.server.ts'
import { cn, useDoubleCheck } from '#app/utils/misc.tsx'
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
			rating: true,
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
				rating: submission.value.rating ?? null,
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

	return { success: false }
}

// --- Utility hooks & components ---

function useWakeLock() {
	const [isActive, setIsActive] = useState(false)

	const toggle = useCallback(() => {
		setIsActive((prev) => !prev)
	}, [])

	const activate = useCallback(() => {
		setIsActive(true)
	}, [])

	const deactivate = useCallback(() => {
		setIsActive(false)
	}, [])

	useEffect(() => {
		if (!isActive) return

		let wakeLock: WakeLockSentinel | null = null

		async function requestWakeLock() {
			try {
				if ('wakeLock' in navigator) {
					wakeLock = await navigator.wakeLock.request('screen')
				}
			} catch {
				// Wake Lock request failed (e.g., low battery)
			}
		}

		void requestWakeLock()

		function handleVisibilityChange() {
			if (document.visibilityState === 'visible') {
				void requestWakeLock()
			}
		}
		document.addEventListener('visibilitychange', handleVisibilityChange)

		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange)
			void wakeLock?.release()
		}
	}, [isActive])

	return { isActive, toggle, activate, deactivate }
}

function StarRating({
	value,
	onChange,
}: {
	value: number
	onChange: (rating: number) => void
}) {
	return (
		<div className="flex gap-0.5">
			{[1, 2, 3, 4, 5].map((star) => (
				<button
					key={star}
					type="button"
					onClick={() => onChange(star === value ? 0 : star)}
					aria-label={`Rate ${star} star${star !== 1 ? 's' : ''}`}
					className="p-1 text-amber-500 transition-transform hover:scale-110"
				>
					<Icon name={star <= value ? 'star-filled' : 'star'} size="md" />
				</button>
			))}
		</div>
	)
}

function StarDisplay({ rating }: { rating: number }) {
	return (
		<div
			className="flex gap-0.5"
			role="img"
			aria-label={`Rating: ${rating} out of 5 stars`}
		>
			{[1, 2, 3, 4, 5].map((star) => (
				<Icon
					key={star}
					name={star <= rating ? 'star-filled' : 'star'}
					size="sm"
					className="text-amber-500"
				/>
			))}
		</div>
	)
}

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
		}>
		instructions: Array<{ content: string }>
		tags: Array<{ name: string; category: string }>
	},
	cookingLogs: Array<{ rating: number | null }>,
	origin: string | undefined,
) {
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)
	const ratings = cookingLogs
		.map((l) => l.rating)
		.filter((r): r is number => r !== null && r > 0)

	const jsonLd: Record<string, unknown> = {
		'@context': 'https://schema.org',
		'@type': 'Recipe',
		name: recipe.title,
		...(recipe.description && { description: recipe.description }),
		...(recipe.servings && { recipeYield: `${recipe.servings} servings` }),
		...(recipe.prepTime && { prepTime: toIsoDuration(recipe.prepTime) }),
		...(recipe.cookTime && { cookTime: toIsoDuration(recipe.cookTime) }),
		...(totalTime > 0 && { totalTime: toIsoDuration(totalTime) }),
		recipeIngredient: recipe.ingredients.map((i) =>
			[i.amount, i.unit, i.name].filter(Boolean).join(' '),
		),
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

	if (ratings.length > 0) {
		const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length
		jsonLd.aggregateRating = {
			'@type': 'AggregateRating',
			ratingValue: Math.round(avg * 10) / 10,
			ratingCount: ratings.length,
			bestRating: 5,
			worstRating: 1,
		}
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
	const recipeJsonLd = getRecipeJsonLd(recipe, cookingLogs, origin)
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
	const wakeLock = useWakeLock()
	const [cookRating, setCookRating] = useState(0)
	const cookFetcher = useFetcher({ key: 'log-cook' })
	const prevCookFetcherState = useRef(cookFetcher.state)

	const isCookingMode = searchParams.get('cooking') === 'true'
	const [currentStep, setCurrentStep] = useState(0)
	const [showCookModal, setShowCookModal] = useState(false)
	const [showIngredientDrawer, setShowIngredientDrawer] = useState(false)
	const [historyExpanded, setHistoryExpanded] = useState(false)

	const servingsParam = searchParams.get('servings')
	const currentServings = servingsParam
		? Math.max(1, parseInt(servingsParam, 10) || recipe.servings)
		: recipe.servings
	const ratio = currentServings / recipe.servings
	const isScaled = currentServings !== recipe.servings

	// Auto-activate wake lock in cooking mode
	useEffect(() => {
		if (isCookingMode && !wakeLock.isActive) {
			wakeLock.activate()
		}
		if (!isCookingMode && wakeLock.isActive) {
			wakeLock.deactivate()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isCookingMode])

	// Close modal + exit cooking mode after successful cook log submission
	useEffect(() => {
		if (
			prevCookFetcherState.current !== 'idle' &&
			cookFetcher.state === 'idle' &&
			cookFetcher.data?.success
		) {
			setShowCookModal(false)
			setCookRating(0)
			exitCookingMode()

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
			}
		}
		prevCookFetcherState.current = cookFetcher.state
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cookFetcher.state, cookFetcher.data])

	function updateServings(newServings: number) {
		const clamped = Math.max(1, newServings)
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

	function enterCookingMode() {
		setSearchParams(
			(prev) => {
				prev.set('cooking', 'true')
				return prev
			},
			{ replace: true },
		)
		setCurrentStep(0)
	}

	function exitCookingMode() {
		setSearchParams(
			(prev) => {
				prev.delete('cooking')
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
			const wasChecked = next.has(id)
			if (wasChecked) {
				next.delete(id)
			} else {
				next.add(id)
				// Auto-advance current step to next unchecked step
				const nextUnchecked = recipe.instructions.findIndex(
					(inst, idx) => idx > currentStep && !next.has(inst.id),
				)
				if (nextUnchecked !== -1) {
					setCurrentStep(nextUnchecked)
				}
			}
			return next
		})
	}

	async function handleShare() {
		const url = `${origin ?? window.location.origin}/recipes/${recipe.id}`
		const shareData = {
			title: recipe.title,
			text: recipe.description || `Check out this recipe: ${recipe.title}`,
			url,
		}
		try {
			if (navigator.share) {
				await navigator.share(shareData)
			} else {
				await navigator.clipboard.writeText(url)
				toast.success('Link copied to clipboard')
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') return
			try {
				await navigator.clipboard.writeText(url)
				toast.success('Link copied to clipboard')
			} catch {
				toast.error('Unable to share — try copying the URL manually')
			}
		}
	}

	// --- Cooking Mode ---
	if (isCookingMode) {
		return (
			<>
				<div className="container max-w-4xl py-4">
					{/* Cooking mode header */}
					<div className="mb-4 flex items-center justify-between">
						<div className="min-w-0 flex-1">
							<h1 className="truncate text-xl font-bold">{recipe.title}</h1>
							<p className="text-muted-foreground text-sm">Cooking mode</p>
						</div>
						<Button variant="ghost" size="sm" onClick={exitCookingMode}>
							<Icon name="cross-1" size="sm" />
							Exit
						</Button>
					</div>

					<div className="grid gap-6 md:grid-cols-[2fr_3fr]">
						{/* Ingredients - sticky sidebar on desktop, drawer toggle on mobile */}
						<div className="md:sticky md:top-20 md:self-start">
							{/* Mobile toggle */}
							<button
								className="bg-card shadow-warm mb-4 flex w-full items-center justify-between rounded-2xl border p-4 md:hidden"
								onClick={() => setShowIngredientDrawer((v) => !v)}
							>
								<span className="flex items-center gap-2 font-semibold">
									<Icon name="file-text" size="sm" />
									Ingredients
									{isScaled && (
										<span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs">
											Scaled
										</span>
									)}
								</span>
								<Icon
									name="chevron-down"
									size="sm"
									className={cn(
										'transition-transform',
										showIngredientDrawer && 'rotate-180',
									)}
								/>
							</button>

							{/* Ingredients panel */}
							<div
								className={cn(
									'bg-card shadow-warm rounded-2xl border p-6',
									showIngredientDrawer ? 'block' : 'hidden md:block',
								)}
							>
								<div className="mb-4 flex items-center gap-2">
									<h2 className="text-lg font-semibold">Ingredients</h2>
									{isScaled && (
										<span className="bg-primary/10 text-primary hidden rounded-full px-2 py-0.5 text-xs font-medium md:inline-block">
											Scaled
										</span>
									)}
								</div>
								{/* Servings controls */}
								<div className="mb-4 flex items-center gap-2 text-sm">
									<Icon name="avatar" size="sm" className="text-accent" />
									<Button
										variant="outline"
										size="sm"
										className="h-9 w-9 p-0"
										onClick={() => updateServings(currentServings - 1)}
										disabled={currentServings <= 1}
									>
										-
									</Button>
									<span className="min-w-[5ch] text-center font-medium">
										{currentServings}
									</span>
									<Button
										variant="outline"
										size="sm"
										className="h-9 w-9 p-0"
										onClick={() => updateServings(currentServings + 1)}
									>
										+
									</Button>
									<span className="text-muted-foreground">servings</span>
									{isScaled && (
										<button
											onClick={() => updateServings(recipe.servings)}
											className="text-primary text-xs hover:underline"
										>
											Reset
										</button>
									)}
								</div>
								<ul className="space-y-1">
									{recipe.ingredients.map((ingredient) => {
										const isChecked = checkedIngredients.has(ingredient.id)
										return (
											<li
												key={ingredient.id}
												role="checkbox"
												aria-checked={isChecked}
												tabIndex={0}
												className="hover:bg-accent/5 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 transition-colors select-none"
												onClick={() => toggleIngredient(ingredient.id)}
												onKeyDown={(e) => {
													if (e.key === 'Enter' || e.key === ' ') {
														e.preventDefault()
														toggleIngredient(ingredient.id)
													}
												}}
											>
												<span
													className={cn(
														'flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
														isChecked
															? 'border-primary bg-primary text-primary-foreground'
															: 'border-muted-foreground/30',
													)}
												>
													{isChecked && (
														<Icon name="check" className="size-3" />
													)}
												</span>
												<span
													className={cn(
														'transition-colors',
														isChecked &&
															'text-muted-foreground/50 line-through',
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
														<span
															className={
																isChecked ? '' : 'text-muted-foreground'
															}
														>
															, {ingredient.notes}
														</span>
													)}
												</span>
											</li>
										)
									})}
								</ul>
							</div>
						</div>

						{/* Instructions - step paginator on mobile, full list on desktop */}
						<div>
							<h2 className="mb-4 hidden text-lg font-semibold md:block">
								Instructions
							</h2>

							{/* Mobile: step-by-step paginator */}
							<div className="md:hidden">
								{recipe.instructions.length > 0 && (
									<div className="space-y-4">
										<div className="text-muted-foreground text-center text-sm">
											Step {currentStep + 1} of {recipe.instructions.length}
										</div>
										<div className="bg-card shadow-warm min-h-[200px] rounded-2xl border p-6">
											<div className="mb-3 flex items-center gap-3">
												<span className="bg-accent/10 text-accent border-accent/20 flex size-10 shrink-0 items-center justify-center rounded-full border text-lg font-semibold">
													{currentStep + 1}
												</span>
												{checkedSteps.has(
													recipe.instructions[currentStep]?.id ?? '',
												) && (
													<span className="text-xs text-green-600">
														Completed
													</span>
												)}
											</div>
											<p className="text-lg leading-relaxed">
												{recipe.instructions[currentStep]?.content}
											</p>
										</div>

										{/* Progress dots */}
										<div className="scrollbar-hide flex items-center justify-center gap-0.5 overflow-x-auto">
											{recipe.instructions.map((inst, idx) => (
												<button
													key={inst.id}
													onClick={() => setCurrentStep(idx)}
													className="flex size-6 shrink-0 items-center justify-center"
													aria-label={`Go to step ${idx + 1}`}
												>
													<span
														className={cn(
															'size-2 rounded-full transition-all',
															idx === currentStep
																? 'bg-accent scale-125'
																: checkedSteps.has(inst.id)
																	? 'bg-primary/40'
																	: 'bg-muted-foreground/20',
														)}
													/>
												</button>
											))}
										</div>

										{/* Prev/Next buttons */}
										<div className="flex gap-3 pb-20 md:pb-0">
											<Button
												variant="outline"
												className="h-12 flex-1"
												onClick={() =>
													setCurrentStep((s) => Math.max(0, s - 1))
												}
												disabled={currentStep === 0}
											>
												<Icon name="arrow-left" size="sm" />
												Previous
											</Button>
											{currentStep < recipe.instructions.length - 1 ? (
												<Button
													className="h-12 flex-1"
													onClick={() => {
														const currentId =
															recipe.instructions[currentStep]?.id
														if (currentId && !checkedSteps.has(currentId)) {
															toggleStep(currentId)
														}
														setCurrentStep((s) =>
															Math.min(recipe.instructions.length - 1, s + 1),
														)
													}}
												>
													Next
													<Icon name="arrow-right" size="sm" />
												</Button>
											) : (
												<Button
													className="h-12 flex-1 bg-green-600 hover:bg-green-700"
													onClick={() => {
														const currentId =
															recipe.instructions[currentStep]?.id
														if (currentId && !checkedSteps.has(currentId)) {
															toggleStep(currentId)
														}
														setShowCookModal(true)
													}}
												>
													<Icon name="check" size="sm" />
													Done Cooking
												</Button>
											)}
										</div>
									</div>
								)}
							</div>

							{/* Desktop: all steps visible, current highlighted */}
							<ol className="hidden space-y-4 md:block">
								{recipe.instructions.map((instruction, index) => {
									const isChecked = checkedSteps.has(instruction.id)
									const isCurrent = index === currentStep
									return (
										<li
											key={instruction.id}
											role="checkbox"
											aria-checked={isChecked}
											tabIndex={0}
											className={cn(
												'flex cursor-pointer gap-4 rounded-lg px-3 py-3 transition-all select-none',
												isCurrent &&
													!isChecked &&
													'border-accent bg-accent/5 rounded-r-lg border-l-4',
												!isCurrent && 'hover:bg-muted/50',
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
														: isCurrent
															? 'bg-accent text-accent-foreground'
															: 'bg-accent/10 text-accent border-accent/20 border',
												)}
											>
												{isChecked ? (
													<Icon name="check" size="sm" />
												) : (
													index + 1
												)}
											</span>
											<div className="flex-1 pt-0.5">
												{isCurrent && !isChecked && (
													<span className="text-accent mb-1 block text-xs font-semibold tracking-wide uppercase">
														Current Step
													</span>
												)}
												<p
													className={cn(
														'text-base transition-colors',
														isChecked &&
															'text-muted-foreground/50 line-through',
													)}
												>
													{instruction.content}
												</p>
											</div>
										</li>
									)
								})}
							</ol>

							{/* Desktop done cooking button */}
							<div className="mt-6 hidden md:block">
								<Button
									className="h-12 w-full bg-green-600 text-base hover:bg-green-700"
									onClick={() => setShowCookModal(true)}
								>
									<Icon name="check" size="md" />
									Done Cooking
								</Button>
							</div>
						</div>
					</div>
				</div>

				<CookingTimer wakeLock={wakeLock} />

				{/* "Done Cooking" modal */}
				{showCookModal && (
					<CookCompleteModal
						ratio={ratio}
						cookRating={cookRating}
						setCookRating={setCookRating}
						cookFetcher={cookFetcher}
						onClose={() => {
							setShowCookModal(false)
							setCookRating(0)
						}}
					/>
				)}
			</>
		)
	}

	// --- Normal Mode ---

	return (
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(recipeJsonLd).replace(/</g, '\\u003c'),
				}}
			/>

			{/* Header */}
			<div className="container max-w-4xl px-4 pt-6 md:px-8">
				<Link
					to="/recipes"
					className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm print:hidden"
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
				<div className="bg-card shadow-warm-lg mt-4 rounded-2xl border p-5 print:border-0 print:p-2 print:shadow-none">
					<div className="flex flex-wrap items-center gap-3 text-sm">
						{/* Servings */}
						<span className="flex items-center gap-1">
							<Icon name="avatar" size="sm" className="text-accent" />
							<Button
								variant="outline"
								size="sm"
								className="h-9 w-9 p-0 print:hidden"
								onClick={() => updateServings(currentServings - 1)}
								disabled={currentServings <= 1}
							>
								-
							</Button>
							<span className="min-w-[5ch] text-center font-medium">
								{currentServings}
							</span>
							<Button
								variant="outline"
								size="sm"
								className="h-9 w-9 p-0 print:hidden"
								onClick={() => updateServings(currentServings + 1)}
							>
								+
							</Button>
							<span className="text-muted-foreground">servings</span>
							{isScaled && (
								<button
									onClick={() => updateServings(recipe.servings)}
									className="text-primary ml-1 text-xs hover:underline print:hidden"
								>
									Reset
								</button>
							)}
						</span>

						{(recipe.prepTime || recipe.cookTime) && (
							<span className="text-border hidden md:inline">|</span>
						)}

						{recipe.prepTime && (
							<span className="text-muted-foreground flex items-center gap-1">
								<Icon name="clock" size="sm" className="text-accent" />
								Prep: {recipe.prepTime} min
							</span>
						)}
						{recipe.cookTime && (
							<>
								<span className="text-border hidden md:inline">|</span>
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
								<span className="text-border hidden md:inline">|</span>
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
					<Button onClick={enterCookingMode} className="gap-2">
						<Icon name="play" size="sm" />
						Start Cooking
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
							<Button
								variant="ghost"
								size="icon"
								onClick={handleShare}
							>
								<Icon name="share" size="md" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Share recipe</TooltipContent>
					</Tooltip>
				</div>

				{/* Content zone: Ingredients + Instructions */}
				<div className="mt-8 grid gap-8 md:grid-cols-[2fr_3fr] print:grid-cols-1 print:gap-4">
					{/* Ingredients - sticky on desktop */}
					<div className="md:sticky md:top-20 md:self-start print:static">
						<div className="bg-card shadow-warm rounded-2xl border p-6 print:border-0 print:p-2 print:shadow-none">
							<div className="mb-4 flex items-center gap-2">
								<h2 className="text-lg font-semibold">Ingredients</h2>
								{isScaled && (
									<span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
										Scaled
									</span>
								)}
							</div>
							<ul className="space-y-1">
								{recipe.ingredients.map((ingredient) => (
									<li
										key={ingredient.id}
										className="flex items-start gap-3 rounded-lg px-2 py-2"
									>
										<span className="bg-primary mt-2 block size-1.5 shrink-0 rounded-full" />
										<span>
											{ingredient.amount && (
												<span className="font-medium">
													{scaleAmount(ingredient.amount, ratio)}{' '}
												</span>
											)}
											{ingredient.unit && <span>{ingredient.unit} </span>}
											<span>{ingredient.name}</span>
											{ingredient.notes && (
												<span className="text-muted-foreground">
													, {ingredient.notes}
												</span>
											)}
										</span>
									</li>
								))}
							</ul>
						</div>
					</div>

					{/* Instructions */}
					<div>
						<h2 className="mb-4 text-lg font-semibold">Instructions</h2>
						<ol className="space-y-6">
							{recipe.instructions.map((instruction, index) => (
								<li
									key={instruction.id}
									className="flex gap-4 rounded-lg px-2 py-2"
								>
									<span className="bg-accent/10 text-accent border-accent/20 flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium">
										{index + 1}
									</span>
									<p className="pt-1 text-base">{instruction.content}</p>
								</li>
							))}
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
			<div className="fixed inset-x-4 bottom-20 z-30 md:hidden print:hidden">
				<div className="bg-card/95 shadow-warm-lg flex items-center gap-2 rounded-2xl border p-2 backdrop-blur-md">
					<Button onClick={enterCookingMode} className="flex-1 gap-2">
						<Icon name="play" size="sm" />
						Start Cooking
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

			<CookingTimer wakeLock={wakeLock} />
		</>
	)
}

// --- "Done Cooking" modal ---

function CookCompleteModal({
	ratio,
	cookRating,
	setCookRating,
	cookFetcher,
	onClose,
}: {
	ratio: number
	cookRating: number
	setCookRating: (r: number) => void
	cookFetcher: ReturnType<typeof useFetcher>
	onClose: () => void
}) {
	useEffect(() => {
		function handleEscape(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', handleEscape)
		return () => document.removeEventListener('keydown', handleEscape)
	}, [onClose])

	return (
		<div
			className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
			role="dialog"
			aria-modal="true"
			aria-labelledby="cook-complete-title"
		>
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
			/>
			{/* Modal */}
			<div className="bg-card shadow-warm-lg relative w-full max-w-md rounded-t-2xl p-6 sm:rounded-2xl">
				<div className="mb-1 flex items-center justify-between">
					<h2 id="cook-complete-title" className="font-serif text-xl font-bold">
						Nice work!
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
					Log this cook to track your cooking history.
				</p>
				<cookFetcher.Form method="POST" className="space-y-4">
					<input type="hidden" name="intent" value="logCook" />
					<input type="hidden" name="rating" value={cookRating || ''} />
					<input type="hidden" name="servingRatio" value={ratio} />
					<div className="flex flex-wrap gap-4">
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
								className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
							/>
						</div>
						<div>
							<label className="text-muted-foreground mb-1 block text-sm">
								Rating
							</label>
							<StarRating value={cookRating} onChange={setCookRating} />
						</div>
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
							className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
						/>
					</div>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							name="subtractInventory"
							defaultChecked
							className="size-4 rounded"
						/>
						Subtract ingredients from inventory
					</label>
					<div className="flex gap-2">
						<Button type="submit" className="flex-1">
							Save
						</Button>
						<Button type="button" variant="ghost" onClick={onClose}>
							Skip
						</Button>
					</div>
				</cookFetcher.Form>
			</div>
		</div>
	)
}

// --- Cooking log entry ---

function CookingLogEntry({
	log,
}: {
	log: {
		id: string
		cookedAt: Date
		notes: string | null
		rating: number | null
	}
}) {
	const dc = useDoubleCheck()

	return (
		<div className="bg-card shadow-warm flex items-start gap-3 rounded-2xl border p-4">
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm font-medium">
						{format(new Date(log.cookedAt), 'MMM d, yyyy')}
					</span>
					{log.rating && <StarDisplay rating={log.rating} />}
				</div>
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
