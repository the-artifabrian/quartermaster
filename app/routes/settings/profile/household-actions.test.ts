import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './household.tsx'
import '#tests/setup/db-setup.ts'

/** An owner and a member sharing a Household, each with a session. */
async function sharedHousehold() {
	return prisma.$transaction(async (tx) => {
		const owner = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: { create: createUser() },
			},
			select: { id: true, userId: true },
		})
		const member = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: { create: createUser() },
			},
			select: { id: true, userId: true },
		})
		const household = await tx.household.create({
			data: {
				name: 'Shared Household',
				members: {
					create: [
						{ userId: owner.userId, role: 'owner' },
						{ userId: member.userId, role: 'member' },
					],
				},
			},
			select: { id: true },
		})
		return { owner, member, householdId: household.id }
	})
}

async function leave(session: { id: string }) {
	const path = '/settings/profile/household'
	return action({
		request: new Request(`${BASE_URL}${path}`, {
			method: 'POST',
			headers: {
				cookie: await getSessionCookieHeader(session),
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ intent: 'leave-household' }).toString(),
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: path,
		url: new URL(`${BASE_URL}${path}`),
	}).catch((error: unknown) => error)
}

const leftEvents = (householdId: string) =>
	prisma.householdEvent.count({
		where: { householdId, type: 'household_member_left' },
	})

test('an owner cannot leave, and the other member hears nothing', async () => {
	const { owner, householdId } = await sharedHousehold()

	const result = await leave(owner)

	expect(result).toBeInstanceOf(Response)
	expect((result as Response).status).toBe(403)
	expect(await leftEvents(householdId)).toBe(0)
	expect(
		await prisma.householdMember.findFirst({
			where: { userId: owner.userId },
			select: { householdId: true, role: true },
		}),
	).toEqual({ householdId, role: 'owner' })
})

test('a member who leaves is announced to the Household they left', async () => {
	const { member, householdId } = await sharedHousehold()

	const result = await leave(member)

	expect((result as Response).status).toBe(302)
	expect(
		await prisma.householdEvent.findMany({
			where: { householdId, type: 'household_member_left' },
			select: { userId: true },
		}),
	).toEqual([{ userId: member.userId }])
	const membership = await prisma.householdMember.findFirstOrThrow({
		where: { userId: member.userId },
		select: { householdId: true },
	})
	expect(membership.householdId).not.toBe(householdId)
})
