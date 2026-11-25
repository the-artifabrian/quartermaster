// Joining another Household is a departure from the old one. The people left
// behind hear it as they do when someone leaves. A sole member's old Household
// is gone, so there is nobody to tell.
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './join.tsx'
import '#tests/setup/db-setup.ts'

const path = '/household/join'

async function signedIn() {
	return prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
		select: { id: true, userId: true },
	})
}

async function householdOf(
	...members: Array<{ userId: string; role: string }>
) {
	return prisma.household.create({
		data: { name: 'Home', members: { create: members } },
		select: { id: true },
	})
}

async function accept(session: { id: string }, token: string) {
	return action({
		request: new Request(`${BASE_URL}${path}`, {
			method: 'POST',
			headers: {
				cookie: await getSessionCookieHeader(session),
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ intent: 'accept', token }).toString(),
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: path,
		url: new URL(`${BASE_URL}${path}`),
	})
}

async function inviteFrom(householdId: string, createdById: string) {
	const invite = await prisma.householdInvite.create({
		data: {
			token: crypto.randomUUID(),
			expiresAt: new Date(Date.now() + 86_400_000),
			householdId,
			createdById,
		},
		select: { token: true },
	})
	return invite.token
}

const departures = (userId: string) =>
	prisma.householdEvent.findMany({
		where: { userId, type: 'household_member_left' },
		select: { householdId: true },
	})

test('joining from a shared Household tells the people left behind', async () => {
	const joiner = await signedIn()
	const partner = await signedIn()
	const host = await signedIn()
	const home = await householdOf(
		{ userId: joiner.userId, role: 'owner' },
		{ userId: partner.userId, role: 'member' },
	)
	const elsewhere = await householdOf({ userId: host.userId, role: 'owner' })

	const response = await accept(
		joiner,
		await inviteFrom(elsewhere.id, host.userId),
	)

	expect(response.status).toBe(302)
	expect(await departures(joiner.userId)).toEqual([{ householdId: home.id }])
})

test('a sole member joining records no departure', async () => {
	const joiner = await signedIn()
	const host = await signedIn()
	const home = await householdOf({ userId: joiner.userId, role: 'owner' })
	const elsewhere = await householdOf({ userId: host.userId, role: 'owner' })

	const response = await accept(
		joiner,
		await inviteFrom(elsewhere.id, host.userId),
	)

	expect(response.status).toBe(302)
	expect(await prisma.household.count({ where: { id: home.id } })).toBe(0)
	expect(await departures(joiner.userId)).toEqual([])
})
