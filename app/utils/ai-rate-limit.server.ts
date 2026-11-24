import { type Prisma, type PrismaClient } from '#app/generated/prisma/client.ts'
import { prisma } from './db.server.ts'
import {
	DEMO_AI_USES_PER_DAY,
	DEMO_AI_USES_PER_FEATURE,
	isDemoUser,
} from './demo.ts'
import { writeTransaction } from './write-transaction.server.ts'

/**
 * A usage type's daily caps. `perUser` limits one user. `demoPerDay` is set
 * only for a demo user: the uses all demo users share in a day, counted in
 * `DemoAiUsage`. An options object, so a cap of another kind can join it
 * without changing callers.
 */
export type AiUsageLimits = { perUser: number; demoPerDay?: number }

/** The paid AI features, by the usage type each records. */
export type AiFeature =
	| 'recipe_extract_llm_call'
	| 'recipe_enhance_llm_call'
	| 'voice_transcribe_call'

/** Each feature's daily cap for a real user. */
const DAILY_LIMITS: Record<AiFeature, number> = {
	recipe_extract_llm_call: 10,
	recipe_enhance_llm_call: 10,
	// Each use is one Whisper clip plus one small Haiku call, a fraction of a
	// cent. Thirty covers a big weekly shop said one item at a time, retries
	// included, so nobody using the app for real should hit it. It caps what
	// one account can spend in a day, and every new signup gets a Pro trial.
	voice_transcribe_call: 30,
}

/**
 * A user's caps on one feature: a real user's own, or for a demo user the
 * demo's few uses and the shared daily cap.
 */
export async function aiUsageLimitsFor(
	userId: string,
	feature: AiFeature,
	db: PrismaClient = prisma,
): Promise<AiUsageLimits> {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { demoExpiresAt: true },
	})
	if (user && isDemoUser(user)) {
		return {
			perUser: DEMO_AI_USES_PER_FEATURE,
			demoPerDay: DEMO_AI_USES_PER_DAY,
		}
	}
	return { perUser: DAILY_LIMITS[feature] }
}

export type AiUsageClaim =
	| {
			allowed: true
			/**
			 * Give the slot back, for a call that failed in a way the user
			 * can't cause.
			 * Calling it twice does nothing the second time.
			 */
			refund: () => Promise<void>
	  }
	| { allowed: false; reason: 'per-user' | 'demo-day' | 'unavailable' }

/**
 * When today's uses began: local midnight on the server. The daily prune in
 * `server/scheduled-maintenance.ts` keeps rows from here on, so both use this.
 */
export function startOfUsageDay(now = new Date()) {
	const start = new Date(now)
	start.setHours(0, 0, 0, 0)
	return start
}

type Recorded =
	| { allowed: true; id: string; demoId: string | null }
	| { allowed: false; reason: 'per-user' | 'demo-day' }

async function countAndRecord(
	tx: Prisma.TransactionClient,
	userId: string,
	type: string,
	limits: AiUsageLimits,
): Promise<Recorded> {
	const since = startOfUsageDay()
	const used = await tx.usageEvent.count({
		where: { userId, type, createdAt: { gte: since } },
	})
	if (used >= limits.perUser) return { allowed: false, reason: 'per-user' }

	// A demo use takes a shared slot too. The rows aren't tied to the user,
	// so a demo user removed at expiry still counts until the day is over.
	let demoId: string | null = null
	if (limits.demoPerDay != null) {
		const demoUsed = await tx.demoAiUsage.count({
			where: { createdAt: { gte: since } },
		})
		if (demoUsed >= limits.demoPerDay) {
			return { allowed: false, reason: 'demo-day' }
		}
		;({ id: demoId } = await tx.demoAiUsage.create({
			data: { type },
			select: { id: true },
		}))
	}

	const { id } = await tx.usageEvent.create({
		data: { type, userId },
		select: { id: true },
	})
	return { allowed: true, id, demoId }
}

/**
 * Take one of today's uses of a paid AI feature, or say why not.
 *
 * The count and the insert run in one transaction that holds the write lock
 * from the start, so parallel requests queue instead of all counting the same
 * total and all passing. For a demo user the shared demo count and its row
 * are in the same transaction. A claim that cannot be recorded is refused,
 * because letting it through would make a busy database an unlimited slot.
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

	const { id, demoId } = recorded
	let refunded = false
	return {
		allowed: true,
		async refund() {
			if (refunded) return
			refunded = true
			try {
				await db.$transaction([
					db.usageEvent.deleteMany({ where: { id } }),
					...(demoId
						? [db.demoAiUsage.deleteMany({ where: { id: demoId } })]
						: []),
				])
			} catch (error) {
				console.error('Failed to refund AI usage event:', error)
			}
		},
	}
}

/**
 * What to tell a user whose claim was refused, and the status to answer with.
 * `limits` is what the claim was made with. `uses` names the feature's uses
 * in the plural, as in "10 AI imports", and `keepGoing` what a demo user
 * would sign up to go on doing, as in "keep importing". `unavailable` says
 * what couldn't start, as in "Couldn't start the import just now."
 */
export function aiUsageRefusal(
	reason: Extract<AiUsageClaim, { allowed: false }>['reason'],
	{
		limits,
		uses,
		keepGoing,
		unavailable,
	}: {
		limits: AiUsageLimits
		uses: string
		keepGoing: string
		unavailable: string
	},
): { error: string; status: 429 | 503 } {
	switch (reason) {
		case 'per-user':
			if (limits.demoPerDay != null) {
				return {
					error: `The demo allows ${limits.perUser} ${uses}. Sign up to ${keepGoing}.`,
					status: 429,
				}
			}
			return {
				error: `You've used today's ${limits.perUser} ${uses}. Try again tomorrow.`,
				status: 429,
			}
		case 'demo-day':
			return {
				error:
					"The demo's AI is used up for today. Try again tomorrow, or sign up.",
				status: 429,
			}
		case 'unavailable':
			return { error: `${unavailable} Try again in a minute.`, status: 503 }
	}
}
