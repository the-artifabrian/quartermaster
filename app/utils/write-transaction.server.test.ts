import { expect, test } from 'vitest'
import {
	createWalDatabase,
	settlesWithin,
	writeFromAnotherConnection,
} from '#tests/sqlite-concurrency.ts'
import { writeTransaction } from './write-transaction.server.ts'

test('holds the write lock from its first statement, though that statement matches no row', async () => {
	await using database = await createWalDatabase()
	const { db, url } = database
	const household = await db.household.create({ data: { name: 'Before' } })
	const events: string[] = []
	let lockTaken!: () => void
	const inside = new Promise<void>((resolve) => (lockTaken = resolve))
	let finish!: () => void
	const held = new Promise<void>((resolve) => (finish = resolve))

	// The work runs no statement of its own: only the lock is held.
	const transaction = writeTransaction(db, async () => {
		lockTaken()
		await held
	}).then(() => events.push('transaction committed'))
	await inside
	const other = writeFromAnotherConnection(
		url,
		'UPDATE "Household" SET "name" = ? WHERE "id" = ?',
		['After', household.id],
	)
	const committed = other.committed.then(() =>
		events.push('other write committed'),
	)
	await other.executing
	expect(await settlesWithin(committed, 300)).toBe(false)

	finish()
	await Promise.all([transaction, committed])
	expect(events).toEqual(['transaction committed', 'other write committed'])
	const after = await db.household.findUniqueOrThrow({
		where: { id: household.id },
		select: { name: true },
	})
	expect(after.name).toBe('After')
})
