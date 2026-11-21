// Failure list for invite links in Household settings:
// - a member who isn't the owner opens the page while an invite is live: the
//   loader must not hand them its token, in any field
// - the owner opens the same page: they still get the token, so the link can
//   be copied
// - a member who isn't the owner posts create-invite or revoke-invite: refused,
//   and no invite is made or removed
// Leaving:
// - an owner can't leave, and nobody hears of a departure
// - a member who leaves is announced to the Household they left
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action, loader } from './household.tsx'
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

const path = '/settings/profile/household'

async function post(session: { id: string }, fields: Record<string, string>) {
	return action({
		request: new Request(`${BASE_URL}${path}`, {
			method: 'POST',
			headers: {
				cookie: await getSessionCookieHeader(session),
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams(fields).toString(),
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: path,
		url: new URL(`${BASE_URL}${path}`),
	}).catch((error: unknown) => error)
}

function leave(session: { id: string }) {
	return post(session, { intent: 'leave-household' })
}

async function load(session: { id: string }) {
	return loader({
		request: new Request(`${BASE_URL}${path}`, {
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: path,
		url: new URL(`${BASE_URL}${path}`),
	})
}

async function liveInvite(householdId: string, createdById: string) {
	return prisma.householdInvite.create({
		data: {
			token: crypto.randomUUID(),
			expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
			householdId,
			createdById,
		},
		select: { id: true, token: true },
	})
}

test('a member who is not the owner never gets a live invite token', async () => {
	const { owner, member, householdId } = await sharedHousehold()
	const invite = await liveInvite(householdId, owner.userId)

	const data = await load(member)

	expect(JSON.stringify(data)).not.toContain(invite.token)
	expect(data.household.invites).toEqual([])
})

test('the owner still gets the invite token to copy the link', async () => {
	const { owner, householdId } = await sharedHousehold()
	const invite = await liveInvite(householdId, owner.userId)

	const data = await load(owner)

	expect(data.household.invites.map((i) => i.token)).toEqual([invite.token])
})

test('a member who is not the owner cannot make or revoke invites', async () => {
	const { owner, member, householdId } = await sharedHousehold()
	const invite = await liveInvite(householdId, owner.userId)

	const created = await post(member, { intent: 'create-invite' })
	const revoked = await post(member, {
		intent: 'revoke-invite',
		inviteId: invite.id,
	})

	expect((created as Response).status).toBe(403)
	expect(revoked).toBeInstanceOf(Error)
	expect(
		await prisma.householdInvite.findMany({
			where: { householdId },
			select: { id: true },
		}),
	).toEqual([{ id: invite.id }])
})

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
