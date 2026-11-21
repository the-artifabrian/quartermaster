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
 * Rows added from Recipe detail (source 'recipe'):
 * - A Meal's demand joins a Recipe-detail row. The row shows both amounts
 *   summed, as a typed row does, not its own amount alone.
 * - Editing that row changes its own amount and keeps the Meal's share.
 * - Remove generated amount is offered and works on it.
 * - Legacy week-generated rows still show only their own amount.
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
 *
 * Row Edit and Remove generated amount carry the version the person saw:
 * - Another Meal's demand joined the row after Edit opened. Saving must not
 *   delete that share; the save is refused as a conflict.
 * - Someone checked the row while it was being edited. The save is refused,
 *   and the checked row keeps the amount it was checked at.
 * - Remove generated amount on a row whose Meal share changed since it was
 *   shown is refused, and the shares stay.
 * - A row id from another Household, or one deleted meanwhile, answers
 *   missing and writes nothing.
 * - At the current version both still save.
 */
import { describe, expect, test } from 'vitest'
import { type Prisma, type PrismaClient } from '#app/generated/prisma/client.ts'
import { createUser } from '#tests/db-utils.ts'
import '#tests/setup/db-setup.ts'
import {
	createWalDatabase,
	settlesWithin,
	writeFromAnotherConnection,
} from '#tests/sqlite-concurrency.ts'
import { prisma } from './db.server.ts'
import {
	editShoppingDisplayGroup,
	reconcileMealShoppingContributions,
	removeGeneratedShoppingAmount,
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

describe('rows added from Recipe detail', () => {
	test('a Meal joining a Recipe-detail row shows the summed amount', async () => {
		const { list, meal } = await seedHousehold(prisma)
		const mealA = await meal(0)
		const onion = await prisma.shoppingListItem.create({
			data: { listId: list.id, name: 'onion', quantity: '1', source: 'recipe' },
		})

		const result = await reconcileMealShoppingContributions(prisma, {
			mealId: mealA.id,
			listId: list.id,
			lines: [line('onion', '3', null)],
		})

		expect(result).toMatchObject({ attachedCount: 1, createdRowCount: 0 })
		expect(await displayed(prisma, list.id)).toEqual([
			expect.objectContaining({
				id: onion.id,
				display: { quantity: '4', unit: null, combined: true },
			}),
		])
	})

	test('editing a Recipe-detail row changes its own amount and keeps the Meal share', async () => {
		const { list, meal } = await seedHousehold(prisma)
		const mealA = await meal(0)
		const onion = await prisma.shoppingListItem.create({
			data: { listId: list.id, name: 'onion', quantity: '1', source: 'recipe' },
		})
		await reconcileMealShoppingContributions(prisma, {
			mealId: mealA.id,
			listId: list.id,
			lines: [line('onion', '3', null)],
		})

		const current = await prisma.shoppingListItem.findUniqueOrThrow({
			where: { id: onion.id },
		})
		expect(
			await editShoppingDisplayGroup(prisma, {
				householdId: list.householdId!,
				itemId: onion.id,
				observedVersion: current.checkVersion,
				name: 'onion',
				quantity: '2',
				unit: null,
			}),
		).toEqual({ status: 'success' })

		expect(
			await prisma.mealShoppingContribution.findMany({
				select: { itemId: true, quantity: true },
			}),
		).toEqual([{ itemId: onion.id, quantity: '3' }])
		expect((await displayed(prisma, list.id))[0]!.display).toEqual({
			quantity: '5',
			unit: null,
			combined: true,
		})
	})
})

describe('Update Shopping keeps checked purchases as bought', () => {
	async function setup() {
		const seeded = await seedHousehold(prisma)
		const mealA = await seeded.meal(0)
		const add = (mealId: string, lines: ReturnType<typeof line>[]) =>
			reconcileMealShoppingContributions(prisma, {
				mealId,
				listId: seeded.list.id,
				lines,
			})
		const update = (mealId: string, lines: ReturnType<typeof line>[]) =>
			replaceMealShoppingContributions(prisma, {
				mealId,
				listId: seeded.list.id,
				lines,
			})
		const check = (id: string) =>
			prisma.shoppingListItem.update({ where: { id }, data: { checked: true } })
		return { ...seeded, mealA, add, update, check }
	}

	test('changed demand on a checked row goes on an unchecked row', async () => {
		const { list, mealA, add, update, check } = await setup()
		await add(mealA.id, [line('onion', '2', null)])
		const [bought] = await displayed(prisma, list.id)
		await check(bought!.id)

		await update(mealA.id, [line('onion', '4', null)])

		const rows = await displayed(prisma, list.id)
		expect(rows).toEqual([
			{ ...bought, checked: true },
			expect.objectContaining({
				checked: false,
				horizon: 'next',
				display: { quantity: '4', unit: null, combined: false },
			}),
		])
		const share = await prisma.mealShoppingContribution.findFirstOrThrow({
			where: { mealId: mealA.id },
		})
		expect(share).toMatchObject({ itemId: rows[1]!.id, quantity: '4' })
	})

	test('a checked row two Meals fed still shows both after one of them changes', async () => {
		const { list, meal, mealA, add, update, check } = await setup()
		const mealB = await meal(1)
		await add(mealA.id, [line('onion', '2', null)])
		await add(mealB.id, [line('onion', '3', null)])
		const [bought] = await displayed(prisma, list.id)
		expect(bought!.display.quantity).toBe('5')
		await check(bought!.id)
		const mealBShare = await prisma.mealShoppingContribution.findFirstOrThrow({
			where: { mealId: mealB.id },
		})

		await update(mealA.id, [line('onion', '4', null)])

		const rows = await displayed(prisma, list.id)
		expect(rows[0]).toEqual({ ...bought, checked: true })
		expect(rows[1]).toMatchObject({
			checked: false,
			display: { quantity: '4' },
		})
		expect(
			await prisma.mealShoppingContribution.findUniqueOrThrow({
				where: { id: mealBShare.id },
			}),
		).toEqual(mealBShare)
	})

	test('changed demand joins an unchecked Later row of the same ingredient and moves it to Next shop', async () => {
		const { list, mealA, add, update, check } = await setup()
		await add(mealA.id, [line('onion', '2', null)])
		const [bought] = await displayed(prisma, list.id)
		await check(bought!.id)
		const later = await prisma.shoppingListItem.create({
			data: {
				listId: list.id,
				name: 'onion',
				quantity: '1',
				source: 'manual',
				horizon: 'later',
			},
		})

		const result = await update(mealA.id, [line('onion', '4', null)])

		expect(result.promotedRowCount).toBe(1)
		const rows = await displayed(prisma, list.id)
		expect(rows).toHaveLength(2)
		expect(rows[0]).toEqual({ ...bought, checked: true })
		expect(rows[1]).toMatchObject({
			id: later.id,
			checked: false,
			horizon: 'next',
			display: { quantity: '5', combined: true },
		})
	})

	test('unchanged demand on a checked row stays where it is', async () => {
		const { list, mealA, add, update, check } = await setup()
		await add(mealA.id, [line('onion', '2', null)])
		const [bought] = await displayed(prisma, list.id)
		await check(bought!.id)
		const before = await prisma.mealShoppingContribution.findMany()

		const result = await update(mealA.id, [line('onion', '2', null)])

		expect(result).toMatchObject({
			createdRowCount: 0,
			attachedCount: 0,
			updatedContributionCount: 0,
			removedContributionCount: 0,
		})
		expect(await displayed(prisma, list.id)).toEqual([
			{ ...bought, checked: true },
		])
		expect(await prisma.mealShoppingContribution.findMany()).toEqual(before)
	})

	test('demand the Meal no longer has leaves a checked row as bought', async () => {
		const { list, mealA, add, update, check } = await setup()
		await add(mealA.id, [line('onion', '2', null), line('carrot', '1', null)])
		const bought = (await displayed(prisma, list.id)).find(
			(row) => row.name === 'onion',
		)!
		await check(bought.id)

		await update(mealA.id, [line('carrot', '1', null)])

		const rows = await displayed(prisma, list.id)
		expect(rows.find((row) => row.id === bought.id)).toEqual({
			...bought,
			checked: true,
		})
		expect(
			await prisma.mealShoppingContribution.findMany({
				where: { mealId: mealA.id },
				select: { canonicalName: true },
			}),
		).toEqual([{ canonicalName: 'carrot' }])
	})
})

describe('row Edit and Remove generated amount check the version', () => {
	async function setup() {
		const seeded = await seedHousehold(prisma)
		const householdId = seeded.household.id
		const mealA = await seeded.meal(0)
		const mealB = await seeded.meal(1)
		const onion = await prisma.shoppingListItem.create({
			data: {
				listId: seeded.list.id,
				name: 'onion',
				quantity: '1',
				source: 'manual',
			},
		})
		await reconcileMealShoppingContributions(prisma, {
			mealId: mealA.id,
			listId: seeded.list.id,
			lines: [line('onion', '2', null)],
		})
		const seen = await prisma.shoppingListItem.findUniqueOrThrow({
			where: { id: onion.id },
		})
		const edit = (
			observedVersion: number,
			id = onion.id,
			household = householdId,
		) =>
			editShoppingDisplayGroup(prisma, {
				householdId: household,
				itemId: id,
				observedVersion,
				name: 'onion',
				quantity: '5',
				unit: null,
			})
		const removeGenerated = (
			observedVersion: number,
			id = onion.id,
			household = householdId,
		) =>
			removeGeneratedShoppingAmount(prisma, {
				householdId: household,
				itemId: id,
				observedVersion,
			})
		return { ...seeded, householdId, mealB, onion, seen, edit, removeGenerated }
	}
	const shares = () =>
		prisma.mealShoppingContribution.findMany({
			orderBy: { createdAt: 'asc' },
			select: { mealId: true, itemId: true, quantity: true },
		})

	test('another Meal joining the row after Edit opened makes the save a conflict', async () => {
		const { list, mealB, onion, seen, edit } = await setup()
		await reconcileMealShoppingContributions(prisma, {
			mealId: mealB.id,
			listId: list.id,
			lines: [line('onion', '3', null)],
		})
		const before = await shares()
		const rowBefore = await prisma.shoppingListItem.findUniqueOrThrow({
			where: { id: onion.id },
		})

		expect(await edit(seen.checkVersion)).toEqual({ status: 'conflict' })

		expect(await shares()).toEqual(before)
		expect(before).toHaveLength(2)
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: onion.id },
			}),
		).toEqual(rowBefore)
	})

	test('a generated-only row edited at a stale version keeps its Meal shares', async () => {
		const { list, mealB, edit } = await setup()
		const peppers = await reconcileMealShoppingContributions(prisma, {
			mealId: mealB.id,
			listId: list.id,
			lines: [line('pepper', '2', null)],
		})
		expect(peppers.createdRowCount).toBe(1)
		const row = await prisma.shoppingListItem.findFirstOrThrow({
			where: { name: 'pepper' },
		})
		// The row as Edit saw it, then another Meal's share joined.
		const mealC = await prisma.meal.create({
			data: { mealPlanId: mealB.mealPlanId, date: mealB.date, order: 2 },
		})
		await reconcileMealShoppingContributions(prisma, {
			mealId: mealC.id,
			listId: list.id,
			lines: [line('pepper', '1', null)],
		})

		expect(await edit(row.checkVersion, row.id)).toEqual({ status: 'conflict' })
		expect(
			await prisma.mealShoppingContribution.count({
				where: { itemId: row.id },
			}),
		).toBe(2)
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: row.id },
			}),
		).toMatchObject({ source: 'meal' })
	})

	test('a row checked while it was being edited keeps the amount it was checked at', async () => {
		const { onion, seen, edit } = await setup()
		await prisma.shoppingListItem.update({
			where: { id: onion.id },
			data: { checked: true },
		})

		expect(await edit(seen.checkVersion)).toEqual({ status: 'conflict' })
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: onion.id },
			}),
		).toMatchObject({ checked: true, quantity: '1' })
	})

	test('Remove generated amount at a stale version keeps the shares', async () => {
		const { list, mealB, seen, removeGenerated } = await setup()
		await reconcileMealShoppingContributions(prisma, {
			mealId: mealB.id,
			listId: list.id,
			lines: [line('onion', '3', null)],
		})

		expect(await removeGenerated(seen.checkVersion)).toEqual({
			status: 'conflict',
		})
		expect(await shares()).toHaveLength(2)
	})

	test('a row from another Household, or one deleted meanwhile, is missing and nothing is written', async () => {
		const { onion, seen, edit, removeGenerated } = await setup()
		const other = await seedHousehold(prisma)
		const before = await shares()

		expect(await edit(seen.checkVersion, onion.id, other.household.id)).toEqual(
			{
				status: 'missing',
			},
		)
		expect(
			await removeGenerated(seen.checkVersion, onion.id, other.household.id),
		).toEqual({ status: 'missing' })
		expect(await shares()).toEqual(before)
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: onion.id },
			}),
		).toEqual(seen)

		await prisma.shoppingListItem.delete({ where: { id: onion.id } })
		expect(await edit(seen.checkVersion)).toEqual({ status: 'missing' })
		expect(await removeGenerated(seen.checkVersion)).toEqual({
			status: 'missing',
		})
	})

	test('at the current version Edit and Remove generated amount save', async () => {
		const { onion, seen, edit, removeGenerated } = await setup()

		expect(await edit(seen.checkVersion)).toEqual({ status: 'success' })
		const edited = await prisma.shoppingListItem.findUniqueOrThrow({
			where: { id: onion.id },
		})
		expect(edited).toMatchObject({ quantity: '5', source: 'manual' })
		expect(await removeGenerated(edited.checkVersion)).toEqual({
			status: 'success',
			name: 'onion',
		})
		expect(await shares()).toEqual([])
	})

	test('Remove generated amount works on a Recipe-detail row', async () => {
		const { list, mealB, removeGenerated } = await setup()
		const garlic = await prisma.shoppingListItem.create({
			data: {
				listId: list.id,
				name: 'garlic',
				quantity: '1',
				source: 'recipe',
			},
		})
		await reconcileMealShoppingContributions(prisma, {
			mealId: mealB.id,
			listId: list.id,
			lines: [line('garlic', '2', null)],
		})
		const seen = await prisma.shoppingListItem.findUniqueOrThrow({
			where: { id: garlic.id },
		})

		expect(await removeGenerated(seen.checkVersion, garlic.id)).toEqual({
			status: 'success',
			name: 'garlic',
		})
		expect(
			await prisma.mealShoppingContribution.count({
				where: { itemId: garlic.id },
			}),
		).toBe(0)
	})
})
