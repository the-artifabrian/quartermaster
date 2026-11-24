import { prisma } from '#app/utils/db.server.ts'
import { exclusively } from './e2e-lock.ts'

/**
 * Runs `work` as the only test using the AI uses all demo users share in a
 * day. Every demo AI use in the e2e suite runs under it, so it starts by
 * clearing the count: uses earlier tests made, or added and didn't get to
 * remove, would otherwise add up to the day's cap over a long run and refuse
 * the next import. (Rows from other days don't count; they go too.)
 */
export function withDemoAiUses<T>(work: () => Promise<T>) {
	return exclusively('demo-ai-uses', async () => {
		await prisma.demoAiUsage.deleteMany()
		return work()
	})
}
