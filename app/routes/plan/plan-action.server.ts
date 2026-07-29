import { parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { getWeekStart } from '#app/utils/date.ts'
import { MealPlanEntrySchema } from '#app/utils/meal-plan-validation.ts'
import {
	ensureMealPlan,
	ensureMealPlanEntry,
} from '#app/utils/meal-plan.server.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'

type PlanActionUser = Pick<
	Awaited<ReturnType<typeof requireUserWithTier>>,
	'householdId'
>

export function createPlanAction(
	db: PrismaClient,
	requirePlanUser: (
		request: Request,
	) => Promise<PlanActionUser> = requireUserWithTier,
) {
	return async function planAction({ request }: { request: Request }) {
		const { householdId } = await requirePlanUser(request)
		const formData = await request.formData()
		const intent = formData.get('intent')

		if (intent === 'assign') {
			const submission = parseWithZod(formData, { schema: MealPlanEntrySchema })
			if (submission.status !== 'success') {
				return { status: 'error' as const, submission: submission.reply() }
			}

			const { date, mealType, recipeId, servings } = submission.value
			const weekStart = getWeekStart(date)
			const mealPlan = await ensureMealPlan(db, { householdId, weekStart })

			await ensureMealPlanEntry(db, {
				mealPlanId: mealPlan.id,
				date,
				mealType,
				recipeId,
				servings,
			})

			return { status: 'success' as const }
		}

		if (intent === 'updateServings') {
			const entryId = formData.get('entryId')
			invariantResponse(typeof entryId === 'string', 'Entry ID is required')

			const servingsStr = formData.get('servings')
			const servings = servingsStr
				? Math.min(999, Math.max(1, parseInt(String(servingsStr), 10)))
				: null

			const entry = await db.mealPlanEntry.findFirst({
				where: { id: entryId, mealPlan: { householdId } },
			})
			invariantResponse(entry, 'Entry not found', { status: 404 })

			await db.mealPlanEntry.update({
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

			const entry = await db.mealPlanEntry.findFirst({
				where: { id: entryId, mealPlan: { householdId } },
			})
			invariantResponse(entry, 'Entry not found', { status: 404 })

			await db.mealPlanEntry.update({
				where: { id: entryId },
				data: { cooked },
			})

			return { status: 'success' as const }
		}

		if (intent === 'remove') {
			const entryId = formData.get('entryId')
			invariantResponse(typeof entryId === 'string', 'Entry ID is required')

			// Verify ownership via meal plan
			const entry = await db.mealPlanEntry.findFirst({
				where: {
					id: entryId,
					mealPlan: { householdId },
				},
			})
			invariantResponse(entry, 'Entry not found', { status: 404 })

			await db.mealPlanEntry.delete({ where: { id: entryId } })

			return { status: 'success' as const }
		}

		return { status: 'error' as const }
	}
}
