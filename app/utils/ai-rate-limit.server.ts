import { type Prisma, type PrismaClient } from '#app/generated/prisma/client.ts'
import { prisma } from './db.server.ts'
import { writeTransaction } from './write-transaction.server.ts'

/**
 * A usage type's daily caps. `perUser` limits one user. An options object, so
 * a cap of another kind can join it without changing callers.
 */
export type AiUsageLimits = { perUser: number }

export type AiUsageClaim =
	| {
			allowed: true
			/**
			 * Give the slot back, for a call the provider cannot have billed.
			 * Calling it twice does nothing the second time.
			 */
			refund: () => Promise<void>
	  }
	| { allowed: false; reason: 'per-user' | 'unavailable' }

function startOfToday() {
	const start = new Date()
	start.setHours(0, 0, 0, 0)
	return start
}

type Recorded =
	{ allowed: true; id: string } | { allowed: false; reason: 'per-user' }

async function countAndRecord(
	tx: Prisma.TransactionClient,
	userId: string,
	type: string,
	limits: AiUsageLimits,
): Promise<Recorded> {
	const used = await tx.usageEvent.count({
		where: { userId, type, createdAt: { gte: startOfToday() } },
	})
	if (used >= limits.perUser) return { allowed: false, reason: 'per-user' }

	const { id } = await tx.usageEvent.create({
		data: { type, userId },
		select: { id: true },
	})
	return { allowed: true, id }
}

/**
 * Take one of today's uses of a paid AI feature, or say why not.
 *
 * The count and the insert run in one transaction that holds the write lock
 * from the start, so parallel requests queue instead of all counting the same
 * total and all passing. A claim that cannot be recorded is refused, because
 * letting it through would make a busy database an unlimited slot.
 */
export async function claimAiUsage(
	userId: string,
	type: string,
	limits: AiUsageLimits,
	db: PrismaClient = prisma,
): Promise<AiUsageClaim> {
	let recorded: Recorded
	try {
		recorded = await writeTransaction(db, (tx) =>
			countAndRecord(tx, userId, type, limits),
		)
	} catch (error) {
		console.error('Failed to record AI usage event:', error)
		return { allowed: false, reason: 'unavailable' }
	}
	if (!recorded.allowed) return recorded

	const { id } = recorded
	let refunded = false
	return {
		allowed: true,
		async refund() {
			if (refunded) return
			refunded = true
			try {
				await db.usageEvent.deleteMany({ where: { id } })
			} catch (error) {
				console.error('Failed to refund AI usage event:', error)
			}
		},
	}
}

/**
 * What to tell a user whose claim was refused, and the status to answer with.
 * `uses` names the feature's uses in the plural, as in "10 photo imports".
 */
export function aiUsageRefusal(
	reason: Extract<AiUsageClaim, { allowed: false }>['reason'],
	{ limit, uses }: { limit: number; uses: string },
): { error: string; status: 429 | 503 } {
	switch (reason) {
		case 'per-user':
			return {
				error: `That's ${limit} ${uses} today. Try again tomorrow.`,
				status: 429,
			}
		case 'unavailable':
			return {
				error: "Couldn't start that just now. Try again in a moment.",
				status: 503,
			}
	}
}
