import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { isSameDay } from 'date-fns'
import { useState } from 'react'
import { Form, Link } from 'react-router'
import { MealPlanCalendar } from '#app/components/meal-plan-calendar.tsx'
import {
	ApplyTemplateModal,
	SaveTemplateModal,
} from '#app/components/template-modal.tsx'
import { TodayBanner } from '#app/components/today-banner.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import {
	getCurrentWeekStart,
	getWeekDays,
	getWeekStart,
	formatWeekRange,
	getNextWeek,
	getPreviousWeek,
	parseDate,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	analyzeIngredientOverlap,
	generateWasteAlerts,
} from '#app/utils/ingredient-overlap.server.ts'
import { subtractRecipeIngredientsFromInventory } from '#app/utils/inventory-subtract.server.ts'
import { MealPlanEntrySchema } from '#app/utils/meal-plan-validation.ts'
import { trackEvent } from '#app/utils/usage-tracking.server.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Meal Plan | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireProTier(request)
	const url = new URL(request.url)
	const weekStartParam = url.searchParams.get('weekStart')

	const weekStart = weekStartParam
		? getWeekStart(parseDate(weekStartParam))
		: getCurrentWeekStart()

	// Get or create meal plan for this week
	let mealPlan = await prisma.mealPlan.findFirst({
		where: {
			householdId,
			weekStart,
		},
		include: {
			entries: {
				include: {
					recipe: {
						include: {
							ingredients: true,
							image: { select: { objectKey: true } },
						},
					},
				},
			},
		},
	})

	if (!mealPlan) {
		mealPlan = await prisma.mealPlan.create({
			data: {
				userId,
				householdId,
				weekStart,
			},
			include: {
				entries: {
					include: {
						recipe: {
							include: {
								ingredients: true,
								image: { select: { objectKey: true } },
							},
						},
					},
				},
			},
		})
	}

	// Load user's recipes for the picker (no ingredients — lighter query)
	const recipes = await prisma.recipe.findMany({
		where: { householdId },
		orderBy: { title: 'asc' },
	})

	const weekDays = getWeekDays(weekStart)

	// Compute overlap stats and recipe suggestions when 2+ unique recipes planned
	let overlapSummary: {
		efficiencyPct: number
		sharedCount: number
		suggestions: Array<{
			id: string
			title: string
			sharedCount: number
			ingredients: string[]
		}>
	} | null = null

	if (mealPlan.entries.length >= 2) {
		const plannedRecipes = mealPlan.entries.map((e) => e.recipe)
		const uniquePlanned = [
			...new Map(plannedRecipes.map((r) => [r.id, r])).values(),
		]

		if (uniquePlanned.length >= 2) {
			// Only load all recipes with ingredients when overlap analysis is needed
			const recipesWithIngredients = await prisma.recipe.findMany({
				where: { householdId },
				include: { ingredients: true },
			})

			const overlap = analyzeIngredientOverlap(uniquePlanned)
			const alerts = generateWasteAlerts(uniquePlanned, recipesWithIngredients)

			// Aggregate suggestions by recipe, ranked by shared ingredient count
			const recipeMap = new Map<
				string,
				{ title: string; ingredients: Set<string> }
			>()
			for (const alert of alerts) {
				for (const recipe of alert.suggestedRecipes) {
					const existing = recipeMap.get(recipe.id)
					if (existing) {
						existing.ingredients.add(alert.ingredientName)
					} else {
						recipeMap.set(recipe.id, {
							title: recipe.title,
							ingredients: new Set([alert.ingredientName]),
						})
					}
				}
			}

			const suggestions = [...recipeMap.entries()]
				.map(([id, { title, ingredients }]) => ({
					id,
					title,
					sharedCount: ingredients.size,
					ingredients: [...ingredients],
				}))
				.sort((a, b) => b.sharedCount - a.sharedCount)
				.slice(0, 3)

			overlapSummary = {
				efficiencyPct: Math.round((1 - overlap.efficiencyScore) * 100),
				sharedCount: overlap.sharedIngredients.size,
				suggestions,
			}

			// Deduplicate: only snapshot once per household per week
			const weekKey = serializeDate(weekStart)
			const existing = await prisma.usageEvent.findFirst({
				where: {
					householdId,
					type: 'efficiency_snapshot',
					payload: { contains: weekKey },
				},
				select: { id: true },
			})
			if (!existing) {
				void trackEvent(userId, householdId, 'efficiency_snapshot', {
					efficiencyPct: overlapSummary.efficiencyPct,
					sharedCount: overlapSummary.sharedCount,
					recipeCount: uniquePlanned.length,
					weekStart: weekKey,
				})
			}
		}
	}

	// Tonight banner data (only for current week)
	const isCurrentWeek =
		serializeDate(weekStart) === serializeDate(getCurrentWeekStart())
	let tonightData: {
		entries: Array<{
			id: string
			recipe: {
				id: string
				title: string
				prepTime: number | null
				cookTime: number | null
				servings: number | null
				image: { objectKey: string } | null
			}
			mealType: string
			servings: number | null
		}>
		suggestion: {
			id: string
			title: string
			image: { objectKey: string } | null
		} | null
	} | null = null

	if (isCurrentWeek) {
		const today = new Date()
		const hour = today.getHours()

		// Determine which meal type is "next" based on time of day
		const mealTypeOrder = ['breakfast', 'lunch', 'dinner', 'snack']
		const currentMealIndex = hour < 11 ? 0 : hour < 15 ? 1 : hour < 21 ? 2 : 3

		// Sort entries so the next meal type comes first, then later ones in order
		function mealTypeSortKey(mealType: string) {
			const idx = mealTypeOrder.indexOf(mealType)
			if (idx === -1) return 999
			// Rotate so currentMealIndex comes first
			return (idx - currentMealIndex + 4) % 4
		}

		const tonightEntries = mealPlan.entries
			.filter((e) => isSameDay(new Date(e.date), today) && !e.cooked)
			.map((e) => ({
				id: e.id,
				recipe: {
					id: e.recipe.id,
					title: e.recipe.title,
					prepTime: e.recipe.prepTime,
					cookTime: e.recipe.cookTime,
					servings: e.recipe.servings,
					image: e.recipe.image,
				},
				mealType: e.mealType,
				servings: e.servings,
			}))
			.sort((a, b) => mealTypeSortKey(a.mealType) - mealTypeSortKey(b.mealType))

		let suggestion = null
		if (tonightEntries.length === 0) {
			const plannedRecipeIds = [
				...new Set(mealPlan.entries.map((e) => e.recipeId)),
			]
			suggestion = await prisma.recipe.findFirst({
				where: {
					householdId,
					id:
						plannedRecipeIds.length > 0
							? { notIn: plannedRecipeIds }
							: undefined,
				},
				orderBy: [{ isFavorite: 'desc' }, { updatedAt: 'desc' }],
				select: {
					id: true,
					title: true,
					image: { select: { objectKey: true } },
				},
			})
		}

		tonightData = { entries: tonightEntries, suggestion }
	}

	// Fetch meal plan templates for this household
	const templates = await prisma.mealPlanTemplate.findMany({
		where: { householdId },
		orderBy: { updatedAt: 'desc' },
		select: {
			id: true,
			name: true,
			_count: { select: { entries: true } },
		},
	})

	return {
		mealPlan,
		entries: mealPlan.entries.map((entry) => ({
			...entry,
			date: new Date(entry.date),
		})),
		recipes,
		weekDays,
		weekStart: serializeDate(weekStart),
		overlapSummary,
		tonightData,
		templates,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'assign') {
		const submission = parseWithZod(formData, { schema: MealPlanEntrySchema })
		if (submission.status !== 'success') {
			return { status: 'error' as const, submission: submission.reply() }
		}

		const { date, mealType, recipeId, servings } = submission.value

		// Get the meal plan for this week
		const weekStart = getWeekStart(date)
		let mealPlan = await prisma.mealPlan.findFirst({
			where: { householdId, weekStart },
		})

		if (!mealPlan) {
			mealPlan = await prisma.mealPlan.create({
				data: { userId, householdId, weekStart },
			})
		}

		// Check if this exact recipe is already assigned to this slot
		const existing = await prisma.mealPlanEntry.findUnique({
			where: {
				mealPlanId_date_mealType_recipeId: {
					mealPlanId: mealPlan.id,
					date,
					mealType,
					recipeId,
				},
			},
		})

		if (!existing) {
			await prisma.mealPlanEntry.create({
				data: {
					mealPlanId: mealPlan.id,
					date,
					mealType,
					recipeId,
					servings,
				},
			})

			const recipe = await prisma.recipe.findUnique({
				where: { id: recipeId },
				select: { title: true },
			})
			const dayName = new Date(date).toLocaleDateString('en-US', {
				weekday: 'long',
			})
			void emitHouseholdEvent({
				type: 'meal_plan_assigned',
				payload: { title: recipe?.title ?? 'a recipe', day: dayName, mealType },
				userId,
				householdId,
			})

			if (formData.get('fromPairing') === 'true') {
				void trackEvent(userId, householdId, 'pairing_recipe_assigned', {
					recipeId,
					recipeTitle: recipe?.title,
				})
			}
		}

		return { status: 'success' as const }
	}

	if (intent === 'updateServings') {
		const entryId = formData.get('entryId')
		invariantResponse(typeof entryId === 'string', 'Entry ID is required')

		const servingsStr = formData.get('servings')
		const servings = servingsStr
			? Math.min(999, parseInt(String(servingsStr), 10))
			: null

		const entry = await prisma.mealPlanEntry.findFirst({
			where: { id: entryId, mealPlan: { householdId } },
		})
		invariantResponse(entry, 'Entry not found', { status: 404 })

		await prisma.mealPlanEntry.update({
			where: { id: entryId },
			data: { servings: servings && servings > 0 ? servings : null },
		})

		return { status: 'success' as const }
	}

	if (intent === 'toggleCooked') {
		const entryId = formData.get('entryId')
		invariantResponse(typeof entryId === 'string', 'Entry ID is required')

		const entry = await prisma.mealPlanEntry.findFirst({
			where: { id: entryId, mealPlan: { householdId } },
			include: { recipe: { select: { title: true } } },
		})
		invariantResponse(entry, 'Entry not found', { status: 404 })

		await prisma.mealPlanEntry.update({
			where: { id: entryId },
			data: { cooked: !entry.cooked },
		})

		void emitHouseholdEvent({
			type: 'meal_plan_cooked',
			payload: { title: entry.recipe.title, cooked: !entry.cooked },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'remove') {
		const entryId = formData.get('entryId')
		invariantResponse(typeof entryId === 'string', 'Entry ID is required')

		// Verify ownership via meal plan
		const entry = await prisma.mealPlanEntry.findFirst({
			where: {
				id: entryId,
				mealPlan: { householdId },
			},
			include: { recipe: { select: { title: true } } },
		})
		invariantResponse(entry, 'Entry not found', { status: 404 })

		await prisma.mealPlanEntry.delete({ where: { id: entryId } })

		void emitHouseholdEvent({
			type: 'meal_plan_removed',
			payload: { title: entry.recipe.title },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'quickCook') {
		const entryId = formData.get('entryId')
		invariantResponse(typeof entryId === 'string', 'Entry ID is required')

		const entry = await prisma.mealPlanEntry.findFirst({
			where: { id: entryId, mealPlan: { householdId } },
			include: {
				recipe: { select: { id: true, title: true, servings: true } },
			},
		})
		invariantResponse(entry, 'Entry not found', { status: 404 })
		invariantResponse(!entry.cooked, 'Entry already cooked')

		// Mark as cooked
		await prisma.mealPlanEntry.update({
			where: { id: entryId },
			data: { cooked: true },
		})

		// Create cooking log (quick cook — no notes)
		await prisma.cookingLog.create({
			data: {
				recipeId: entry.recipe.id,
				userId,
				cookedAt: new Date(),
			},
		})

		// Subtract ingredients from inventory
		const servingRatio =
			entry.servings && entry.recipe.servings
				? entry.servings / entry.recipe.servings
				: 1
		const inventorySummary = await subtractRecipeIngredientsFromInventory(
			entry.recipe.id,
			householdId,
			servingRatio,
		)

		void emitHouseholdEvent({
			type: 'meal_plan_cooked',
			payload: { title: entry.recipe.title, cooked: true },
			userId,
			householdId,
		})

		void emitHouseholdEvent({
			type: 'cook_logged',
			payload: { recipeId: entry.recipe.id, title: entry.recipe.title },
			userId,
			householdId,
		})

		return {
			status: 'success' as const,
			recipeTitle: entry.recipe.title,
			inventorySummary,
		}
	}

	return { status: 'error' as const }
}

export default function PlanIndex({ loaderData }: Route.ComponentProps) {
	const {
		entries,
		recipes,
		weekDays,
		weekStart,
		overlapSummary,
		tonightData,
		templates,
	} = loaderData

	const prevWeek = serializeDate(getPreviousWeek(parseDate(weekStart)))
	const nextWeek = serializeDate(getNextWeek(parseDate(weekStart)))
	const currentWeek = serializeDate(getCurrentWeekStart())
	const [showSaveTemplate, setShowSaveTemplate] = useState(false)
	const [showApplyTemplate, setShowApplyTemplate] = useState(false)

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="from-card to-background border-border/50 border-b bg-linear-to-b">
				<div className="container flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
					<h1 className="text-2xl font-bold">Meal Plan</h1>
					<div className="flex flex-wrap gap-2">
						{entries.length > 0 && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowSaveTemplate(true)}
							>
								<Icon name="plus" size="sm" />
								Save Template
							</Button>
						)}
						{templates.length > 0 && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowApplyTemplate(true)}
							>
								<Icon name="update" size="sm" />
								Use Template
							</Button>
						)}
						{entries.length > 0 && (
							<Form method="POST" action="/resources/meal-plan-copy-week">
								<input type="hidden" name="weekStart" value={weekStart} />
								<Button type="submit" variant="outline" size="sm">
									<Icon name="arrow-right" size="sm" />
									Copy Week
								</Button>
							</Form>
						)}
						<Button asChild variant="outline" size="sm">
							<Link to="/shopping">
								<Icon name="file-text" size="sm" />
								Shopping List
							</Link>
						</Button>
					</div>
				</div>
			</div>

			<div className="container py-6">
				{/* Week Navigation */}
				<div className="mb-6 flex items-center justify-between">
					<Button asChild variant="ghost" size="sm">
						<Link to={`/plan?weekStart=${prevWeek}`}>
							<Icon name="arrow-left" size="sm" />
							Previous
						</Link>
					</Button>

					<div className="text-center">
						<p className="text-lg font-semibold">
							{formatWeekRange(parseDate(weekStart))}
						</p>
						{weekStart !== currentWeek && (
							<Button asChild variant="link" size="sm">
								<Link to="/plan">This Week</Link>
							</Button>
						)}
					</div>

					<Button asChild variant="ghost" size="sm">
						<Link to={`/plan?weekStart=${nextWeek}`}>
							Next
							<Icon name="arrow-right" size="sm" />
						</Link>
					</Button>
				</div>

				{/* Tonight banner (current week only) */}
				{tonightData &&
					(tonightData.entries.length > 0 || tonightData.suggestion) && (
						<TodayBanner
							entries={tonightData.entries}
							suggestion={tonightData.suggestion}
						/>
					)}

				{/* Overlap summary + recipe suggestions */}
				{overlapSummary && (
					<div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
						<span className="bg-accent text-accent-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
							<Icon name="cookie" size="xs" />
							{overlapSummary.efficiencyPct}% overlap &middot;{' '}
							{overlapSummary.sharedCount} shared ingredients
						</span>
						{overlapSummary.suggestions.length > 0 && (
							<span className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
								Pairs well:
								{overlapSummary.suggestions.map((s, i) => (
									<span key={s.id}>
										<Link
											to={`/recipes/${s.id}`}
											className="text-foreground underline decoration-dotted underline-offset-2"
										>
											{s.title}
										</Link>
										<span className="text-muted-foreground">
											{' '}
											({s.sharedCount})
										</span>
										{i < overlapSummary.suggestions.length - 1 && ', '}
									</span>
								))}
							</span>
						)}
					</div>
				)}

				{/* Empty State Guidance */}
				{entries.length === 0 && (
					<div className="bg-card shadow-warm-lg mb-6 rounded-2xl p-8 text-center">
						<h3 className="font-serif text-xl">Plan Your Week</h3>
						<p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
							Pick recipes for each day, then generate a shopping list with
							everything you need. Tap any slot below to get started.
						</p>
						{recipes.length === 0 ? (
							<Button asChild className="mt-5">
								<Link to="/recipes/new">
									<Icon name="plus" size="sm" />
									Add Your First Recipe
								</Link>
							</Button>
						) : (
							<Button asChild className="mt-5">
								<Link to="/recipes">Browse Recipes</Link>
							</Button>
						)}
					</div>
				)}

				{/* Calendar */}
				<MealPlanCalendar
					weekDays={weekDays}
					entries={entries}
					recipes={recipes}
					weekStart={weekStart}
				/>
			</div>

			{showSaveTemplate && (
				<SaveTemplateModal
					weekStart={weekStart}
					onClose={() => setShowSaveTemplate(false)}
				/>
			)}

			{showApplyTemplate && (
				<ApplyTemplateModal
					templates={templates}
					weekStart={weekStart}
					onClose={() => setShowApplyTemplate(false)}
				/>
			)}
		</div>
	)
}
