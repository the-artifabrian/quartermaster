import { data } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/notifications.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)

	const member = await prisma.householdMember.findUnique({
		where: { householdId_userId: { householdId, userId } },
		select: { notificationsLastSeenAt: true },
	})

	const notifications = await prisma.householdEvent.findMany({
		where: {
			householdId,
			userId: { not: userId },
		},
		orderBy: { createdAt: 'desc' },
		take: 20,
		select: {
			id: true,
			type: true,
			payload: true,
			createdAt: true,
			user: { select: { name: true, username: true } },
		},
	})

	return data({
		notifications,
		lastSeenAt: member?.notificationsLastSeenAt?.toISOString() ?? null,
	})
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)

	await prisma.householdMember.update({
		where: { householdId_userId: { householdId, userId } },
		data: { notificationsLastSeenAt: new Date() },
	})

	return data({ ok: true })
}
