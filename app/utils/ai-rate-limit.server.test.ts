/**
 * Failure list for the daily AI usage claim:
 *
 * 1. Parallel claims past the cap: every claim counts before any records, so
 *    all of them pass. Exactly the cap may succeed, under WAL contention.
 * 2. A claim at the cap records nothing.
 * 3. Yesterday's uses do not count against today.
 * 4. The database cannot be written (or is busy past its timeout): the claim
 *    must be refused, not let through, or contention becomes a free slot.
 * 5. A refund frees exactly the slot it took: not another use of the same
 *    type, not another user's, and a second refund changes nothing.
 * 6. Global cap: parallel claims from different users past the global cap.
 * 7. Global cap: deleting the users who spent it must not hand it back.
 * 8. Global cap reached: the claim spends no per-user slot. Per-user cap
 *    reached: the claim spends no global slot.
 * 9. A refund under a global cap frees the global slot too.
 * 10. A caller without a global cap writes no global row and no ledger user.
 */
import { describe, expect, test } from 'vitest'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { createWalDatabase } from '#tests/sqlite-concurrency.ts'
import { claimAiUsage } from './ai-rate-limit.server.ts'
import '#tests/setup/db-setup.ts'

async function newUser(db: PrismaClient = prisma) {
	const user = await db.user.create({ data: createUser() })
	return user.id
}

function allowedCount(claims: Array<{ allowed: boolean }>) {
	return claims.filter((claim) => claim.allowed).length
}

describe('claimAiUsage', () => {
	test('parallel claims past the cap let exactly the cap through', async () => {
		await using database = await createWalDatabase()
		const { db } = database
		const userId = await newUser(db)

		const claims = await Promise.all(
			Array.from({ length: 25 }, () =>
				claimAiUsage(userId, 'test_type', { perUser: 10 }, db),
			),
		)

		expect(allowedCount(claims)).toBe(10)
		expect(
			claims.filter((claim) => !claim.allowed && claim.reason === 'per-user'),
		).toHaveLength(15)
		expect(
			await db.usageEvent.count({ where: { userId, type: 'test_type' } }),
		).toBe(10)
	})

	test('a claim at the cap is refused and records nothing', async () => {
		const userId = await newUser()
		await prisma.usageEvent.createMany({
			data: Array.from({ length: 10 }, () => ({ type: 'test_type', userId })),
		})

		const claim = await claimAiUsage(userId, 'test_type', { perUser: 10 })

		expect(claim).toEqual({ allowed: false, reason: 'per-user' })
		expect(
			await prisma.usageEvent.count({ where: { userId, type: 'test_type' } }),
		).toBe(10)
	})

	test("yesterday's uses do not count against today", async () => {
		const userId = await newUser()
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

		const claim = await claimAiUsage(userId, 'test_type', { perUser: 10 })

		expect(claim.allowed).toBe(true)
	})

	test('a claim that cannot be recorded is refused, not let through', async () => {
		consoleError.mockImplementation(() => {})

		// No such user: the insert fails its foreign key.
		const claim = await claimAiUsage('no_such_user', 'test_type', {
			perUser: 10,
		})

		expect(claim).toEqual({ allowed: false, reason: 'unavailable' })
		expect(consoleError).toHaveBeenCalled()
	})

	test('a refund frees exactly the slot it took, once', async () => {
		const userId = await newUser()
		const otherUserId = await newUser()
		await claimAiUsage(otherUserId, 'test_type', { perUser: 2 })
		const kept = await claimAiUsage(userId, 'test_type', { perUser: 2 })
		const refunded = await claimAiUsage(userId, 'test_type', { perUser: 2 })
		expect(kept.allowed && refunded.allowed).toBe(true)
		if (!refunded.allowed) return

		await refunded.refund()
		await refunded.refund()

		expect(
			await prisma.usageEvent.count({ where: { userId, type: 'test_type' } }),
		).toBe(1)
		expect(
			await prisma.usageEvent.count({ where: { userId: otherUserId } }),
		).toBe(1)
		expect(
			(await claimAiUsage(userId, 'test_type', { perUser: 2 })).allowed,
		).toBe(true)
		expect(
			(await claimAiUsage(userId, 'test_type', { perUser: 2 })).allowed,
		).toBe(false)
	})

	test('parallel claims from many users past the global cap let exactly the cap through', async () => {
		await using database = await createWalDatabase()
		const { db } = database
		const userIds = await Promise.all(
			Array.from({ length: 5 }, () => newUser(db)),
		)

		const claims = await Promise.all(
			userIds.flatMap((userId) =>
				Array.from({ length: 5 }, () =>
					claimAiUsage(userId, 'demo_type', { perUser: 5, global: 12 }, db),
				),
			),
		)

		expect(allowedCount(claims)).toBe(12)
		expect(
			claims.filter((claim) => !claim.allowed && claim.reason === 'global'),
		).toHaveLength(13)
	})

	test('deleting the users who spent the global cap does not hand it back', async () => {
		const limits = { perUser: 5, global: 3 }
		for (let i = 0; i < 3; i++) {
			const userId = await newUser()
			expect((await claimAiUsage(userId, 'demo_type', limits)).allowed).toBe(
				true,
			)
			await prisma.user.delete({ where: { id: userId } })
		}

		const claim = await claimAiUsage(await newUser(), 'demo_type', limits)

		expect(claim).toEqual({ allowed: false, reason: 'global' })
	})

	test('a claim refused by one cap spends nothing from the other', async () => {
		const limits = { perUser: 2, global: 3 }
		const first = await newUser()
		const second = await newUser()
		await claimAiUsage(first, 'demo_type', limits)
		await claimAiUsage(first, 'demo_type', limits)

		// The per-user cap refuses this one: the global slot stays free.
		expect(await claimAiUsage(first, 'demo_type', limits)).toEqual({
			allowed: false,
			reason: 'per-user',
		})
		expect((await claimAiUsage(second, 'demo_type', limits)).allowed).toBe(true)

		// The global cap refuses this one: no per-user slot is spent.
		expect(await claimAiUsage(second, 'demo_type', limits)).toEqual({
			allowed: false,
			reason: 'global',
		})
		expect(
			await prisma.usageEvent.count({
				where: { userId: second, type: 'demo_type' },
			}),
		).toBe(1)
	})

	test('a refund under a global cap frees the global slot too', async () => {
		const limits = { perUser: 5, global: 1 }
		const claim = await claimAiUsage(await newUser(), 'demo_type', limits)
		expect(claim.allowed).toBe(true)
		if (!claim.allowed) return

		await claim.refund()

		expect(
			(await claimAiUsage(await newUser(), 'demo_type', limits)).allowed,
		).toBe(true)
	})

	test('a claim without a global cap writes only the user’s own row', async () => {
		const userId = await newUser()
		const usersBefore = await prisma.user.count()

		await claimAiUsage(userId, 'test_type', { perUser: 10 })

		expect(await prisma.user.count()).toBe(usersBefore)
		expect(
			await prisma.usageEvent.findMany({
				select: { userId: true, type: true },
			}),
		).toEqual([{ userId, type: 'test_type' }])
	})
})
