import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useLayoutEffect, useRef } from 'react'
import {
	Link,
	type ShouldRevalidateFunctionArgs,
	useNavigate,
} from 'react-router'
import { MealPlanCalendar } from '#app/components/meal-plan-calendar.tsx'
import { TitleRow } from '#app/components/ui/title-add-button.tsx'
import { OfflineErrorBoundary } from '#app/components/offline-error-boundary.tsx'
import { OnboardingNudge } from '#app/components/onboarding-nudge.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	getWeekDays,
	getWeekStart,
	loadedToday,
	formatWeekRange,
	getNextWeek,
	getPreviousWeek,
	parseDate,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { ensureMealPlan } from '#app/utils/meal-plan.server.ts'
import {
	getRequestToday,
	getRequestWeekStart,
} from '#app/utils/today.server.ts'
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
	return [{ title: 'Plan | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	// Plan uses the browser's day to pick the week and mark Today.
	const today = getRequestToday(request)
	const weekStart = getRequestWeekStart(request, today)

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
		today,
		planScope: `${householdId}:${serializeDate(weekStart)}`,
		shoppingListItemCount,
	}
}

export const action = createPlanAction(prisma)

/**
 * Adding a Recipe closes the picker before the server answers, so a failed add
 * comes back as an error result its caller can report. Any other failure still
 * goes to the error boundary.
 */
export async function clientAction({
	request,
	serverAction,
}: Route.ClientActionArgs) {
	const intent = (await request.clone().formData()).get('intent')
	try {
		return await serverAction()
	} catch (error) {
		// A redirect, such as to log in after the session expired, still goes.
		if (error instanceof Response || intent !== 'addMeal') throw error
		return { status: 'error' as const }
	}
}

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
	const today = loadedToday(loaderData.today)

	const prevWeek = serializeDate(getPreviousWeek(parseDate(weekStart)))
	const nextWeek = serializeDate(getNextWeek(parseDate(weekStart)))
	const currentWeek = serializeDate(getWeekStart(parseDate(today)))
	const navigate = useNavigate()
	// The week links render in the calendar's header, which is keyed by its
	// week, so turning the week remounts them. The link that had focus gets
	// it back, so the keyboard and VoiceOver keep their place.
	const weekLinkFocus = useRef<string | null>(null)
	useLayoutEffect(() => {
		const label = weekLinkFocus.current
		weekLinkFocus.current = null
		if (!label) return
		if (document.activeElement && document.activeElement !== document.body)
			return
		document
			.querySelector<HTMLElement>(`a[aria-label="${label}"]`)
			?.focus({ preventScroll: true })
	}, [weekStart])
	const keepWeekLinkFocus = (event: React.MouseEvent<HTMLAnchorElement>) => {
		if (event.currentTarget === document.activeElement) {
			weekLinkFocus.current = event.currentTarget.getAttribute('aria-label')
		}
	}

	return (
		<div className="pb-[calc(var(--bottom-nav-h)+1rem+var(--bottom-nav-inset))] md:pb-6">
			<div className="container-grid">
				<MealPlanCalendar
					key={planScope}
					weekDays={weekDays}
					meals={meals}
					today={today}
					onSwipeWeek={(direction) =>
						void navigate(
							`/plan?weekStart=${direction === 'previous' ? prevWeek : nextWeek}`,
						)
					}
					renderHeader={(titleAction) => (
						<div className="py-4">
							<TitleRow>
								<h1 className="font-serif text-2xl">Plan</h1>
								{titleAction}
							</TitleRow>

							{/* Week Navigation: the chevrons sit on the content edges on a
							    phone; on a wide screen the three keep together at the left,
							    over the agenda's edge. */}
							<div className="mt-4 flex items-center justify-between md:justify-start md:gap-2">
								<Button
									asChild
									variant="ghost"
									size="icon"
									className="-ml-3 rounded-full"
								>
									<Link
										to={`/plan?weekStart=${prevWeek}`}
										aria-label="Previous week"
										onClick={keepWeekLinkFocus}
									>
										<Icon name="chevron-left" size="md" />
									</Link>
								</Button>

								<div className="text-center">
									<p className="font-serif text-lg">
										{formatWeekRange(parseDate(weekStart), today)}
									</p>
									{weekStart !== currentWeek && (
										<Button asChild variant="link" size="sm">
											<Link to="/plan">This week</Link>
										</Button>
									)}
								</div>

								<Button
									asChild
									variant="ghost"
									size="icon"
									className="-mr-3 rounded-full md:mr-0"
								>
									<Link
										to={`/plan?weekStart=${nextWeek}`}
										aria-label="Next week"
										onClick={keepWeekLinkFocus}
									>
										<Icon name="chevron-right" size="md" />
									</Link>
								</Button>
							</div>
						</div>
					)}
				/>

				{meals.length > 0 && shoppingListItemCount === 0 && (
					<OnboardingNudge
						nudgeId="generate-shopping-list"
						icon="cart"
						title="Shop for these Meals"
						description="On Shopping, open From Plan and pick the Meals you're shopping for."
						ctaText="Go to Shopping"
						ctaHref="/shopping"
						className="mt-4"
					/>
				)}
			</div>
		</div>
	)
}
