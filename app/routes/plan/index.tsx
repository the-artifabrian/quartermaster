import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link, type ShouldRevalidateFunctionArgs } from 'react-router'
import { MealPlanCalendar } from '#app/components/meal-plan-calendar.tsx'
import { OfflineErrorBoundary } from '#app/components/offline-error-boundary.tsx'
import { OnboardingNudge } from '#app/components/onboarding-nudge.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
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
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { ensureMealPlan } from '#app/utils/meal-plan.server.ts'
import { staleWhileRevalidate } from '#app/utils/loader-cache.ts'
import {
	PLAN_VIEW_ONLY_PARAMS,
	planShouldRevalidate,
} from '#app/utils/plan-day-param.ts'
import { useStaleRevalidate } from '#app/utils/use-stale-revalidate.ts'
import { type Route } from './+types/index.ts'
import { createPlanAction } from './plan-action.server.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Meal Plan | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
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
					// The live reference only names where the snapshot came from — all
					// displayed structure below is the Meal's own frozen copy (#107).
					sourceMenu: { select: { id: true, title: true } },
					sections: {
						orderBy: { order: 'asc' },
						select: { id: true, name: true },
					},
					noteItems: {
						orderBy: { order: 'asc' },
						select: {
							id: true,
							text: true,
							order: true,
							sectionId: true,
							shoppingLines: {
								orderBy: { order: 'asc' },
								select: { id: true, name: true, quantity: true, unit: true },
							},
						},
					},
					recipeItems: {
						orderBy: { order: 'asc' },
						include: {
							recipe: {
								select: {
									id: true,
									title: true,
									yieldAmount: true,
									yieldLabel: true,
									totalTime: true,
									image: { select: { objectKey: true } },
								},
							},
						},
					},
					// One row is enough to know the Meal is on Shopping.
					shoppingContributions: { select: { id: true }, take: 1 },
				},
			},
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
		sourceMenu: meal.sourceMenu,
		sections: meal.sections,
		noteItems: meal.noteItems,
		addedToShopping: meal.shoppingContributions.length > 0,
		items: meal.recipeItems.map((item) => ({
			id: item.id,
			recipeTitle: item.recipeTitle,
			scaleMultiplier: item.scaleMultiplier,
			cooked: item.cooked,
			note: item.note,
			order: item.order,
			sectionId: item.sectionId,
			recipe: item.recipe
				? {
						id: item.recipe.id,
						title: item.recipe.title,
						yieldAmount: item.recipe.yieldAmount,
						yieldLabel: item.recipe.yieldLabel,
						totalTime: item.recipe.totalTime,
						image: item.recipe.image,
					}
				: null,
		})),
	}))

	const shoppingListItemCount = await prisma.shoppingListItem.count({
		where: { list: { householdId } },
	})

	return {
		meals,
		weekDays,
		weekStart: serializeDate(weekStart),
		planScope: `${householdId}:${serializeDate(weekStart)}`,
		shoppingListItemCount,
	}
}

export const action = createPlanAction(prisma)

export const ErrorBoundary = OfflineErrorBoundary

// Shows the last data for this URL at once on a navigation and revalidates
// behind it; see loader-cache.ts.
export async function clientLoader(args: Route.ClientLoaderArgs) {
	return staleWhileRevalidate(args, { viewOnlyParams: PLAN_VIEW_ONLY_PARAMS })
}
clientLoader.hydrate = false as const

// Picking a day only sets the URL's `day` and drops a Meal link's `mealId`;
// the loaded week stays.
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
	return planShouldRevalidate(args)
}

export default function PlanIndex({ loaderData }: Route.ComponentProps) {
	useStaleRevalidate(loaderData, { viewOnlyParams: PLAN_VIEW_ONLY_PARAMS })
	const { meals, weekDays, weekStart, planScope, shoppingListItemCount } =
		loaderData

	const prevWeek = serializeDate(getPreviousWeek(parseDate(weekStart)))
	const nextWeek = serializeDate(getNextWeek(parseDate(weekStart)))
	const currentWeek = serializeDate(getCurrentWeekStart())

	return (
		<div className="pb-[calc(var(--bottom-nav-h)+1rem+var(--bottom-nav-inset))] md:pb-6">
			<div className="container-grid py-4">
				<h1 className="font-serif text-2xl">Meal Plan</h1>

				{/* Week Navigation */}
				<div className="mx-auto mt-4 flex max-w-2xl items-center justify-between">
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
				<MealPlanCalendar key={planScope} weekDays={weekDays} meals={meals} />

				{meals.length > 0 && shoppingListItemCount === 0 && (
					<OnboardingNudge
						nudgeId="generate-shopping-list"
						icon="cart"
						title="Generate your shopping list"
						description="Head to the shopping list when you're ready. Your list changes only when you generate or refresh it."
						ctaText="Go to Shopping List"
						ctaHref="/shopping"
						className="mt-4"
					/>
				)}
			</div>
		</div>
	)
}
