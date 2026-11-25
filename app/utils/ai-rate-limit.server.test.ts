/**
 * The daily AI usage claim, and the caps demo users share.
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
import { deleteAccount } from './account-deletion.server.ts'
import {
	aiUsageLimitsFor,
	aiUsageRefusal,
	claimAiUsage,
	startOfUsageDay,
} from './ai-rate-limit.server.ts'
import { DEMO_AI_USES_PER_DAY, DEMO_AI_USES_PER_FEATURE } from './demo.ts'
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

	// A second server process could write a use between a claim's count and its
	// insert, which would make the count stale.
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

	// A database that can't be written, or is busy past its timeout, must not
	// turn contention into a free slot.
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

async function newDemoUser(db: PrismaClient = prisma) {
	const user = await db.user.create({
		data: {
			...createUser(),
			demoExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
		},
	})
	return user.id
}

/** `count` shared demo uses already spent today, by users long gone. */
async function spendDemoUses(count: number, db: PrismaClient = prisma) {
	await db.demoAiUsage.createMany({
		data: Array.from({ length: count }, () => ({ type: 'test_type' })),
	})
}

describe('demo caps', () => {
	test('the resolver gives demo users the demo caps and real users their own', async () => {
		const demo = await newDemoUser()
		const real = await newUser()

		expect(await aiUsageLimitsFor(demo, 'recipe_extract_llm_call')).toEqual({
			perUser: DEMO_AI_USES_PER_FEATURE,
			demoPerDay: DEMO_AI_USES_PER_DAY,
		})
		expect(await aiUsageLimitsFor(demo, 'voice_transcribe_call')).toEqual({
			perUser: DEMO_AI_USES_PER_FEATURE,
			demoPerDay: DEMO_AI_USES_PER_DAY,
		})
		expect(await aiUsageLimitsFor(real, 'recipe_extract_llm_call')).toEqual({
			perUser: 10,
		})
		expect(await aiUsageLimitsFor(real, 'recipe_enhance_llm_call')).toEqual({
			perUser: 10,
		})
		expect(await aiUsageLimitsFor(real, 'voice_transcribe_call')).toEqual({
			perUser: 30,
		})
	})

	test('a demo user is refused after their own uses of a feature', async () => {
		const userId = await newDemoUser()
		const limits = await aiUsageLimitsFor(userId, 'recipe_extract_llm_call')

		const claims = []
		for (let i = 0; i < DEMO_AI_USES_PER_FEATURE + 1; i++) {
			claims.push(await claimAiUsage(userId, 'recipe_extract_llm_call', limits))
		}

		expect(allowedCount(claims)).toBe(DEMO_AI_USES_PER_FEATURE)
		expect(claims.at(-1)).toEqual({ allowed: false, reason: 'per-user' })
		expect(await prisma.demoAiUsage.count()).toBe(DEMO_AI_USES_PER_FEATURE)
	})

	test('a demo claim past the shared cap is refused and records nothing', async () => {
		const userId = await newDemoUser()
		await spendDemoUses(DEMO_AI_USES_PER_DAY)

		const claim = await claimAiUsage(
			userId,
			'test_type',
			await aiUsageLimitsFor(userId, 'recipe_extract_llm_call'),
		)

		expect(claim).toEqual({ allowed: false, reason: 'demo-day' })
		expect(await prisma.usageEvent.count({ where: { userId } })).toBe(0)
		expect(await prisma.demoAiUsage.count()).toBe(DEMO_AI_USES_PER_DAY)
	})

	test('parallel demo claims from many demo users let exactly the shared cap through', async () => {
		await using database = await createWalDatabase()
		const { db } = database
		const users = await Promise.all(
			Array.from({ length: 12 }, () => newDemoUser(db)),
		)

		// Each user's own cap is far off, so only the shared cap can stop them.
		const claims = await Promise.all(
			users.flatMap((userId) =>
				[0, 1].map(() =>
					claimAiUsage(userId, 'test_type', { perUser: 10, demoPerDay: 7 }, db),
				),
			),
		)

		expect(allowedCount(claims)).toBe(7)
		expect(
			claims.filter((claim) => !claim.allowed && claim.reason === 'demo-day'),
		).toHaveLength(17)
		expect(await db.demoAiUsage.count()).toBe(7)
		expect(await db.usageEvent.count()).toBe(7)
	})

	test('a refund gives back both the user slot and the shared one, once', async () => {
		const userId = await newDemoUser()
		const otherId = await newDemoUser()
		const limits = { perUser: 2, demoPerDay: 3 }
		await claimAiUsage(otherId, 'test_type', limits)
		const kept = await claimAiUsage(userId, 'test_type', limits)
		const refunded = await claimAiUsage(userId, 'test_type', limits)
		expect(kept.allowed && refunded.allowed).toBe(true)
		if (!refunded.allowed) return

		await refunded.refund()
		await refunded.refund()

		expect(await prisma.usageEvent.count({ where: { userId } })).toBe(1)
		expect(await prisma.demoAiUsage.count()).toBe(2)
		expect((await claimAiUsage(userId, 'test_type', limits)).allowed).toBe(true)
		expect(await claimAiUsage(otherId, 'test_type', limits)).toEqual({
			allowed: false,
			reason: 'demo-day',
		})
	})

	// A demo user removed at expiry takes their usage rows with them, which would
	// let the shared cap fill again.
	test("a removed demo user's uses still count toward today's shared cap", async () => {
		const goneId = await newDemoUser()
		const limits = { perUser: 5, demoPerDay: 3 }
		for (let i = 0; i < 3; i++) {
			expect((await claimAiUsage(goneId, 'test_type', limits)).allowed).toBe(
				true,
			)
		}
		await deleteAccount(goneId)
		expect(await prisma.user.count({ where: { id: goneId } })).toBe(0)

		const nextId = await newDemoUser()
		expect(await claimAiUsage(nextId, 'test_type', limits)).toEqual({
			allowed: false,
			reason: 'demo-day',
		})
	})

	test('a real user never counts or records a shared demo use', async () => {
		const userId = await newUser()
		await spendDemoUses(DEMO_AI_USES_PER_DAY)

		const claim = await claimAiUsage(
			userId,
			'test_type',
			await aiUsageLimitsFor(userId, 'recipe_extract_llm_call'),
		)

		expect(claim.allowed).toBe(true)
		expect(await prisma.demoAiUsage.count()).toBe(DEMO_AI_USES_PER_DAY)
	})

	test("yesterday's demo uses do not count against today", async () => {
		const userId = await newDemoUser()
		const yesterday = new Date(startOfUsageDay().getTime() - 60 * 60 * 1000)
		await prisma.demoAiUsage.createMany({
			data: Array.from({ length: DEMO_AI_USES_PER_DAY }, () => ({
				type: 'test_type',
				createdAt: yesterday,
			})),
		})

		const claim = await claimAiUsage(userId, 'test_type', {
			perUser: 3,
			demoPerDay: DEMO_AI_USES_PER_DAY,
		})

		expect(claim.allowed).toBe(true)
	})

	test('the refusals say what the demo allows and when its AI is used up', () => {
		const wording = {
			uses: 'AI imports',
			keepGoing: 'keep importing',
			unavailable: "Couldn't start the import just now.",
		}
		const demo = { perUser: 3, demoPerDay: 60 }

		expect(aiUsageRefusal('per-user', { limits: demo, ...wording })).toEqual({
			error: 'The demo allows 3 AI imports. Sign up to keep importing.',
			status: 429,
		})
		expect(aiUsageRefusal('demo-day', { limits: demo, ...wording })).toEqual({
			error:
				"The demo's AI is used up for today. Try again tomorrow, or sign up.",
			status: 429,
		})
		expect(
			aiUsageRefusal('per-user', { limits: { perUser: 10 }, ...wording }),
		).toEqual({
			error: "You've used today's 10 AI imports. Try again tomorrow.",
			status: 429,
		})
	})
})
