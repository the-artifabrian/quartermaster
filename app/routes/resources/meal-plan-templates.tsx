import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { addDays, differenceInCalendarDays } from 'date-fns'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import {
	getWeekStart,
	parseDate,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	SaveTemplateSchema,
	ApplyTemplateSchema,
	DeleteTemplateSchema,
} from '#app/utils/meal-template-validation.ts'
import { type Route } from './+types/meal-plan-templates.ts'

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'saveTemplate') {
		const submission = parseWithZod(formData, { schema: SaveTemplateSchema })
		if (submission.status !== 'success') {
			return { status: 'error' as const }
		}

		const { name, weekStart: weekStartStr } = submission.value
		const weekStart = getWeekStart(parseDate(weekStartStr))

		const mealPlan = await prisma.mealPlan.findFirst({
			where: { householdId, weekStart },
			include: { entries: true },
		})
		invariantResponse(
			mealPlan && mealPlan.entries.length > 0,
			'No entries to save as template',
		)

		const template = await prisma.mealPlanTemplate.create({
			data: {
				name,
				userId,
				householdId,
				entries: {
					create: mealPlan.entries.map((entry) => ({
						dayOfWeek: differenceInCalendarDays(
							new Date(entry.date),
							weekStart,
						),
						mealType: entry.mealType,
						recipeId: entry.recipeId,
						servings: entry.servings,
					})),
				},
			},
		})

		void emitHouseholdEvent({
			type: 'meal_plan_template_saved',
			payload: { name: template.name },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'applyTemplate') {
		const submission = parseWithZod(formData, {
			schema: ApplyTemplateSchema,
		})
		if (submission.status !== 'success') {
			return { status: 'error' as const }
		}

		const { templateId, weekStart: weekStartStr } = submission.value
		const weekStart = getWeekStart(parseDate(weekStartStr))

		const template = await prisma.mealPlanTemplate.findFirst({
			where: { id: templateId, householdId },
			include: { entries: true },
		})
		invariantResponse(template, 'Template not found', { status: 404 })

		// Get or create meal plan for this week
		let mealPlan = await prisma.mealPlan.findFirst({
			where: { householdId, weekStart },
		})

		if (!mealPlan) {
			mealPlan = await prisma.mealPlan.create({
				data: { userId, householdId, weekStart },
			})
		}

		// Create entries from template, skipping duplicates (same pattern as copyWeek)
		// Use serializeDate+new Date to produce UTC midnight dates, matching how
		// the assign action stores dates via z.coerce.date()
		for (const tEntry of template.entries) {
			const entryDate = new Date(
				serializeDate(addDays(weekStart, tEntry.dayOfWeek)),
			)
			const existing = await prisma.mealPlanEntry.findUnique({
				where: {
					mealPlanId_date_mealType_recipeId: {
						mealPlanId: mealPlan.id,
						date: entryDate,
						mealType: tEntry.mealType,
						recipeId: tEntry.recipeId,
					},
				},
			})
			if (!existing) {
				await prisma.mealPlanEntry.create({
					data: {
						mealPlanId: mealPlan.id,
						date: entryDate,
						mealType: tEntry.mealType,
						recipeId: tEntry.recipeId,
						servings: tEntry.servings,
					},
				})
			}
		}

		void emitHouseholdEvent({
			type: 'meal_plan_template_applied',
			payload: { name: template.name },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'deleteTemplate') {
		const submission = parseWithZod(formData, {
			schema: DeleteTemplateSchema,
		})
		if (submission.status !== 'success') {
			return { status: 'error' as const }
		}

		const { templateId } = submission.value

		const template = await prisma.mealPlanTemplate.findFirst({
			where: { id: templateId, householdId },
		})
		invariantResponse(template, 'Template not found', { status: 404 })

		await prisma.mealPlanTemplate.delete({
			where: { id: templateId },
		})

		return { status: 'success' as const }
	}

	return { status: 'error' as const }
}
