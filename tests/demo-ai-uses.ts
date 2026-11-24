import { prisma } from '#app/utils/db.server.ts'
import { exclusively } from './e2e-lock.ts'

/** The `type` of the shared AI uses a test adds to fill the demo's day. */
export const SEEDED_DEMO_AI_USE = 'e2e-seeded'

/**
 * Runs `work` as the only test using the AI uses all demo users share in a
 * day. Uses a test added and didn't get to remove (it died partway) go
 * first, so they can't refuse the next test's imports.
 */
export function withDemoAiUses<T>(work: () => Promise<T>) {
	return exclusively('demo-ai-uses', async () => {
		await prisma.demoAiUsage.deleteMany({ where: { type: SEEDED_DEMO_AI_USE } })
		return work()
	})
}
