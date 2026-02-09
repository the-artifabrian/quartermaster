import { prisma } from './db.server.ts'
import { requireUserId } from './auth.server.ts'

/**
 * Returns the current user's household info.
 * Safety-net: if no household exists (edge case), auto-creates one.
 */
export async function requireUserWithHousehold(request: Request) {
	const userId = await requireUserId(request)

	const member = await prisma.householdMember.findFirst({
		where: { userId },
		select: { householdId: true, role: true },
	})

	if (member) {
		return { userId, householdId: member.householdId, role: member.role }
	}

	// Safety-net: create a household for users that don't have one.
	// Wrapped in try/catch to handle concurrent requests racing to create.
	try {
		const user = await prisma.user.findUniqueOrThrow({
			where: { id: userId },
			select: { name: true, username: true },
		})

		const household = await prisma.household.create({
			data: {
				name: `${user.name ?? user.username}'s Household`,
				members: {
					create: { userId, role: 'owner' },
				},
			},
		})

		return { userId, householdId: household.id, role: 'owner' }
	} catch {
		// Another concurrent request likely created the household — re-query
		const retryMember = await prisma.householdMember.findFirstOrThrow({
			where: { userId },
			select: { householdId: true, role: true },
		})
		return { userId, householdId: retryMember.householdId, role: retryMember.role }
	}
}
