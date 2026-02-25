import { invariantResponse } from '@epic-web/invariant'
import { data } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/quick-cook.ts'

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)
	const formData = await request.formData()
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

	// Create cooking log
	await prisma.cookingLog.create({
		data: {
			recipeId: entry.recipe.id,
			userId,
			cookedAt: new Date(),
		},
	})

	return data({
		status: 'success' as const,
		recipeTitle: entry.recipe.title,
	})
}
