import { data } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { demandIdentity } from '#app/utils/shopping-demand.server.ts'
import { type Route } from './+types/shopping-staples.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const staples = await prisma.householdIngredient.findMany({
		where: {
			householdId,
			isStaple: true,
			household: { staplesCutoverAt: { not: null } },
		},
		orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
		select: { id: true, displayName: true },
	})

	return data(
		{
			staples: staples.map((staple) => ({
				...staple,
				shoppingIdentity: demandIdentity(staple.displayName),
			})),
		},
		{ headers: { 'Cache-Control': 'private, no-store' } },
	)
}
