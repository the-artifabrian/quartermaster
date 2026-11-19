import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { createClient } from '@libsql/client'
import { inject } from 'vitest'
import { createPrismaClient } from '#app/utils/db.server.ts'
import { BASE_DATABASE_PATH } from './setup/database-paths.ts'

/**
 * A fresh copy of the migrated template in WAL mode, as production runs it,
 * with its own Prisma client. Read-then-write races fail differently under the
 * rollback journal the template uses. A separate file keeps WAL connections
 * away from the shared worker database that `db-setup.ts` replaces before
 * every test.
 */
export async function createWalDatabase() {
	const file = path.join(
		inject('databaseRunDirectory'),
		`wal-${randomUUID()}.db`,
	)
	await fs.copyFile(BASE_DATABASE_PATH, file)
	const url = `file:${file}`
	const setup = createClient({ url })
	const result = await setup.execute('PRAGMA journal_mode = WAL')
	setup.close()
	const mode = String(result.rows[0]?.journal_mode)
	if (mode !== 'wal') throw new Error(`Test database stayed in ${mode} mode`)
	const db = createPrismaClient(url)
	return {
		url,
		db,
		async [Symbol.asyncDispose]() {
			await db.$disconnect()
			await Promise.all(
				['', '-wal', '-shm'].map((suffix) =>
					fs.rm(`${file}${suffix}`, { force: true }),
				),
			)
		},
	}
}

/**
 * One write from a separate connection on its own thread, as another server
 * process would make it. A local libSQL connection blocks its thread while it
 * waits out the busy timeout, so a second connection on the test's own thread
 * would freeze the transaction it is waiting for.
 *
 * `executing` resolves once the thread has opened its connection and sent the
 * statement; `committed` once the write is done and the thread has exited.
 */
export function writeFromAnotherConnection(
	url: string,
	sql: string,
	args: Array<string | number | null> = [],
) {
	const worker = new Worker(
		`
		const { parentPort, workerData } = require('node:worker_threads')
		const { createClient } = require('@libsql/client')
		const client = createClient({ url: workerData.url, timeout: 5000 })
		parentPort.postMessage({ executing: true })
		client
			.execute({ sql: workerData.sql, args: workerData.args })
			.then(
				() => ({ ok: true }),
				(error) => ({ ok: false, error: String(error) }),
			)
			.then((result) => {
				client.close()
				parentPort.postMessage(result)
			})
		`,
		{ eval: true, workerData: { url, sql, args } },
	)
	type Message = { executing?: true; ok?: boolean; error?: string }
	const executing = new Promise<void>((resolve, reject) => {
		worker.once('error', reject)
		worker.on('message', (message: Message) => {
			if (message.executing) resolve()
		})
	})
	const committed = new Promise<void>((resolve, reject) => {
		worker.once('error', reject)
		worker.on('message', (message: Message) => {
			if (message.executing) return
			worker.once('exit', () =>
				message.ok ? resolve() : reject(new Error(message.error)),
			)
		})
	})
	return { executing, committed }
}

/** Whether `promise` settles within `ms`, without waiting longer. */
export function settlesWithin(promise: Promise<unknown>, ms: number) {
	return Promise.race([
		promise.then(
			() => true,
			() => true,
		),
		new Promise<false>((resolve) => setTimeout(() => resolve(false), ms)),
	])
}
