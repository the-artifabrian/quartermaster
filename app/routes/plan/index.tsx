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
import { ensureMealPlan } from '#app/utils/meal-plan.server.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/index.ts'
import { createPlanAction } from './plan-action.server.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Meal Plan | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId, isProActive } = await requireUserWithTier(request)
	const url = new URL(request.url)
	const weekStartParam = url.searchParams.get('weekStart')

	const weekStart = weekStartParam
		? getWeekStart(parseDate(weekStartParam))
		: getCurrentWeekStart()

	// Read back by the ensured plan's id — a raw householdId/weekStart lookup
	// cannot see plans whose weekStart is stored in the INTEGER-ms era.
	const ensuredPlan = await ensureMealPlan(prisma, { householdId, weekStart })
	const mealPlan = await prisma.mealPlan.findUniqueOrThrow({
		where: { id: ensuredPlan.id },
		include: {
			// The planner reads Meal parents and ordered items (#105). Within a
			// day the explicit manual order is authoritative — createdAt/id only
			// break ties from concurrent adds.
			meals: {
				orderBy: [
					{ date: 'asc' },
					{ order: 'asc' },
					{ createdAt: 'asc' },
					{ id: 'asc' },
				],
				include: {
					recipeItems: {
						orderBy: { order: 'asc' },
						include: {
							recipe: {
								select: {
									id: true,
									title: true,
									servings: true,
									prepTime: true,
									cookTime: true,
									image: { select: { objectKey: true } },
								},
							},
						},
					},
				},
			},
		},
	})

	// Load user's recipes for the picker (lightweight — no ingredients)
	const recipes = await prisma.recipe.findMany({
		where: { householdId },
		orderBy: { title: 'asc' },
		select: {
			id: true,
			title: true,
			prepTime: true,
			cookTime: true,
			servings: true,
			isFavorite: true,
			image: { select: { objectKey: true } },
		},
	})

	const weekDays = getWeekDays(weekStart)

	const meals = mealPlan.meals.map((meal) => ({
		id: meal.id,
		dateStr: serializeDate(meal.date),
		label: meal.label,
		servingAt: meal.servingAt?.toISOString() ?? null,
		servingTimeZone: meal.servingTimeZone,
		genericText: meal.genericText,
		completed: meal.completed,
		guestCount: meal.guestCount,
		items: meal.recipeItems.map((item) => ({
			id: item.id,
			recipeTitle: item.recipeTitle,
			scaleMultiplier: item.scaleMultiplier,
			cooked: item.cooked,
			recipe: item.recipe,
		})),
	}))

	// Tonight banner data (only for current week)
	const isCurrentWeek =
		serializeDate(weekStart) === serializeDate(getCurrentWeekStart())
	let tonight: {
		label: string | null
		recipe: {
			id: string
			title: string
			prepTime: number | null
			cookTime: number | null
			servings: number
			image: { objectKey: string } | null
		}
		scaleMultiplier: number
		remainingCount: number
	} | null = null

	if (isCurrentWeek) {
		const today = new Date()
		// Local-date string, NOT serializeDate(today): stored Meal dates encode
		// their semantic day in UTC fields, but "today" is the user's local date
		// (same cross-domain convention as isToday). serializeDate(new Date())
		// would shift the banner to the wrong day near midnight in UTC+ zones.
		const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

		// First uncooked Recipe item in the day's manual Meal order — the order
		// the user set is the plan for the day, so the banner follows it.
		const todaysUncooked = meals
			.filter((meal) => meal.dateStr === todayStr)
			.flatMap((meal) =>
				meal.items
					.filter((item) => !item.cooked && item.recipe)
					.map((item) => ({ meal, item })),
			)
		const first = todaysUncooked[0]
		if (first) {
			tonight = {
				label: first.meal.label,
				recipe: first.item.recipe!,
				scaleMultiplier: first.item.scaleMultiplier,
				remainingCount: todaysUncooked.length - 1,
			}
		}
	}

	const shoppingListItemCount = await prisma.shoppingListItem.count({
		where: { list: { householdId } },
	})

	// "Copy Last Week" on empty weeks (C3) needs to know there's something
	// to copy — the copy-week resource 400s on an empty source week.
	const prevWeekMealCount = await prisma.meal.count({
		where: {
			mealPlan: { householdId, weekStart: getPreviousWeek(weekStart) },
		},
	})

	return {
		meals,
		recipes,
		weekDays,
		weekStart: serializeDate(weekStart),
		isCurrentWeek,
		tonight,
		shoppingListItemCount,
		prevWeekHasMeals: prevWeekMealCount > 0,
		isProActive,
	}
}

export const action = createPlanAction(prisma)

export default function PlanIndex({ loaderData }: Route.ComponentProps) {
	const {
		meals,
		recipes,
		weekDays,
		weekStart,
		tonight,
		shoppingListItemCount,
		prevWeekHasMeals,
		isProActive,
	} = loaderData

	const prevWeek = serializeDate(getPreviousWeek(parseDate(weekStart)))
	const nextWeek = serializeDate(getNextWeek(parseDate(weekStart)))
	const currentWeek = serializeDate(getCurrentWeekStart())
	// Hide "Suggest Meals" if the entire week is in the past (Sunday has passed)
	const weekSunday = addDaysUTC(parseDate(weekStart), 6)
	const isWeekPast = isPast(weekSunday)
	const [showSuggest, setShowSuggest] = useState(false)

	const plannedRecipeIds = [
		...new Set(
			meals.flatMap((meal) =>
				meal.items.flatMap((item) => item.recipe?.id ?? []),
			),
		),
	]

	return (
		<div className="pb-20 md:pb-6">
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
						{isProActive && meals.length > 0 && (
							<Form method="POST" action="/resources/meal-plan-copy-week">
								<input type="hidden" name="weekStart" value={weekStart} />
								<Button type="submit" variant="outline" size="sm">
									<Icon name="arrow-right" size="sm" />
									Copy Week
								</Button>
							</Form>
						)}
						{/* Empty week: offer to pull last week's plan forward (C3) —
						    the copy-week resource copies weekStart → weekStart+1, so
						    posting the previous week fills this one */}
						{isProActive &&
							meals.length === 0 &&
							prevWeekHasMeals &&
							!isWeekPast && (
								<Form method="POST" action="/resources/meal-plan-copy-week">
									<input type="hidden" name="weekStart" value={prevWeek} />
									<Button type="submit" variant="outline" size="sm">
										<Icon name="arrow-right" size="sm" />
										Copy Last Week
									</Button>
								</Form>
							)}
					</div>
				</div>

				{/* Week Navigation */}
				<div className="mt-4 flex items-center justify-between">
					<Button asChild variant="ghost" size="icon" className="rounded-full">
						<Link to={`/plan?weekStart=${prevWeek}`} aria-label="Previous week">
							<Icon name="arrow-left" size="sm" />
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

					<Button asChild variant="ghost" size="icon" className="rounded-full">
						<Link to={`/plan?weekStart=${nextWeek}`} aria-label="Next week">
							<Icon name="arrow-right" size="sm" />
						</Link>
					</Button>
				</div>
			</div>

			<div className="container-grid">
				{/* Tonight banner (current week with an uncooked meal planned today) */}
				{tonight && <TodayBanner tonight={tonight} />}

				{/* Empty week */}
				{meals.length === 0 && (
					<div className="mb-6 py-6 text-center">
						<h2 className="font-serif text-xl">Plan your week</h2>
						<p className="text-muted-foreground mx-auto mt-1.5 max-w-md text-sm">
							Pick recipes for the days ahead and we'll build the shopping list.
							Tap any day below to get started.
						</p>
						{recipes.length === 0 ? (
							<Button asChild variant="outline" className="mt-4">
								<Link to="/recipes/new">
									<Icon name="plus" size="sm" />
									Add Your First Recipe
								</Link>
							</Button>
						) : (
							<Button asChild variant="outline" className="mt-4">
								<Link to="/recipes">Browse Recipes</Link>
							</Button>
						)}
					</div>
				)}

				{/* Calendar */}
				<MealPlanCalendar weekDays={weekDays} meals={meals} recipes={recipes} />

				{meals.length > 0 && shoppingListItemCount === 0 && (
					<OnboardingNudge
						nudgeId="generate-shopping-list"
						icon="cart"
						title="Generate your shopping list"
						description="Head to the shopping list to see what you need to buy. Pantry items are pre-checked so you can skip them."
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
					plannedRecipeIds={plannedRecipeIds}
					onClose={() => setShowSuggest(false)}
				/>
			)}
		</div>
	)
}
