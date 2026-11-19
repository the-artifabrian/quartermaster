import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import v8 from 'node:v8'
import vm from 'node:vm'
import { type Transaction } from '@libsql/client'
import { expect, test, vi } from 'vitest'
import {
	createWalDatabase,
	settlesWithin,
	writeFromAnotherConnection,
} from '#tests/sqlite-concurrency.ts'
import { releaseWhenSettled } from './db.server.ts'
import { writeTransaction } from './write-transaction.server.ts'

// Prisma keeps a reference to the last 100 closed transactions, and through
// them to whatever the driver handed each one. More than that many shows
// whether a transaction's connection outlives it.
const TRANSACTIONS = 150

v8.setFlagsFromString('--expose-gc')
const collectGarbage = vm.runInNewContext('gc') as () => void

/**
 * Open SQLite connections to the database, counted by their descriptors on
 * its WAL file: each connection holds one. (Descriptors on the database file
 * itself are a poor count, because SQLite defers closing them while another
 * connection holds a lock.)
 */
function openConnections(url: string) {
	const wal = `${fs.realpathSync(url.slice('file:'.length))}-wal`
	let paths: string[]
	if (fs.existsSync('/proc/self/fd')) {
		paths = fs.readdirSync('/proc/self/fd').flatMap((fd) => {
			try {
				return [fs.readlinkSync(`/proc/self/fd/${fd}`)]
			} catch {
				return []
			}
		})
	} else {
		paths = execFileSync(
			'lsof',
			['-n', '-P', '-p', String(process.pid), '-Fn'],
			{ encoding: 'utf8' },
		)
			.split('\n')
			.filter((line) => line.startsWith('n'))
			.map((line) => line.slice(1))
	}
	return paths.filter((path) => path === wal).length
}

/** Connections still open once garbage collection has freed what it can. */
async function connectionsAfterCollection(url: string) {
	const deadline = Date.now() + 3_000
	let open = openConnections(url)
	while (open > 2 && Date.now() < deadline) {
		collectGarbage()
		await sleep(20)
		open = openConnections(url)
	}
	return open
}

test.each(['commit', 'fail a statement', 'throw'] as const)(
	'transactions that %s leave no connection open behind them',
	async (ending) => {
		await using database = await createWalDatabase()
		const { db, url } = database
		const household = await db.household.create({ data: { name: 'Start' } })
		const where = { id: household.id }

		for (let i = 0; i < TRANSACTIONS; i++) {
			await writeTransaction(db, async (tx) => {
				await tx.household.findUniqueOrThrow({ where })
				await tx.household.update({ where, data: { name: `Run ${i}` } })
				if (ending === 'fail a statement') {
					await tx.household.update({
						where: { id: 'missing' },
						data: { name: 'Never' },
					})
				}
				if (ending === 'throw') throw new Error('Stop')
			}).catch(() => {})
			await db.household.count()
			// Let the event loop turn between transactions, as it does between
			// requests.
			await new Promise((resolve) => setImmediate(resolve))
		}

		expect(await connectionsAfterCollection(url)).toBeLessThanOrEqual(2)
		const after = await db.household.findUniqueOrThrow({ where })
		expect(after.name).toBe(
			ending === 'commit' ? `Run ${TRANSACTIONS - 1}` : 'Start',
		)
	},
)

test('a transaction that fails on a write race leaves the client and the database usable', async () => {
	await using database = await createWalDatabase()
	const { db, url } = database
	const household = await db.household.create({ data: { name: 'Start' } })
	const where = { id: household.id }
	const rename = (name: string) =>
		writeFromAnotherConnection(
			url,
			'UPDATE "Household" SET "name" = ? WHERE "id" = ?',
			[name, household.id],
		).committed

	// A deferred transaction that reads, and then writes after another
	// connection has committed, fails at its write without waiting: SQLite
	// cannot upgrade a read snapshot that is out of date.
	await expect(
		db.$transaction(async (tx) => {
			await tx.household.findUniqueOrThrow({ where })
			await rename('Elsewhere')
			await tx.household.update({ where, data: { name: 'Lost' } })
		}),
	).rejects.toThrow()

	await db.household.update({ where, data: { name: 'Outside' } })
	await writeTransaction(db, (tx) =>
		tx.household.update({ where, data: { name: 'Inside' } }),
	)
	expect((await db.household.findUniqueOrThrow({ where })).name).toBe('Inside')
	// Nothing in this process still holds the write lock.
	expect(await settlesWithin(rename('Last'), 2_000)).toBe(true)
	expect((await db.household.findUniqueOrThrow({ where })).name).toBe('Last')
})

test('a second transaction on the client waits for the first and sees its write', async () => {
	await using database = await createWalDatabase()
	const { db } = database
	const household = await db.household.create({ data: { name: 'Start' } })
	const where = { id: household.id }
	let release!: () => void
	const held = new Promise<void>((resolve) => (release = resolve))
	let entered!: () => void
	const inside = new Promise<void>((resolve) => (entered = resolve))

	const first = writeTransaction(db, async (tx) => {
		await tx.household.update({ where, data: { name: 'First' } })
		entered()
		await held
	})
	await inside
	const second = writeTransaction(db, async (tx) => {
		const seen = await tx.household.findUniqueOrThrow({ where })
		await tx.household.update({
			where,
			data: { name: `${seen.name} then second` },
		})
	})
	expect(await settlesWithin(second, 300)).toBe(false)

	release()
	await first
	await second
	expect((await db.household.findUniqueOrThrow({ where })).name).toBe(
		'First then second',
	)
})

function fakeTransaction(overrides: Partial<Transaction> = {}) {
	return {
		execute: vi.fn(async () => ({}) as never),
		batch: vi.fn(async () => []),
		executeMultiple: vi.fn(async () => {}),
		commit: vi.fn(async () => {}),
		rollback: vi.fn(async () => {}),
		close: vi.fn(),
		closed: false,
		...overrides,
	} satisfies Transaction
}

test('a COMMIT that fails rolls the transaction back and reports the failure', async () => {
	const failure = new Error('SQLITE_BUSY')
	const inner = fakeTransaction({
		commit: vi.fn(async () => {
			throw failure
		}),
	})
	const transaction = releaseWhenSettled(inner)

	await expect(transaction.commit()).rejects.toBe(failure)
	expect(inner.close).toHaveBeenCalledOnce()
	expect(transaction.closed).toBe(true)
})

const failingRollback = {
	rollback: async () => {
		throw new Error('ROLLBACK failed')
	},
}

test.each([
	['commits', {}, (transaction: Transaction) => transaction.commit()],
	['rolls back', {}, (transaction: Transaction) => transaction.rollback()],
	[
		'fails to roll back',
		failingRollback,
		(transaction: Transaction) => transaction.rollback().catch(() => {}),
	],
	['closes', {}, (transaction: Transaction) => transaction.close()],
])(
	'once a transaction %s, it refuses statements without reaching the connection',
	async (_, overrides, settle) => {
		const inner = fakeTransaction(overrides)
		const transaction = releaseWhenSettled(inner)
		await settle(transaction)
		const commits = vi.mocked(inner.commit).mock.calls.length

		expect(transaction.closed).toBe(true)
		await expect(transaction.execute('SELECT 1')).rejects.toMatchObject({
			code: 'TRANSACTION_CLOSED',
		})
		await expect(transaction.commit()).rejects.toMatchObject({
			code: 'TRANSACTION_CLOSED',
		})
		expect(inner.execute).not.toHaveBeenCalled()
		expect(inner.commit).toHaveBeenCalledTimes(commits)
	},
)
