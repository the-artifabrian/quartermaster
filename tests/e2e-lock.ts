import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Runs `work` while no other test holding the same lock runs, across
 * Playwright's workers, which are separate processes. For tests that need
 * shared state other tests change, such as the count of AI uses all demo
 * users share in a day.
 *
 * It's a ticket lock in a directory beside the test database, so each run
 * has its own (scripts/e2e.sh makes a new database directory every run).
 *
 * - Taking a ticket hard-links a file holding the taker's pid to the next
 *   free `ticket-<n>`. A link fails if the name exists, so each number goes
 *   to one taker, its pid is there the moment it exists, and every lower
 *   number was taken before it.
 * - A ticket's turn comes when no lower ticket is still waiting or holding:
 *   each lower one is either given up (`done-<n>` exists) or its process is
 *   gone (`process.kill(pid, 0)` throws). A worker that died holding the
 *   lock is passed over at once, by every waiter alike, and nothing is ever
 *   taken back or removed, so no two waiters can both take it over.
 * - Numbers are never reused: a given-up ticket keeps its file.
 */
const WAIT_MS = 40 * 1000
const POLL_MS = 50

function lockDirectory(name: string) {
	const databasePath = process.env.DATABASE_PATH ?? './prisma/data.db'
	return path.join(path.dirname(path.resolve(databasePath)), 'e2e-locks', name)
}

const ticketNumber = (file: string) => Number(file.split('-')[1])

function isRunning(pid: number) {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		// EPERM: it runs, as another user.
		return (error as NodeJS.ErrnoException).code === 'EPERM'
	}
}

async function takeTicket(dir: string) {
	const draft = path.join(dir, `draft-${process.pid}-${randomUUID()}`)
	await fs.writeFile(draft, String(process.pid))
	try {
		const files = await fs.readdir(dir)
		let n =
			Math.max(
				0,
				...files.filter((f) => f.startsWith('ticket-')).map(ticketNumber),
			) + 1
		for (;;) {
			try {
				await fs.link(draft, path.join(dir, `ticket-${n}`))
				return n
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
				n++
			}
		}
	} finally {
		await fs.rm(draft, { force: true })
	}
}

/** Whether every ticket below `mine` is given up or its process is gone. */
async function isMyTurn(dir: string, mine: number) {
	const files = new Set(await fs.readdir(dir))
	for (const file of files) {
		if (!file.startsWith('ticket-')) continue
		const n = ticketNumber(file)
		if (n >= mine || files.has(`done-${n}`)) continue
		const pid = Number(await fs.readFile(path.join(dir, file), 'utf8'))
		if (isRunning(pid)) return false
	}
	return true
}

export async function exclusively<T>(name: string, work: () => Promise<T>) {
	const dir = lockDirectory(name)
	await fs.mkdir(dir, { recursive: true })
	const mine = await takeTicket(dir)
	const giveUp = () => fs.writeFile(path.join(dir, `done-${mine}`), '')
	try {
		const giveUpAt = Date.now() + WAIT_MS
		while (!(await isMyTurn(dir, mine))) {
			if (Date.now() > giveUpAt) {
				throw new Error(`Waited too long for the e2e lock "${name}"`)
			}
			await new Promise((resolve) => setTimeout(resolve, POLL_MS))
		}
		return await work()
	} finally {
		await giveUp()
	}
}
