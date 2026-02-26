import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useState } from 'react'
import { Form, Link } from 'react-router'
import { MealPlanCalendar } from '#app/components/meal-plan-calendar.tsx'
import { OnboardingNudge } from '#app/components/onboarding-nudge.tsx'
import { SuggestMealsModal } from '#app/components/suggest-meals-modal.tsx'
import { TodayBanner } from '#app/components/today-banner.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	addDaysUTC,
	getCurrentWeekStart,
	getWeekDays,
	getWeekStart,
	formatWeekRange,
	getNextWeek,
	getPreviousWeek,
	isPast,
	parseDate,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { MealPlanEntrySchema } from '#app/utils/meal-plan-validation.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'
import { UncookedMealReminder } from '#app/components/uncooked-meal-reminder.tsx'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Meal Plan | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId, isProActive } = await requireUserWithTier(request)
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

	// Load user's recipes for the picker (lightweight — no ingredients)
	const recipes = await prisma.recipe.findMany({
		where: { householdId },
		orderBy: { title: 'asc' },
		select: {
			id: true,
			title: true,
			description: true,
			prepTime: true,
			cookTime: true,
			servings: true,
			isFavorite: true,
			image: { select: { objectKey: true } },
		},
	})

	const weekDays = getWeekDays(weekStart)

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
			.filter(
				(e) =>
					serializeDate(new Date(e.date)) === serializeDate(today) && !e.cooked,
			)
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

		// Check if today had meals that are now all cooked
		const hasCookedEntriesToday = mealPlan.entries.some(
			(e) =>
				serializeDate(new Date(e.date)) === serializeDate(today) &&
				e.cooked,
		)

		let suggestion = null
		if (tonightEntries.length === 0 && !hasCookedEntriesToday) {
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

	const shoppingListItemCount = await prisma.shoppingListItem.count({
		where: { list: { householdId } },
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
		isCurrentWeek,
		tonightData,
		shoppingListItemCount,
		isProActive,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithTier(request)
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

		}

		return { status: 'success' as const }
	}

	if (intent === 'updateServings') {
		const entryId = formData.get('entryId')
		invariantResponse(typeof entryId === 'string', 'Entry ID is required')

		const servingsStr = formData.get('servings')
		const servings = servingsStr
			? Math.min(999, Math.max(1, parseInt(String(servingsStr), 10)))
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
		})
		invariantResponse(entry, 'Entry not found', { status: 404 })

		await prisma.mealPlanEntry.update({
			where: { id: entryId },
			data: { cooked: !entry.cooked },
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
		})
		invariantResponse(entry, 'Entry not found', { status: 404 })

		await prisma.mealPlanEntry.delete({ where: { id: entryId } })

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

		return {
			status: 'success' as const,
			recipeTitle: entry.recipe.title,
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
		isCurrentWeek,
		tonightData,
		shoppingListItemCount,
		isProActive,
	} = loaderData

	const prevWeek = serializeDate(getPreviousWeek(parseDate(weekStart)))
	const nextWeek = serializeDate(getNextWeek(parseDate(weekStart)))
	const currentWeek = serializeDate(getCurrentWeekStart())
	// Hide "Suggest Meals" if the entire week is in the past (Sunday has passed)
	const weekSunday = addDaysUTC(parseDate(weekStart), 6)
	const isWeekPast = isPast(weekSunday)
	const [showSuggest, setShowSuggest] = useState(false)
	const [bannerDismissed, setBannerDismissed] = useState(false)

	return (
		<div className="pb-20 md:pb-6">
			<UncookedMealReminder />

			{/* Page Header */}
			<div className="container-grid py-4">
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<h1 className="font-serif text-2xl">Meal Plan</h1>
					<div className="flex flex-wrap gap-2">
						{isProActive && !isWeekPast && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowSuggest(true)}
							>
								<Icon name="sparkles" size="sm" />
								Suggest Meals
							</Button>
						)}
						{isProActive && entries.length > 0 && (
							<Form method="POST" action="/resources/meal-plan-copy-week">
								<input type="hidden" name="weekStart" value={weekStart} />
								<Button type="submit" variant="outline" size="sm">
									<Icon name="arrow-right" size="sm" />
									Copy Week
								</Button>
							</Form>
						)}
					</div>
				</div>

				{/* Week Navigation */}
				<div className="mt-4 flex items-center justify-between">
					<Button asChild variant="ghost" size="sm">
						<Link to={`/plan?weekStart=${prevWeek}`}>
							<Icon name="arrow-left" size="sm" />
							Previous
						</Link>
					</Button>

					<div className="text-center">
						<p className="font-serif text-lg">
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
			</div>

			<div className="container-grid">
				{/* Tonight banner (current week only) */}
				{tonightData &&
					(tonightData.entries.length > 0 || tonightData.suggestion) && (
						<TodayBanner
							entries={tonightData.entries}
							suggestion={tonightData.suggestion}
							dismissed={bannerDismissed}
							onDismiss={() => setBannerDismissed(true)}
						/>
					)}

				{/* Empty State Guidance */}
				{entries.length === 0 && (
					<div className="bg-card shadow-warm-lg mb-4 rounded-2xl p-6 text-center">
						<h2 className="font-serif text-xl">Plan Your Week</h2>
						<p className="text-muted-foreground mx-auto mt-1.5 max-w-md text-sm">
							Pick recipes for the days ahead and generate a shopping list
							with what you need to buy. Tap any slot below to get
							started.
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
				/>

				{entries.length > 0 && shoppingListItemCount === 0 && (
					<OnboardingNudge
						nudgeId="generate-shopping-list"
						icon="cart"
						title="Generate your shopping list"
						description="Head to the shopping list to see exactly what you need to buy — items you already have are pre-checked so you can skip them."
						ctaText="Go to Shopping List"
						ctaHref="/shopping"
						className="mt-4"
					/>
				)}
			</div>

			{showSuggest && (
				<SuggestMealsModal
					weekStart={weekStart}
					recipes={recipes}
					existingEntries={entries}
					onClose={() => setShowSuggest(false)}
				/>
			)}

		</div>
	)
}
