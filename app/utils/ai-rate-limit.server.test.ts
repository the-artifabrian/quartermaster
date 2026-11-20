/**
 * Failure list for the daily AI usage claim:
 *
 * 1. Parallel claims past the cap in one server process: every claim counts
 *    before any records, so all of them pass. Exactly the cap may succeed.
 * 2. Another connection, such as a second server process, writes a use
 *    between a claim's count and its insert, so the count goes stale. Its
 *    write must wait until the claim has recorded.
 * 3. A claim at the cap records nothing.
 * 4. Yesterday's uses do not count against today.
 * 5. The database cannot be written (or is busy past its timeout): the claim
 *    must be refused, or contention becomes a free slot.
 * 6. A refund frees exactly the slot it took: not another use of the same
 *    type, not another user's, and a second refund changes nothing.
 */
import { describe, expect, test } from 'vitest'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import {
	createWalDatabase,
	settlesWithin,
	writeFromAnotherConnection,
} from '#tests/sqlite-concurrency.ts'
import { claimAiUsage } from './ai-rate-limit.server.ts'
import '#tests/setup/db-setup.ts'

async function newUser(db: PrismaClient = prisma) {
	const user = await db.user.create({ data: createUser() })
	return user.id
}

/**
 * `db`, but each claim stops right after it counts, until `resume` settles.
 * `counted` resolves once a claim is waiting there.
 */
function pauseAfterCount(db: PrismaClient, resume: Promise<void>) {
	let counted!: () => void
	const waiting = new Promise<void>((resolve) => (counted = resolve))
	const bind = (target: object, key: string | symbol) => {
		const value: unknown = Reflect.get(target, key, target)
		return typeof value === 'function' ? value.bind(target) : value
	}
	const paused = {
		$transaction: (work: (tx: object) => Promise<unknown>) =>
			db.$transaction((tx) =>
				work(
					new Proxy(tx, {
						get(target, key) {
							if (key !== 'usageEvent') return bind(target, key)
							return new Proxy(target.usageEvent, {
								get(delegate, method) {
									if (method !== 'count') return bind(delegate, method)
									return async (args: never) => {
										const total = await delegate.count(args)
										counted()
										await resume
										return total
									}
								},
							})
						},
					}),
				),
			),
	}
	return { db: paused as unknown as PrismaClient, waiting }
}

function allowedCount(claims: Array<{ allowed: boolean }>) {
	return claims.filter((claim) => claim.allowed).length
}

describe('claimAiUsage', () => {
	test('parallel claims in one process let exactly the cap through', async () => {
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

	test('a write from another connection waits until the claim has recorded', async () => {
		await using database = await createWalDatabase()
		const { db, url } = database
		const userId = await newUser(db)
		const events: string[] = []
		let finish!: () => void
		const resume = new Promise<void>((resolve) => (finish = resolve))
		const paused = pauseAfterCount(db, resume)

		const claim = claimAiUsage(userId, 'test_type', { perUser: 1 }, paused.db)
		const claimed = claim.then((result) => {
			events.push('claim committed')
			return result
		})
		expect(await settlesWithin(paused.waiting, 2000)).toBe(true)
		const other = writeFromAnotherConnection(
			url,
			'INSERT INTO "UsageEvent" ("id", "type", "createdAt", "userId") VALUES (?, ?, ?, ?)',
			['other-use', 'test_type', Date.now(), userId],
		)
		const committed = other.committed.then(() =>
			events.push('other write committed'),
		)
		await other.executing
		expect(await settlesWithin(committed, 300)).toBe(false)

		finish()
		const [result] = await Promise.all([claimed, committed])
		expect(result.allowed).toBe(true)
		expect(events).toEqual(['claim committed', 'other write committed'])
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
})
