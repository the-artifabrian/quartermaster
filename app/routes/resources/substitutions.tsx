import { data } from 'react-router'
import { z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { getSubstitutions } from '#app/utils/substitution-lookup.server.ts'
import { trackEvent } from '#app/utils/usage-tracking.server.ts'
import { type Route } from './+types/substitutions.ts'

const SubstitutionRequestSchema = z.object({
	ingredientName: z.string().min(1),
})

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)

	const formData = await request.formData()
	const parsed = SubstitutionRequestSchema.safeParse({
		ingredientName: formData.get('ingredientName'),
	})

	if (!parsed.success) {
		return data({ substitutions: [], source: 'none' as const }, { status: 400 })
	}

	const { ingredientName } = parsed.data

	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { householdId },
		select: { name: true },
	})

	const result = await getSubstitutions(ingredientName, inventoryItems)

	if (result.source === 'llm') {
		trackEvent(userId, householdId, 'SUBSTITUTION_LLM_CALL', {
			ingredientName,
		})
	}

	return data(result)
}
