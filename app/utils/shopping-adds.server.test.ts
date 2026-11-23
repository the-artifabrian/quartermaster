/**
 * From Plan and a Recipe's one-line Add to Shopping read what decides their
 * write in the same transaction as the write. (Add to Shopping and Update
 * Shopping on a Meal are tested through the Plan action, in
 * plan-actions.test.ts.)
 *
 * Failure list:
 * - From Plan: a picked Meal is deleted after its demand is read and before
 *   its write, which then points at a Meal that is gone and fails the whole
 *   request (a foreign key error, so a 500).
 * - From Plan: an item is marked cooked after the demand is read, and its
 *   amounts still land.
 * - From Plan: one Meal gone makes the other picked Meals fail too.
 * - Recipe line: two adds of the same line at once both find no row and make
 *   two rows.
 * - Recipe line: a row for the same ingredient added by someone else between
 *   the read and the write is missed, so a second row appears.
 */
import { expect, test } from 'vitest'
import { type Prisma, type PrismaClient } from '#app/generated/prisma/client.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	createWalDatabase,
	settlesWithin,
	writeFromAnotherConnection,
} from '#tests/sqlite-concurrency.ts'
import {
	addPickedMealsToShopping,
	addRecipeLineToShopping,
} from './shopping-adds.server.ts'

async function seedHousehold(db: PrismaClient) {
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
	const plan = await db.mealPlan.create({
		data: { householdId: household.id, weekStart: new Date('2026-11-16') },
	})
	async function meal(ingredient: string, order: number) {
		const recipe = await db.recipe.create({
			data: {
				title: `${ingredient} soup`,
				userId: user.id,
				householdId: household.id,
				ingredients: {
					create: { name: ingredient, amount: '2', unit: null, order: 0 },
				},
			},
		})
		return db.meal.create({
			data: {
				mealPlanId: plan.id,
				date: new Date('2026-11-18'),
				order,
				recipeItems: {
					create: { recipeId: recipe.id, recipeTitle: recipe.title, order: 0 },
				},
			},
			include: { recipeItems: true },
		})
	}
	return { householdId: household.id, listId: list.id, meal }
}

/**
 * `wal`, with `sql` sent from another connection just after `model.method`
 * first returns, on the client itself or inside a transaction. `state` says
 * whether that write landed at once or had to wait.
 */
function writeAfterFirstRead(
	wal: PrismaClient,
	url: string,
	[model, method]: ['mealRecipeItem' | 'shoppingListItem', 'findMany'],
	sql: string,
	args: Array<string | number>,
) {
	const state: {
		other?: ReturnType<typeof writeFromAnotherConnection>
		landedAtOnce?: boolean
	} = {}
	async function afterRead() {
		if (state.other) return
		state.other = writeFromAnotherConnection(url, sql, args)
		await state.other.executing
		state.landedAtOnce = await settlesWithin(state.other.committed, 300)
	}
	function hooked<Client extends object>(client: Client): Client {
		const delegate = Reflect.get(client, model) as Record<
			string,
			(...args: unknown[]) => Promise<unknown>
		>
		const wrapped = new Proxy(delegate, {
			get(target, key) {
				const value = Reflect.get(target, key) as unknown
				if (key !== method || typeof value !== 'function') return value
				return async (...args: unknown[]) => {
					const found = await (
						value as (...args: unknown[]) => Promise<unknown>
					).apply(target, args)
					await afterRead()
					return found
				}
			},
		})
		return new Proxy(client, {
			get(target, key) {
				if (key === model) return wrapped
				if (key === '$transaction') {
					return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
						(target as unknown as PrismaClient).$transaction((tx) =>
							work(hooked(tx)),
						)
				}
				const value = Reflect.get(target, key) as unknown
				return typeof value === 'function' ? value.bind(target) : value
			},
		})
	}
	return { db: hooked(wal), state }
}

function rowNames(db: PrismaClient, listId: string) {
	return db.shoppingListItem
		.findMany({ where: { listId }, orderBy: { name: 'asc' } })
		.then((rows) => rows.map((row) => row.name))
}

test('From Plan skips a picked Meal deleted as it runs, and adds the others', async () => {
	await using database = await createWalDatabase()
	const { db: wal, url } = database
	const { householdId, listId, meal } = await seedHousehold(wal)
	const leek = await meal('leek', 0)
	const carrot = await meal('carrot', 1)
	const { db, state } = writeAfterFirstRead(
		wal,
		url,
		['mealRecipeItem', 'findMany'],
		'DELETE FROM "Meal" WHERE "id" = ?',
		[leek.id],
	)

	const result = await addPickedMealsToShopping(db, {
		householdId,
		listId,
		pickedByMeal: new Map([
			[leek.id, new Set(['leek'])],
			[carrot.id, new Set(['carrot'])],
		]),
	})

	await state.other!.committed
	expect(await wal.meal.count({ where: { id: leek.id } })).toBe(0)
	expect(await rowNames(wal, listId)).toContain('carrot')
	expect(result.createdRowCount).toBeGreaterThanOrEqual(1)
})

test('From Plan holds off an item being marked cooked until it has written', async () => {
	await using database = await createWalDatabase()
	const { db: wal, url } = database
	const { householdId, listId, meal } = await seedHousehold(wal)
	const leek = await meal('leek', 0)
	const { db, state } = writeAfterFirstRead(
		wal,
		url,
		['mealRecipeItem', 'findMany'],
		'UPDATE "MealRecipeItem" SET "cooked" = 1 WHERE "id" = ?',
		[leek.recipeItems[0]!.id],
	)

	await addPickedMealsToShopping(db, {
		householdId,
		listId,
		pickedByMeal: new Map([[leek.id, new Set(['leek'])]]),
	})

	await state.other!.committed
	expect(state.landedAtOnce).toBe(false)
	expect(await rowNames(wal, listId)).toEqual(['leek'])
})

test('two adds of the same Recipe line at once make one row', async () => {
	await using database = await createWalDatabase()
	const { db: wal } = database
	const { listId } = await seedHousehold(wal)
	const item = { name: 'onion', quantity: '2', unit: null }

	const results = await Promise.all([
		addRecipeLineToShopping(wal, { listId, item }),
		addRecipeLineToShopping(wal, { listId, item }),
	])

	expect(await rowNames(wal, listId)).toEqual(['onion'])
	expect(results.map((result) => result.isNew).sort()).toEqual([false, true])
})

test('a Recipe line holds off another write to Shopping until it has written', async () => {
	await using database = await createWalDatabase()
	const { db: wal, url } = database
	const { listId } = await seedHousehold(wal)
	const { db, state } = writeAfterFirstRead(
		wal,
		url,
		['shoppingListItem', 'findMany'],
		'UPDATE "ShoppingListItem" SET "checked" = 1 WHERE "listId" = ?',
		[listId],
	)

	await addRecipeLineToShopping(db, {
		listId,
		item: { name: 'onion', quantity: '2', unit: null },
	})

	await state.other!.committed
	expect(state.landedAtOnce).toBe(false)
})
