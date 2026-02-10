import { describe, expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { emitHouseholdEvent, householdEventBus } from './household-events.server.ts'

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
			type: 'recipe_created',
			payload: { recipeId: 'abc', title: 'Test Recipe' },
			userId: user.id,
			householdId: user.householdId,
		})

		const events = await prisma.householdEvent.findMany({
			where: { householdId: user.householdId },
		})

		expect(events).toHaveLength(1)
		expect(events[0]!.type).toBe('recipe_created')
		expect(JSON.parse(events[0]!.payload)).toEqual({
			recipeId: 'abc',
			title: 'Test Recipe',
		})
		expect(events[0]!.userId).toBe(user.id)
		expect(events[0]!.householdId).toBe(user.householdId)
	})

	test('emits event on the bus', async () => {
		const user = await setupUser()

		const listener = vi.fn()
		householdEventBus.on(`household:${user.householdId}`, listener)

		await emitHouseholdEvent({
			type: 'inventory_item_added',
			payload: { name: 'Milk', location: 'fridge' },
			userId: user.id,
			householdId: user.householdId,
		})

		householdEventBus.off(`household:${user.householdId}`, listener)

		expect(listener).toHaveBeenCalledTimes(1)
		const eventData = listener.mock.calls[0]![0]
		expect(eventData.type).toBe('inventory_item_added')
		expect(eventData.payload).toEqual({ name: 'Milk', location: 'fridge' })
		expect(eventData.userId).toBe(user.id)
		expect(eventData.householdId).toBe(user.householdId)
		expect(typeof eventData.username).toBe('string')
		expect(eventData.username.length).toBeGreaterThan(0)
	})
})
