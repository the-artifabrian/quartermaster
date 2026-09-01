import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link } from 'react-router'
import { MealPlanCalendar } from '#app/components/meal-plan-calendar.tsx'
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
import {
	buildShoppingDemand,
	demandFingerprint,
} from '#app/utils/shopping-demand.server.ts'
import {
	annotateShoppingDemand,
	loadShoppingAvailability,
} from '#app/utils/shopping-list.server.ts'
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
									ingredients: {
										select: {
											name: true,
											amount: true,
											unit: true,
											isHeading: true,
											notes: true,
										},
									},
								},
							},
						},
					},
					shoppingContributions: {
						select: {
							canonicalName: true,
							name: true,
							quantity: true,
							unit: true,
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
			totalTime: true,
			yieldAmount: true,
			yieldLabel: true,
			isFavorite: true,
			image: { select: { objectKey: true } },
		},
	})

	const weekDays = getWeekDays(weekStart)
	const shoppingAvailability = await loadShoppingAvailability(
		prisma,
		householdId,
	)

	const meals = mealPlan.meals.map((meal) => {
		// Stored contribution fields are the last-added demand fingerprint. Build
		// the same currently annotated demand again. Ingredient, multiplier,
		// composition, note-line, and household Staple/Out changes may mark it
		// stale, but only a later explicit refresh mutates Shopping.
		const freshDemand = annotateShoppingDemand(
			buildShoppingDemand({
				recipeBatches: meal.recipeItems.flatMap((item) =>
					item.recipe
						? [
								{
									ingredients: item.recipe.ingredients,
									scaleMultiplier: item.scaleMultiplier,
								},
							]
						: [],
				),
				noteLines: meal.noteItems.flatMap((item) => item.shoppingLines),
			}),
			shoppingAvailability,
		).lines
		const hasStoredDemand = meal.shoppingContributions.length > 0
		const demandChanged =
			demandFingerprint(freshDemand) !==
			demandFingerprint(meal.shoppingContributions)
		const hasMissingRecipe = meal.recipeItems.some(
			(item) => item.recipe == null,
		)
		const shoppingDemandStatus = !hasStoredDemand
			? ('not-added' as const)
			: !demandChanged
				? ('current' as const)
				: hasMissingRecipe
					? ('blocked' as const)
					: ('stale' as const)

		return {
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
			shoppingDemandStatus,
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
		}
	})

	const shoppingListItemCount = await prisma.shoppingListItem.count({
		where: { list: { householdId } },
	})

	return {
		meals,
		recipes,
		weekDays,
		weekStart: serializeDate(weekStart),
		shoppingListItemCount,
	}
}

export const action = createPlanAction(prisma)

export default function PlanIndex({ loaderData }: Route.ComponentProps) {
	const { meals, recipes, weekDays, weekStart, shoppingListItemCount } =
		loaderData

	const prevWeek = serializeDate(getPreviousWeek(parseDate(weekStart)))
	const nextWeek = serializeDate(getNextWeek(parseDate(weekStart)))
	const currentWeek = serializeDate(getCurrentWeekStart())

	return (
		<div className="pb-20 md:pb-6">
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
				<MealPlanCalendar
					key={weekStart}
					weekDays={weekDays}
					meals={meals}
					recipes={recipes}
				/>

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
