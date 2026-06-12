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
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Meal Plan | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId, isProActive } =
		await requireUserWithTier(request)
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
							// ingredients intentionally omitted — the calendar/slot card
							// only render recipe id/title/servings/time/image, never
							// ingredients. (This is the hot path: it runs on every load of
							// an existing week's plan, so the over-fetch was shipped on the
							// wire for every planned entry.)
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
								// ingredients intentionally omitted — see the findFirst branch
								// above. (This create branch only runs for a brand-new, empty
								// week, so it has no entries anyway.)
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
	let tonightEntries: Array<{
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
	}> = []

	if (isCurrentWeek) {
		const today = new Date()
		const hour = today.getHours()
		// Local-date string, NOT serializeDate(today): stored entry dates encode
		// their semantic day in UTC fields, but "today" is the user's local date
		// (same cross-domain convention as isToday). serializeDate(new Date())
		// would shift the banner to the wrong day near midnight in UTC+ zones.
		const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

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

		tonightEntries = mealPlan.entries
			.filter((e) => serializeDate(new Date(e.date)) === todayStr && !e.cooked)
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
	}

	const shoppingListItemCount = await prisma.shoppingListItem.count({
		where: { list: { householdId } },
	})

	// "Copy Last Week" on empty weeks (C3) needs to know there's something
	// to copy — the copy-week resource 400s on an empty source week.
	const prevWeekEntryCount = await prisma.mealPlanEntry.count({
		where: {
			mealPlan: { householdId, weekStart: getPreviousWeek(weekStart) },
		},
	})

	return {
		// `mealPlan` itself is not returned — the component reads `entries`
		// (mapped below); returning the whole object duplicated every entry on the wire.
		entries: mealPlan.entries.map((entry) => ({
			...entry,
			date: new Date(entry.date),
		})),
		recipes,
		weekDays,
		weekStart: serializeDate(weekStart),
		isCurrentWeek,
		tonightEntries,
		shoppingListItemCount,
		prevWeekHasEntries: prevWeekEntryCount > 0,
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
		// The form submits the target state rather than asking the server to
		// flip, so duplicate/rapid submissions are idempotent (last write wins).
		const cooked = formData.get('cooked') === 'true'

		const entry = await prisma.mealPlanEntry.findFirst({
			where: { id: entryId, mealPlan: { householdId } },
		})
		invariantResponse(entry, 'Entry not found', { status: 404 })

		await prisma.mealPlanEntry.update({
			where: { id: entryId },
			data: { cooked },
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

	return { status: 'error' as const }
}

export default function PlanIndex({ loaderData }: Route.ComponentProps) {
	const {
		entries,
		recipes,
		weekDays,
		weekStart,
		tonightEntries,
		shoppingListItemCount,
		prevWeekHasEntries,
		isProActive,
	} = loaderData

	const prevWeek = serializeDate(getPreviousWeek(parseDate(weekStart)))
	const nextWeek = serializeDate(getNextWeek(parseDate(weekStart)))
	const currentWeek = serializeDate(getCurrentWeekStart())
	// Hide "Suggest Meals" if the entire week is in the past (Sunday has passed)
	const weekSunday = addDaysUTC(parseDate(weekStart), 6)
	const isWeekPast = isPast(weekSunday)
	const [showSuggest, setShowSuggest] = useState(false)

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
						{isProActive && entries.length > 0 && (
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
							entries.length === 0 &&
							prevWeekHasEntries &&
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
				{/* Tonight banner (current week with uncooked meals planned today) */}
				{tonightEntries.length > 0 && <TodayBanner entries={tonightEntries} />}

				{/* Empty week */}
				{entries.length === 0 && (
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
					existingEntries={entries}
					onClose={() => setShowSuggest(false)}
				/>
			)}
		</div>
	)
}
