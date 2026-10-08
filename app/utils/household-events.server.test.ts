import { describe, expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	emitHouseholdEvent,
	householdEventBus,
} from './household-events.server.ts'
import '#tests/setup/db-setup.ts'

async function setupUser() {
	return prisma.$transaction(async (tx) => {
		const user = await tx.user.create({ data: createUser() })
		const household = await tx.household.create({
			data: {
				name: 'Test Household',
				members: { create: { userId: user.id, role: 'owner' } },
			},
		})
		return {
			id: user.id,
			householdId: household.id,
			name: user.name,
			username: user.username,
		}
	})
}

describe('emitHouseholdEvent', () => {
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
		// The activity toast names the member by display name.
		expect(eventData.username).toBe(user.name)
	})
})
