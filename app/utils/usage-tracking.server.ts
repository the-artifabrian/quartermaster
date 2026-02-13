import { prisma } from './db.server.ts'

/**
 * Fire-and-forget usage event tracker.
 * Similar pattern to emitHouseholdEvent but for long-term analytics —
 * no SSE, no notification system, just a DB write with silent failure.
 */
export function trackEvent(
	userId: string,
	householdId: string,
	type: string,
	payload?: Record<string, unknown>,
) {
	prisma.usageEvent
		.create({
			data: {
				type,
				payload: JSON.stringify(payload ?? {}),
				userId,
				householdId,
			},
		})
		.catch(() => {})
}
