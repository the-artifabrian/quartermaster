import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '#app/utils/db.server.ts'

/**
 * Runs `work` while no other test holding the same lock runs, across
 * Playwright's workers, which are separate processes. For tests that need
 * shared state other tests change, such as the count of AI uses all demo
 * users share in a day.
 *
 * The lock is a directory beside the test database, so each run has its own
 * (scripts/e2e.sh makes a new database directory every run). A lock older
 * than STALE_MS, a little over a slow test's timeout, is taken as left by a
 * worker that died.
 */
const STALE_MS = 50 * 1000
const WAIT_MS = 60 * 1000

export async function exclusively<T>(name: string, work: () => Promise<T>) {
	const databasePath = process.env.DATABASE_PATH ?? './prisma/data.db'
	const lock = path.join(
		path.dirname(path.resolve(databasePath)),
		'e2e-locks',
		name,
	)
	await fs.mkdir(path.dirname(lock), { recursive: true })
	const giveUpAt = Date.now() + WAIT_MS
	for (;;) {
		try {
			await fs.mkdir(lock)
			break
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
			const since = await fs.stat(lock).then(
				(stat) => Date.now() - stat.mtimeMs,
				() => 0,
			)
			if (since > STALE_MS) {
				await fs.rm(lock, { recursive: true, force: true })
				continue
			}
			if (Date.now() > giveUpAt) {
				throw new Error(`Waited too long for the e2e lock "${name}"`)
			}
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}
	try {
		return await work()
	} finally {
		await fs.rm(lock, { recursive: true, force: true })
	}
}

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
