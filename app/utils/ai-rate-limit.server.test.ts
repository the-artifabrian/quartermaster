import { describe, expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { checkAndRecordAiUsage, getAiUsageRemaining } from './ai-rate-limit.server.ts'

async function setupUser() {
	const user = await prisma.user.create({ data: createUser() })
	return user.id
}

describe('getAiUsageRemaining', () => {
	test('returns full limit when no events exist', async () => {
		const userId = await setupUser()
		const remaining = await getAiUsageRemaining(userId, 'test_type', 10)
		expect(remaining).toBe(10)
	})

	test('returns reduced count when events exist', async () => {
		const userId = await setupUser()

		await prisma.usageEvent.createMany({
			data: Array.from({ length: 3 }, () => ({
				type: 'test_type',
				userId,
			})),
		})

		const remaining = await getAiUsageRemaining(userId, 'test_type', 10)
		expect(remaining).toBe(7)
	})

	test('returns zero when at limit', async () => {
		const userId = await setupUser()

		await prisma.usageEvent.createMany({
			data: Array.from({ length: 10 }, () => ({
				type: 'test_type',
				userId,
			})),
		})

		const remaining = await getAiUsageRemaining(userId, 'test_type', 10)
		expect(remaining).toBe(0)
	})

	test('only counts events of the specified type', async () => {
		const userId = await setupUser()

		await prisma.usageEvent.createMany({
			data: [
				{ type: 'type_a', userId },
				{ type: 'type_a', userId },
				{ type: 'type_b', userId },
			],
		})

		const remaining = await getAiUsageRemaining(userId, 'type_a', 10)
		expect(remaining).toBe(8)
	})

	test('new day resets count', async () => {
		const userId = await setupUser()

		// Create events from yesterday
		const yesterday = new Date()
		yesterday.setDate(yesterday.getDate() - 1)
		yesterday.setHours(12, 0, 0, 0)

		await prisma.usageEvent.createMany({
			data: Array.from({ length: 10 }, () => ({
				type: 'test_type',
				userId,
				createdAt: yesterday,
			})),
		})

		const remaining = await getAiUsageRemaining(userId, 'test_type', 10)
		expect(remaining).toBe(10)
	})
})

describe('checkAndRecordAiUsage', () => {
	test('allows when under limit and records usage', async () => {
		const userId = await setupUser()

		const result = await checkAndRecordAiUsage(userId, 'test_type', 10)

		expect(result.allowed).toBe(true)
		expect(result.remaining).toBe(9)

		const count = await prisma.usageEvent.count({
			where: { userId, type: 'test_type' },
		})
		expect(count).toBe(1)
	})

	test('rejects when at limit', async () => {
		const userId = await setupUser()

		await prisma.usageEvent.createMany({
			data: Array.from({ length: 10 }, () => ({
				type: 'test_type',
				userId,
			})),
		})

		const result = await checkAndRecordAiUsage(userId, 'test_type', 10)

		expect(result.allowed).toBe(false)
		expect(result.remaining).toBe(0)

		// Should not have created an additional event
		const count = await prisma.usageEvent.count({
			where: { userId, type: 'test_type' },
		})
		expect(count).toBe(10)
	})

	test('DB write failure still allows the call', async () => {
		// Use a non-existent userId to trigger a foreign key constraint error
		const fakeUserId = 'nonexistent_user_id_for_fk_failure'

		const consoleSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {})

		const result = await checkAndRecordAiUsage(
			fakeUserId,
			'test_type',
			10,
		)

		// Should still be allowed (rate limiting is a safety net)
		expect(result.allowed).toBe(true)
		expect(result.remaining).toBe(9)
		expect(consoleSpy).toHaveBeenCalled()

		consoleSpy.mockRestore()
	})

	test('new day resets count', async () => {
		const userId = await setupUser()

		// Create events from yesterday
		const yesterday = new Date()
		yesterday.setDate(yesterday.getDate() - 1)
		yesterday.setHours(12, 0, 0, 0)

		await prisma.usageEvent.createMany({
			data: Array.from({ length: 10 }, () => ({
				type: 'test_type',
				userId,
				createdAt: yesterday,
			})),
		})

		const result = await checkAndRecordAiUsage(userId, 'test_type', 10)

		expect(result.allowed).toBe(true)
		expect(result.remaining).toBe(9)
	})
})
