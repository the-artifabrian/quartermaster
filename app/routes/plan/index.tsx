import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { addDays } from 'date-fns'
import { Form, Link, redirect } from 'react-router'
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
		entries: mealPlan.entries.map((entry) => ({
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

		const { date, mealType, recipeId, servings } = submission.value

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
		const servings = servingsStr ? parseInt(String(servingsStr), 10) : null

		const entry = await prisma.mealPlanEntry.findFirst({
			where: { id: entryId, mealPlan: { userId } },
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
			where: { id: entryId, mealPlan: { userId } },
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
				mealPlan: { userId },
			},
		})
		invariantResponse(entry, 'Entry not found', { status: 404 })

		await prisma.mealPlanEntry.delete({ where: { id: entryId } })

		return { status: 'success' as const }
	}

	if (intent === 'copyWeek') {
		const weekStartStr = formData.get('weekStart')
		invariantResponse(
			typeof weekStartStr === 'string',
			'Week start is required',
		)

		const weekStart = getWeekStart(parseDate(weekStartStr))
		const mealPlan = await prisma.mealPlan.findFirst({
			where: { userId, weekStart },
			include: { entries: true },
		})
		invariantResponse(mealPlan && mealPlan.entries.length > 0, 'No entries to copy')

		const nextWeekStart = getNextWeek(weekStart)

		// Get or create next week's meal plan
		let nextMealPlan = await prisma.mealPlan.findFirst({
			where: { userId, weekStart: nextWeekStart },
		})

		if (!nextMealPlan) {
			nextMealPlan = await prisma.mealPlan.create({
				data: { userId, weekStart: nextWeekStart },
			})
		}

		// Duplicate entries with dates shifted +7 days
		for (const entry of mealPlan.entries) {
			const newDate = addDays(new Date(entry.date), 7)
			const existing = await prisma.mealPlanEntry.findUnique({
				where: {
					mealPlanId_date_mealType_recipeId: {
						mealPlanId: nextMealPlan.id,
						date: newDate,
						mealType: entry.mealType,
						recipeId: entry.recipeId,
					},
				},
			})
			if (!existing) {
				await prisma.mealPlanEntry.create({
					data: {
						mealPlanId: nextMealPlan.id,
						date: newDate,
						mealType: entry.mealType,
						recipeId: entry.recipeId,
						servings: entry.servings,
					},
				})
			}
		}

		return redirect(`/plan?weekStart=${serializeDate(nextWeekStart)}`)
	}

	return { status: 'error' as const }
}

export default function PlanIndex({ loaderData }: Route.ComponentProps) {
	const { entries, recipes, weekDays, weekStart } = loaderData

	const prevWeek = serializeDate(getPreviousWeek(parseDate(weekStart)))
	const nextWeek = serializeDate(getNextWeek(parseDate(weekStart)))
	const currentWeek = serializeDate(getCurrentWeekStart())

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="bg-muted/30">
				<div className="container flex items-center justify-between py-6">
					<div>
						<h1 className="text-2xl font-bold">Meal Plan</h1>
						<p className="text-muted-foreground mt-1 text-sm">
							Plan your week
						</p>
					</div>
					<div className="flex gap-2">
						{entries.length > 0 && (
							<Form method="POST">
								<input type="hidden" name="intent" value="copyWeek" />
								<input type="hidden" name="weekStart" value={weekStart} />
								<Button type="submit" variant="outline">
									<Icon name="update" size="sm" />
									Copy to Next Week
								</Button>
							</Form>
						)}
						<Button asChild variant="outline">
							<Link to="/plan/shopping-list">
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

			{/* Calendar */}
			<MealPlanCalendar
				weekDays={weekDays}
				entries={entries}
				recipes={recipes}
			/>
			</div>
		</div>
	)
}
