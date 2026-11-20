import { type Prisma, type PrismaClient } from '#app/generated/prisma/client.ts'
import { prisma } from './db.server.ts'
import { writeTransaction } from './write-transaction.server.ts'

/**
 * A usage type's daily caps. `perUser` limits one user. `global`, when given,
 * also limits every user together, for a feature open to anyone (a public
 * demo) where many accounts could share one budget.
 */
export type AiUsageLimits = { perUser: number; global?: number }

export type AiUsageClaim =
	| {
			allowed: true
			/**
			 * Give the slot back, for a call the provider cannot have billed.
			 * Calling it twice does nothing the second time.
			 */
			refund: () => Promise<void>
	  }
	| { allowed: false; reason: 'per-user' | 'global' | 'unavailable' }

/**
 * Global uses are recorded a second time under this user, so deleting the
 * accounts that spent a global budget does not hand it back. Their own rows
 * go with them and these stay. The row exists only once a caller passes a
 * global cap. Its username fails `UsernameSchema` and its email cannot receive
 * mail, so no signup can take either.
 */
const USAGE_LEDGER_USER = {
	id: 'usage-ledger',
	username: 'usage-ledger:system',
	email: 'usage-ledger@system.invalid',
	name: 'Usage ledger',
}

function globalType(type: string) {
	return `global:${type}`
}

function startOfToday() {
	const start = new Date()
	start.setHours(0, 0, 0, 0)
	return start
}

type Recorded =
	| { allowed: true; ids: string[] }
	| { allowed: false; reason: 'per-user' | 'global' }

async function countAndRecord(
	tx: Prisma.TransactionClient,
	userId: string,
	type: string,
	limits: AiUsageLimits,
): Promise<Recorded> {
	const since = startOfToday()
	const used = await tx.usageEvent.count({
		where: { userId, type, createdAt: { gte: since } },
	})
	if (used >= limits.perUser) return { allowed: false, reason: 'per-user' }

	if (limits.global !== undefined) {
		const usedGlobally = await tx.usageEvent.count({
			where: { type: globalType(type), createdAt: { gte: since } },
		})
		if (usedGlobally >= limits.global) {
			return { allowed: false, reason: 'global' }
		}
	}

	const own = await tx.usageEvent.create({
		data: { type, userId },
		select: { id: true },
	})
	const ids = [own.id]
	if (limits.global !== undefined) {
		await tx.user.upsert({
			where: { id: USAGE_LEDGER_USER.id },
			update: {},
			create: USAGE_LEDGER_USER,
		})
		const global = await tx.usageEvent.create({
			data: { type: globalType(type), userId: USAGE_LEDGER_USER.id },
			select: { id: true },
		})
		ids.push(global.id)
	}
	return { allowed: true, ids }
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

	let ids: string[] | null = recorded.ids
	return {
		allowed: true,
		async refund() {
			if (!ids) return
			const refunding = ids
			ids = null
			try {
				await db.usageEvent.deleteMany({ where: { id: { in: refunding } } })
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
		case 'global':
			return {
				error: `That's all the ${uses} for today. Try again tomorrow.`,
				status: 429,
			}
		case 'unavailable':
			return {
				error: "Couldn't start that just now. Try again in a moment.",
				status: 503,
			}
	}
}
