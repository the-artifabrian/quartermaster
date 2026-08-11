import { styleText } from 'node:util'
import { remember } from '@epic-web/remember'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaClient } from '#app/generated/prisma/client.ts'
import { runInBackground } from './background.server.ts'

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) {
	// NOTE: if you change anything in this function you'll need to restart
	// the dev server to see your changes.

	// Feel free to change this log threshold to something that makes sense for you
	const logThreshold = 20

	const adapter = new PrismaLibSql({ url: databaseUrl })
	const client = new PrismaClient({
		adapter,
		log: [
			{ level: 'query', emit: 'event' },
			{ level: 'error', emit: 'stdout' },
			{ level: 'warn', emit: 'stdout' },
		],
	})
	client.$on('query', async (e) => {
		if (e.duration < logThreshold) return
		const color =
			e.duration < logThreshold * 1.1
				? 'green'
				: e.duration < logThreshold * 1.2
					? 'blue'
					: e.duration < logThreshold * 1.3
						? 'yellow'
						: e.duration < logThreshold * 1.4
							? 'redBright'
							: 'red'
		const dur = styleText(color, `${e.duration}ms`)
		console.info(`prisma:query - ${dur} - ${e.query}`)
	})
	// Set busy_timeout so SQLite waits for locks instead of failing with
	// SQLITE_BUSY immediately. This prevents write contention between the main
	// request and fire-and-forget background writes (household events, usage tracking).
	runInBackground(
		client
			.$connect()
			.then(() => client.$queryRawUnsafe('PRAGMA busy_timeout = 5000')),
		'configuring the SQLite busy timeout',
	)
	return client
}

export const prisma = remember('prisma', () => createPrismaClient())
