import { describe, expect, test, vi } from 'vitest'
import { type AppLoadContext } from 'react-router'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { prisma } from '#app/utils/db.server.ts'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { loader } from './household-events-poll.tsx'

const LOADER_ARGS_BASE = {
	params: {},
	context: {} as AppLoadContext,
	unstable_pattern: '/resources/household-events-poll',
}

async function setupUser() {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
		select: { id: true, userId: true },
	})
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: session.userId, role: 'owner' } },
		},
	})
	await prisma.subscription.create({
		data: { userId: session.userId, tier: 'pro' },
	})
	return { ...session, householdId: household.id }
}

async function setupOtherUser(householdId: string) {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
		select: { id: true, userId: true },
	})
	await prisma.householdMember.create({
		data: { householdId, userId: session.userId, role: 'member' },
	})
	await prisma.subscription.create({
		data: { userId: session.userId, tier: 'pro' },
	})
	return session
}

describe('household-events-poll loader', () => {
	test('returns empty array when since param is missing', async () => {
		const user = await setupUser()
		const cookie = await getSessionCookieHeader(user)

		const result = (await loader({
			...LOADER_ARGS_BASE,
			request: new Request(`${BASE_URL}/resources/household-events-poll`, {
				headers: { cookie },
			}),
		})) as { data: { events: any[] } }

		expect(result.data.events).toEqual([])
	})

	test('returns empty array for invalid since param', async () => {
		const user = await setupUser()
		const cookie = await getSessionCookieHeader(user)

		const result = (await loader({
			...LOADER_ARGS_BASE,
			request: new Request(
				`${BASE_URL}/resources/household-events-poll?since=not-a-date`,
				{ headers: { cookie } },
			),
		})) as { data: { events: any[] } }

		expect(result.data.events).toEqual([])
	})

	test('returns events after since timestamp, excluding own events', async () => {
		const user = await setupUser()
		const otherUser = await setupOtherUser(user.householdId)
		const cookie = await getSessionCookieHeader(user)

		const before = new Date()
		await new Promise((r) => setTimeout(r, 5))

		// Create events from the other user
		await prisma.householdEvent.create({
			data: {
				type: 'recipe_created',
				payload: JSON.stringify({ recipeId: 'r1', title: 'Pasta' }),
				householdId: user.householdId,
				userId: otherUser.userId,
			},
		})

		// Create an event from the current user (should be excluded)
		await prisma.householdEvent.create({
			data: {
				type: 'recipe_created',
				payload: JSON.stringify({ recipeId: 'r2', title: 'Salad' }),
				householdId: user.householdId,
				userId: user.userId,
			},
		})

		const since = before.toISOString()
		const result = (await loader({
			...LOADER_ARGS_BASE,
			request: new Request(
				`${BASE_URL}/resources/household-events-poll?since=${encodeURIComponent(since)}`,
				{ headers: { cookie } },
			),
		})) as { data: { events: any[] } }

		expect(result.data.events).toHaveLength(1)
		expect(result.data.events[0].type).toBe('recipe_created')
		expect(result.data.events[0].payload).toEqual({
			recipeId: 'r1',
			title: 'Pasta',
		})
		expect(result.data.events[0].userId).toBe(otherUser.userId)
		expect(result.data.events[0].householdId).toBe(user.householdId)
	})

	test('response shape matches HouseholdEventData', async () => {
		const user = await setupUser()
		const otherUser = await setupOtherUser(user.householdId)
		const cookie = await getSessionCookieHeader(user)

		const before = new Date()
		await new Promise((r) => setTimeout(r, 5))

		await prisma.householdEvent.create({
			data: {
				type: 'inventory_item_added',
				payload: JSON.stringify({ name: 'Milk', location: 'fridge' }),
				householdId: user.householdId,
				userId: otherUser.userId,
			},
		})

		const since = before.toISOString()
		const result = (await loader({
			...LOADER_ARGS_BASE,
			request: new Request(
				`${BASE_URL}/resources/household-events-poll?since=${encodeURIComponent(since)}`,
				{ headers: { cookie } },
			),
		})) as { data: { events: any[] } }

		expect(result.data.events).toHaveLength(1)

		const event = result.data.events[0]
		expect(event).toHaveProperty('id')
		expect(event).toHaveProperty('type')
		expect(event).toHaveProperty('payload')
		expect(event).toHaveProperty('userId')
		expect(event).toHaveProperty('username')
		expect(event).toHaveProperty('householdId')
		expect(event).toHaveProperty('createdAt')
		expect(typeof event.id).toBe('string')
		expect(typeof event.createdAt).toBe('string')
		expect(typeof event.username).toBe('string')
	})

	test('does not return events before since timestamp', async () => {
		const user = await setupUser()
		const otherUser = await setupOtherUser(user.householdId)
		const cookie = await getSessionCookieHeader(user)

		// Create an event first
		await prisma.householdEvent.create({
			data: {
				type: 'recipe_created',
				payload: JSON.stringify({ recipeId: 'r1', title: 'Old' }),
				householdId: user.householdId,
				userId: otherUser.userId,
			},
		})

		// Use a timestamp after the event
		const after = new Date()
		// Small delay to ensure separation
		await new Promise((r) => setTimeout(r, 10))
		const since = after.toISOString()

		const result = (await loader({
			...LOADER_ARGS_BASE,
			request: new Request(
				`${BASE_URL}/resources/household-events-poll?since=${encodeURIComponent(since)}`,
				{ headers: { cookie } },
			),
		})) as { data: { events: any[] } }

		expect(result.data.events).toHaveLength(0)
	})
})
