import { prisma } from './db.server.ts'

/**
 * Check rate limit and record usage if allowed.
 *
 * Returns { allowed, remaining }.
 * DB write failure is non-fatal — allows the call through.
 * Rate limiting is a safety net, not a correctness requirement.
 */
export async function checkAndRecordAiUsage(
	userId: string,
	type: string,
	limit: number,
): Promise<{ allowed: boolean; remaining: number }> {
	const startOfDay = new Date()
	startOfDay.setHours(0, 0, 0, 0)

	const count = await prisma.usageEvent.count({
		where: { userId, type, createdAt: { gte: startOfDay } },
	})

	if (count >= limit) {
		return { allowed: false, remaining: 0 }
	}

	try {
		await prisma.usageEvent.create({
			data: { type, userId },
		})
	} catch (error) {
		console.error('Failed to record AI usage event:', error)
	}

	return { allowed: true, remaining: Math.max(0, limit - count - 1) }
}
