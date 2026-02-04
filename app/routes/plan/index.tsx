import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link, redirect } from 'react-router'
import { MealPlanCalendar } from '#app/components/meal-plan-calendar.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
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
import { MealPlanEntrySchema } from '#app/utils/meal-plan-validation.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const url = new URL(request.url)
	const weekStartParam = url.searchParams.get('weekStart')

	const weekStart = weekStartParam
		? getWeekStart(parseDate(weekStartParam))
		: getCurrentWeekStart()

	// Get or create meal plan for this week
	let mealPlan = await prisma.mealPlan.findFirst({
		where: {
			userId,
			weekStart,
		},
		include: {
			entries: {
				include: {
					recipe: true,
				},
			},
		},
	})

	if (!mealPlan) {
		mealPlan = await prisma.mealPlan.create({
			data: {
				userId,
				weekStart,
			},
			include: {
				entries: {
					include: {
						recipe: true,
					},
				},
			},
		})
	}

	// Load user's recipes for selection
	const recipes = await prisma.recipe.findMany({
		where: { userId },
		orderBy: { title: 'asc' },
	})

	const weekDays = getWeekDays(weekStart)

	return {
		mealPlan,
		entries: mealPlan.entries.map(entry => ({
			...entry,
			date: new Date(entry.date),
		})),
		recipes,
		weekDays,
		weekStart: serializeDate(weekStart),
	}
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'assign') {
		const submission = parseWithZod(formData, { schema: MealPlanEntrySchema })
		if (submission.status !== 'success') {
			return { status: 'error' as const, submission: submission.reply() }
		}

		const { date, mealType, recipeId } = submission.value

		// Get the meal plan for this week
		const weekStart = getWeekStart(date)
		let mealPlan = await prisma.mealPlan.findFirst({
			where: { userId, weekStart },
		})

		if (!mealPlan) {
			mealPlan = await prisma.mealPlan.create({
				data: { userId, weekStart },
			})
		}

		// Create or update the meal plan entry
		await prisma.mealPlanEntry.upsert({
			where: {
				mealPlanId_date_mealType: {
					mealPlanId: mealPlan.id,
					date,
					mealType,
				},
			},
			create: {
				mealPlanId: mealPlan.id,
				date,
				mealType,
				recipeId,
			},
			update: {
				recipeId,
			},
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
				mealPlan: { userId },
			},
		})
		invariantResponse(entry, 'Entry not found', { status: 404 })

		await prisma.mealPlanEntry.delete({ where: { id: entryId } })

		return { status: 'success' as const }
	}

	return { status: 'error' as const }
}

export default function PlanIndex({ loaderData }: Route.ComponentProps) {
	const { entries, recipes, weekDays, weekStart } = loaderData

	const prevWeek = serializeDate(getPreviousWeek(parseDate(weekStart)))
	const nextWeek = serializeDate(getNextWeek(parseDate(weekStart)))
	const currentWeek = serializeDate(getCurrentWeekStart())

	return (
		<div className="container py-6 pb-20 md:pb-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-bold">Meal Plan</h1>
				<Button asChild variant="outline">
					<Link to="/plan/shopping-list">
						<Icon name="file-text" size="sm" />
						Shopping List
					</Link>
				</Button>
			</div>

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

			{/* Calendar */}
			<MealPlanCalendar
				weekDays={weekDays}
				entries={entries}
				recipes={recipes}
			/>
		</div>
	)
}
