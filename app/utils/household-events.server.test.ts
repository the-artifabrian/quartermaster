import { describe, expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	emitHouseholdEvent,
	householdEventBus,
} from './household-events.server.ts'

async function setupUser() {
	const user = await prisma.user.create({ data: createUser() })
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	return { id: user.id, householdId: household.id, username: user.username }
}

describe('emitHouseholdEvent', () => {
	test('writes event to database', async () => {
		const user = await setupUser()

		await emitHouseholdEvent({
			type: 'shopping_list_item_added',
			payload: { name: 'Butter' },
			userId: user.id,
			householdId: user.householdId,
		})

		const events = await prisma.householdEvent.findMany({
			where: { householdId: user.householdId },
		})

		expect(events).toHaveLength(1)
		expect(events[0]!.type).toBe('shopping_list_item_added')
		expect(JSON.parse(events[0]!.payload)).toEqual({ name: 'Butter' })
		expect(events[0]!.userId).toBe(user.id)
		expect(events[0]!.householdId).toBe(user.householdId)
	})

	test('emits event on the bus', async () => {
		const user = await setupUser()

		const listener = vi.fn()
		householdEventBus.on(`household:${user.householdId}`, listener)

		await emitHouseholdEvent({
			type: 'shopping_list_generated',
			payload: { count: 12 },
			userId: user.id,
			householdId: user.householdId,
		})

		householdEventBus.off(`household:${user.householdId}`, listener)

		expect(listener).toHaveBeenCalledTimes(1)
		const eventData = listener.mock.calls[0]![0]
		expect(eventData.type).toBe('shopping_list_generated')
		expect(eventData.payload).toEqual({ count: 12 })
		expect(eventData.userId).toBe(user.id)
		expect(eventData.householdId).toBe(user.householdId)
		expect(typeof eventData.username).toBe('string')
		expect(eventData.username.length).toBeGreaterThan(0)
	})
})
