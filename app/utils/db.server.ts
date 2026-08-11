import { styleText } from 'node:util'
import { remember } from '@epic-web/remember'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaClient } from '#app/generated/prisma/client.ts'

export const SQLITE_BUSY_TIMEOUT_MS = 5_000

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) {
	// NOTE: if you change anything in this function you'll need to restart
	// the dev server to see your changes.

	// Feel free to change this log threshold to something that makes sense for you
	const logThreshold = 20

	// Configure the driver rather than one connection via PRAGMA. libSQL can
	// open a fresh connection after a transaction, and the driver-level option
	// applies the timeout to every connection it creates.
	const adapter = new PrismaLibSql({
		url: databaseUrl,
		timeout: SQLITE_BUSY_TIMEOUT_MS,
	})
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
	return client
}

export const prisma = remember('prisma', () => createPrismaClient())
