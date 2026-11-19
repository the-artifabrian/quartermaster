import { styleText } from 'node:util'
import { remember } from '@epic-web/remember'
import {
	type Client,
	type Config,
	LibsqlError,
	type Transaction,
} from '@libsql/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaClient } from '#app/generated/prisma/client.ts'

export const SQLITE_BUSY_TIMEOUT_MS = 5_000

/**
 * The libsql adapter, with transactions that let go of their connection when
 * they end.
 *
 * libSQL runs each interactive transaction on a native connection of its own
 * and never closes it, and Prisma keeps a reference to its last 100 closed
 * transactions. Together they keep up to 100 connections open, each with its
 * own page cache, parsed schema and file descriptors. Once nothing refers to a
 * connection, garbage collection frees it. Closing it would free it no sooner:
 * libSQL holds the files until the collector finalises the connection's
 * statements.
 */
class PrismaLibSqlReleasingTransactions extends PrismaLibSql {
	override createClient(config: Config): Client {
		const client = super.createClient(config)
		return new Proxy(client, {
			get(target, key) {
				if (key === 'transaction') {
					return async (...args: Parameters<Client['transaction']>) =>
						releaseWhenSettled(await target.transaction(...args))
				}
				// libSQL keeps its state in private fields, which only the real
				// client can read, so its methods run with it as `this`.
				const value: unknown = Reflect.get(target, key, target)
				return typeof value === 'function' ? value.bind(target) : value
			},
		})
	}
}

/**
 * A libSQL transaction that drops its reference to the underlying one, and so
 * to its connection, once it commits, rolls back or closes. A COMMIT that fails
 * leaves the transaction open, holding its locks, and the Prisma adapter does
 * not roll back after it, so that path rolls back before letting go.
 */
export function releaseWhenSettled(transaction: Transaction): Transaction {
	let open: Transaction | null = transaction
	function current() {
		if (open) return open
		throw new LibsqlError('The transaction is closed', 'TRANSACTION_CLOSED')
	}
	return {
		async execute(stmt) {
			return current().execute(stmt)
		},
		async batch(stmts) {
			return current().batch(stmts)
		},
		async executeMultiple(sql) {
			return current().executeMultiple(sql)
		},
		async commit() {
			const settling = current()
			try {
				await settling.commit()
			} catch (error) {
				try {
					settling.close()
				} catch {
					// The connection is unusable. Collecting it releases its locks.
				}
				throw error
			} finally {
				open = null
			}
		},
		async rollback() {
			const settling = open
			if (!settling) return
			try {
				await settling.rollback()
			} finally {
				open = null
			}
		},
		close() {
			const settling = open
			open = null
			settling?.close()
		},
		get closed() {
			return open === null || open.closed
		},
	}
}

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) {
	// NOTE: if you change anything in this function you'll need to restart
	// the dev server to see your changes.

	// Feel free to change this log threshold to something that makes sense for you
	const logThreshold = 20

	// Configure the driver rather than one connection via PRAGMA. libSQL can
	// open a fresh connection after a transaction, and the driver-level option
	// applies the timeout to every connection it creates.
	const adapter = new PrismaLibSqlReleasingTransactions({
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
