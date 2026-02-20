import { data } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { type HouseholdEventData } from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/household-events-poll.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)

	const url = new URL(request.url)
	const since = url.searchParams.get('since')

	if (!since) {
		return data({ events: [] as HouseholdEventData[] })
	}

	const sinceDate = new Date(since)
	if (isNaN(sinceDate.getTime())) {
		return data({ events: [] as HouseholdEventData[] })
	}

	const rows = await prisma.householdEvent.findMany({
		where: {
			householdId,
			userId: { not: userId },
			createdAt: { gt: sinceDate },
		},
		orderBy: { createdAt: 'asc' },
		take: 50,
		select: {
			id: true,
			type: true,
			payload: true,
			createdAt: true,
			userId: true,
			user: { select: { name: true, username: true } },
		},
	})

	const events: HouseholdEventData[] = rows.map((row) => ({
		id: row.id,
		type: row.type as HouseholdEventData['type'],
		payload: JSON.parse(row.payload) as Record<string, unknown>,
		userId: row.userId,
		username: row.user.name ?? row.user.username,
		householdId,
		createdAt: row.createdAt.toISOString(),
	}))

	return data({ events })
}
