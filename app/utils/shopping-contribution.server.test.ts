/**
 * Failure list for the Meal → Shopping writers (shopping-contribution.server.ts)
 *
 * Reads and writes in one transaction (Meal add, Update Shopping):
 * - A shopper checks the target row, with the version they saw, after the add
 *   reads the list and before it writes. The new demand must not end up
 *   counted on that checked row.
 * - The target row is deleted after the read and before the write. The add
 *   must not fail with a missing row.
 * - Two adds of the same Meal with different line sets run at once (the
 *   multiplier changed between them). Each line is recorded once, and the
 *   second add's new lines are not lost.
 * - Update Shopping races a check the same way.
 *
 * Checked rows on Update Shopping (#226 rule):
 * - The Meal's demand on a checked row changed. The checked row keeps what it
 *   showed, and the Meal's current demand goes on an unchecked row.
 * - Two Meals fed the checked row and one of them changed. The row still
 *   shows both amounts, and the other Meal's share is untouched.
 * - The changed demand finds an unchecked row of the same ingredient in
 *   Later. It joins that row, which moves to Next shop.
 * - Unchanged demand on a checked row stays where it is.
 * - The Meal no longer needs the ingredient. The checked row stays as bought.
 * - A checked row left with no live Meal share is not cleaned up as empty.
 */
import { describe, expect, test } from 'vitest'
import { type Prisma, type PrismaClient } from '#app/generated/prisma/client.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	createWalDatabase,
	settlesWithin,
	writeFromAnotherConnection,
} from '#tests/sqlite-concurrency.ts'
import {
	reconcileMealShoppingContributions,
	replaceMealShoppingContributions,
} from './shopping-contribution.server.ts'
import { combineRowDisplay, demandIdentity } from './shopping-demand.server.ts'

type Db = PrismaClient | Prisma.TransactionClient

function line(name: string, quantity: string | null, unit: string | null) {
	return {
		name,
		canonicalName: demandIdentity(name),
		quantity,
		unit,
		category: 'produce',
	}
}

async function seedHousehold(db: Db) {
	const user = await db.user.create({ data: createUser() })
	const household = await db.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const list = await db.shoppingList.create({
		data: { userId: user.id, householdId: household.id },
	})
	const mealPlan = await db.mealPlan.create({
		data: { householdId: household.id, weekStart: new Date('2026-11-16') },
	})
	const meal = (order: number) =>
		db.meal.create({
			data: { mealPlanId: mealPlan.id, date: new Date('2026-11-17'), order },
		})
	return { user, household, list, meal }
}

async function displayed(db: Db, listId: string) {
	const rows = await db.shoppingListItem.findMany({
		where: { listId },
		orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		include: { mealContributions: { select: { quantity: true, unit: true } } },
	})
	return rows.map(({ mealContributions, ...row }) => ({
		id: row.id,
		name: row.name,
		checked: row.checked,
		horizon: row.horizon,
		display: combineRowDisplay({ ...row, contributions: mealContributions }),
	}))
}

/**
 * Runs `afterRead` once, right after the writer's first read of Shopping
 * rows, whether that read goes through the client or a transaction on it.
 */
function pauseAfterFirstRowRead(
	db: PrismaClient,
	afterRead: () => Promise<void>,
): PrismaClient {
	let fired = false
	const wrap = <T extends object>(client: T): T =>
		new Proxy(client, {
			get(target, key) {
				const value = Reflect.get(target, key)
				if (key === 'shoppingListItem') {
					return new Proxy(value as object, {
						get(rows, method) {
							const fn = Reflect.get(rows, method)
							if (method !== 'findMany') {
								return typeof fn === 'function' ? fn.bind(rows) : fn
							}
							return async (...args: unknown[]) => {
								const found = await fn.apply(rows, args)
								if (!fired) {
									fired = true
									await afterRead()
								}
								return found
							}
						},
					})
				}
				if (key === '$transaction') {
					return (work: unknown, options?: unknown) =>
						typeof work === 'function'
							? (target as PrismaClient).$transaction(
									(tx) => work(wrap(tx)),
									options as never,
								)
							: (target as PrismaClient).$transaction(work as never)
				}
				return typeof value === 'function' ? value.bind(target) : value
			},
		})
	return wrap(db)
}

/**
 * A write from another connection, started after the writer's first read.
 * It waits a moment for the write to land, which it does at once unless the
 * writer already holds the write lock.
 */
function startAfterRead(
	url: string,
	sql: string,
	args: Array<string | number>,
) {
	let other: ReturnType<typeof writeFromAnotherConnection> | undefined
	return {
		async afterRead() {
			other = writeFromAnotherConnection(url, sql, args)
			await other.executing
			await settlesWithin(other.committed, 300)
		},
		committed: () => other?.committed,
	}
}

describe('Meal add reads and writes in one transaction', () => {
	test('a check landing between the read and the write never ends up covering new demand', async () => {
		await using database = await createWalDatabase()
		const { db: wal, url } = database
		const { list, meal } = await seedHousehold(wal)
		const mealA = await meal(0)
		const mealB = await meal(1)
		await reconcileMealShoppingContributions(wal, {
			mealId: mealA.id,
			listId: list.id,
			lines: [line('onion', '2', null)],
		})
		const onion = await wal.shoppingListItem.findFirstOrThrow({
			where: { listId: list.id },
		})

		// The shopper checks the row they saw, at the version they saw.
		const check = startAfterRead(
			url,
			'UPDATE "ShoppingListItem" SET "checked" = 1 WHERE "id" = ? AND "checkVersion" = ? AND "checked" = 0',
			[onion.id, onion.checkVersion],
		)
		await reconcileMealShoppingContributions(
			pauseAfterFirstRowRead(wal, check.afterRead),
			{ mealId: mealB.id, listId: list.id, lines: [line('onion', '3', null)] },
		)
		await check.committed()

		const contributions = await wal.mealShoppingContribution.findMany({
			include: { item: { select: { checked: true } } },
		})
		const mealBShare = contributions.find((c) => c.mealId === mealB.id)
		expect(mealBShare).toBeDefined()
		const checkedRow = await wal.shoppingListItem.findUniqueOrThrow({
			where: { id: onion.id },
		})
		// Either the check landed first and Meal B's demand sits on its own
		// unchecked row, or Meal B's demand landed first and the check, made
		// against the older version, changed nothing.
		if (checkedRow.checked) {
			expect(mealBShare!.itemId).not.toBe(onion.id)
			expect(mealBShare!.item.checked).toBe(false)
		} else {
			expect(mealBShare!.itemId).toBe(onion.id)
		}
		expect(
			contributions.filter((c) => c.item.checked && c.mealId === mealB.id),
		).toEqual([])
	})

	test('a row deleted between the read and the write does not fail the add', async () => {
		await using database = await createWalDatabase()
		const { db: wal, url } = database
		const { list, meal } = await seedHousehold(wal)
		const mealA = await meal(0)
		const manual = await wal.shoppingListItem.create({
			data: { listId: list.id, name: 'onion', quantity: '1', source: 'manual' },
		})

		const remove = startAfterRead(
			url,
			'DELETE FROM "ShoppingListItem" WHERE "id" = ?',
			[manual.id],
		)
		await expect(
			reconcileMealShoppingContributions(
				pauseAfterFirstRowRead(wal, remove.afterRead),
				{
					mealId: mealA.id,
					listId: list.id,
					lines: [line('onion', '3', null), line('carrot', '2', null)],
				},
			),
		).resolves.toBeDefined()
		await remove.committed()

		// The delete came after the add, so the add's demand went with the row
		// it fed and the carrot row stayed.
		const rows = await displayed(wal, list.id)
		expect(rows.map((row) => row.name)).toEqual(['carrot'])
		expect(
			await wal.mealShoppingContribution.findMany({
				select: { canonicalName: true },
			}),
		).toEqual([{ canonicalName: 'carrot' }])
	})

	test('two adds of the same Meal with different lines keep every line', async () => {
		await using database = await createWalDatabase()
		const { db: wal } = database
		const { list, meal } = await seedHousehold(wal)
		const mealA = await meal(0)

		const results = await Promise.all([
			reconcileMealShoppingContributions(wal, {
				mealId: mealA.id,
				listId: list.id,
				lines: [line('onion', '1', null), line('carrot', '2', null)],
			}),
			reconcileMealShoppingContributions(wal, {
				mealId: mealA.id,
				listId: list.id,
				lines: [line('onion', '2', null), line('lemon', '1', null)],
			}),
		])

		const contributions = await wal.mealShoppingContribution.findMany({
			orderBy: { canonicalName: 'asc' },
		})
		expect(contributions.map((c) => c.canonicalName)).toEqual([
			'carrot',
			'lemon',
			'onion',
		])
		expect(
			(await displayed(wal, list.id)).map((row) => row.name).sort(),
		).toEqual(['carrot', 'lemon', 'onion'])
		// The add that came second reports its new line, not "already there".
		expect(results.map((r) => r.createdRowCount).sort()).toEqual([1, 2])
	})

	test('Update Shopping racing a check never grows the checked row', async () => {
		await using database = await createWalDatabase()
		const { db: wal, url } = database
		const { list, meal } = await seedHousehold(wal)
		const mealA = await meal(0)
		await reconcileMealShoppingContributions(wal, {
			mealId: mealA.id,
			listId: list.id,
			lines: [line('onion', '2', null)],
		})
		const onion = await wal.shoppingListItem.findFirstOrThrow({
			where: { listId: list.id },
		})

		const check = startAfterRead(
			url,
			'UPDATE "ShoppingListItem" SET "checked" = 1 WHERE "id" = ? AND "checkVersion" = ? AND "checked" = 0',
			[onion.id, onion.checkVersion],
		)
		await replaceMealShoppingContributions(
			pauseAfterFirstRowRead(wal, check.afterRead),
			{ mealId: mealA.id, listId: list.id, lines: [line('onion', '4', null)] },
		)
		await check.committed()

		const rows = await displayed(wal, list.id)
		const checked = rows.filter((row) => row.checked)
		// A checked row only ever shows the amount the shopper saw.
		for (const row of checked) {
			expect(row.display.quantity).toBe('2')
		}
		// And the Meal's current demand is on Shopping, unchecked.
		expect(
			rows.filter((row) => !row.checked).map((row) => row.display.quantity),
		).toEqual(['4'])
	})
})
