import { createHmac } from 'node:crypto'
import { RouterContextProvider } from 'react-router'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import {
	MAX_UNDO_ROWS,
	MAX_UNDO_TOKEN,
	openUndo,
	sealUndo,
	restoreMeal,
	restoreMealItem,
	restoreShoppingRows,
	restoreStaple,
	UNDO_TOKEN_TTL_MS,
} from '#app/utils/undo-delete.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as checkAction } from './shopping-check.tsx'
import { action } from './undo-delete.tsx'
import '#tests/setup/db-setup.ts'

// Failure list, written before undo-delete.server.ts:
// shopping row — a delete removes the row and its Meal amounts at once and
//   answers with both; Undo puts both back, same id, same checked state,
//   amount and section; a second Undo changes nothing.
// same name added again in the meantime — an unchecked row is not doubled:
//   its Meal amounts join the row added since, which keeps its own amount;
//   a checked row comes back beside it as a checked purchase.
// a contribution's Meal deleted in the meantime — that amount is left out,
//   the row still comes back.
// Clear checked — clears only the rows it names that are still checked;
//   Undo brings every one back checked; the household hears of a clear only
//   when something was cleared.
// the other member's check in flight on the deleted row — answers missing,
//   not an error; once Undo has put the row back, checks work again.
// gone — deleting or restoring what is not there (or another Household's)
//   answers gone, never a bare 404.
// trust — Undo's seal opens only for the member and Household that deleted,
//   within its time, unaltered; a forged, tampered, borrowed or expired seal
//   is refused and writes nothing. Even a sealed snapshot cannot reach past
//   the Household: another Household's rows, Meals, Recipes, sections or
//   orphaned amounts named in it are left alone.
// Meal — delete takes sections, cards, notes and their lines; Undo puts all
//   back and relinks its Shopping amounts; with "remove generated amount",
//   rows only it asked for go and come back; a Recipe deleted since comes
//   back as a missing card.
// Recipe in a Meal — removed alone and put back; the last card takes its
//   Meal and Undo brings the Meal back.
// Staple — unmarked at once and marked again by Undo.
// added with the review — a replay of a seal answers gone and doubles
//   nothing, even when the row it merged into has been checked since; every
//   restore that finds itself already back answers gone; nothing coming back
//   sends no event; a restore whose transaction fails answers a clean
//   conflict; Clear checked's restore reads as "put back N checked items"; a
//   Meal's relinked amounts are announced; a removed row that is there again
//   still gets its Meal amounts back; another Meal already holding a demand
//   keeps it; the last two cards removed at once leave no empty Meal; a
//   member of the same Household cannot use another member's seal; a seal
//   signed with an older secret still opens, one without the undo-delete
//   prefix or with an extra segment does not; Household scoping holds for
//   Staples, Meal plans, a card's Meal, a card's section and Recipe, a
//   Meal's Menu, and an amount's Meal.

beforeEach(() => vi.mocked(emitHouseholdEvent).mockClear())

async function setupUser() {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
		select: { id: true, userId: true },
	})
	const household = await prisma.household.create({
		data: {
			name: 'Undo',
			members: { create: { userId: session.userId, role: 'owner' } },
		},
	})
	const list = await ensureShoppingList(prisma, {
		userId: session.userId,
		householdId: household.id,
	})
	return { ...session, householdId: household.id, listId: list.id }
}

type Session = Awaited<ReturnType<typeof setupUser>>

async function send(session: Session, body: Record<string, unknown>) {
	const response = await action({
		request: new Request(`${BASE_URL}/resources/undo-delete`, {
			method: 'POST',
			headers: {
				cookie: await getSessionCookieHeader(session),
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/resources/undo-delete',
		url: new URL(`${BASE_URL}/resources/undo-delete`),
	})
	return {
		status: response.status,
		// The snapshot travels as JSON, as it does in the browser.
		body: JSON.parse(await response.text()) as {
			status: string
			token?: string
			restored?: number
			merged?: number
		},
	}
}

async function seedMeal(session: Session, recipeTitle = 'Dal') {
	const recipe = await prisma.recipe.create({
		data: {
			title: recipeTitle,
			userId: session.userId,
			householdId: session.householdId,
		},
	})
	const plan = await prisma.mealPlan.upsert({
		where: {
			householdId_weekStart: {
				householdId: session.householdId,
				weekStart: new Date('2026-11-16'),
			},
		},
		create: {
			householdId: session.householdId,
			weekStart: new Date('2026-11-16'),
		},
		update: {},
	})
	return prisma.meal.create({
		data: {
			mealPlanId: plan.id,
			date: new Date('2026-11-17'),
			order: 0,
			recipeItems: {
				create: { recipeId: recipe.id, recipeTitle, order: 0 },
			},
		},
		include: { recipeItems: true },
	})
}

async function seedRowWithAmount(
	session: Session,
	mealId: string | null,
	row: { name: string; checked?: boolean; quantity?: string },
) {
	return prisma.shoppingListItem.create({
		data: {
			listId: session.listId,
			name: row.name,
			quantity: row.quantity ?? '1',
			checked: row.checked ?? false,
			horizon: 'later',
			source: 'meal',
			mealContributions: {
				create: {
					mealId,
					canonicalName: row.name,
					name: row.name,
					quantity: row.quantity ?? '1',
				},
			},
		},
		include: { mealContributions: true },
	})
}

const rowsOf = (session: Session) =>
	prisma.shoppingListItem.findMany({
		where: { listId: session.listId },
		orderBy: { name: 'asc' },
		select: {
			id: true,
			name: true,
			quantity: true,
			checked: true,
			horizon: true,
			mealContributions: { select: { id: true, mealId: true } },
		},
	})

describe('a Shopping row', () => {
	test('deletes with its Meal amounts and comes back as it was, once', async () => {
		const session = await setupUser()
		const meal = await seedMeal(session)
		const row = await seedRowWithAmount(session, meal.id, { name: 'lentils' })
		const before = await rowsOf(session)

		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [row.id],
		})
		expect(deleted).toMatchObject({ status: 200, body: { status: 'deleted' } })
		expect(await rowsOf(session)).toEqual([])
		expect(await prisma.mealShoppingContribution.count()).toBe(0)
		expect(emitHouseholdEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'shopping_list_item_deleted',
				payload: { name: 'lentils' },
			}),
		)

		const restore = { intent: 'restore', token: deleted.body.token }
		expect((await send(session, restore)).body).toMatchObject({
			status: 'restored',
			restored: 1,
		})
		expect(await rowsOf(session)).toEqual(before)
		expect(emitHouseholdEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: 'shopping_list_restored',
				payload: { name: 'lentils' },
			}),
		)
		// A replay of the same Undo puts nothing back twice.
		vi.mocked(emitHouseholdEvent).mockClear()
		expect(await send(session, restore)).toEqual({
			status: 200,
			body: { status: 'gone' },
		})
		expect(await rowsOf(session)).toEqual(before)
		expect(emitHouseholdEvent).not.toHaveBeenCalled()
	})

	test('added again in the meantime is not doubled; its Meal amounts join the new row', async () => {
		const session = await setupUser()
		const meal = await seedMeal(session)
		const row = await seedRowWithAmount(session, meal.id, { name: 'lentils' })
		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [row.id],
		})
		const added = await prisma.shoppingListItem.create({
			data: { listId: session.listId, name: 'Lentils', quantity: '3' },
		})

		expect(
			(
				await send(session, {
					intent: 'restore',
					token: deleted.body.token,
				})
			).body,
		).toMatchObject({ status: 'restored', restored: 0, merged: 1 })
		expect(await rowsOf(session)).toEqual([
			{
				id: added.id,
				name: 'Lentils',
				quantity: '3',
				checked: false,
				horizon: 'next',
				mealContributions: [
					{ id: row.mealContributions[0]!.id, mealId: meal.id },
				],
			},
		])
	})

	test('a checked row comes back beside one added again since', async () => {
		const session = await setupUser()
		const row = await seedRowWithAmount(session, null, {
			name: 'lentils',
			checked: true,
		})
		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [row.id],
			checkedOnly: true,
		})
		await prisma.shoppingListItem.create({
			data: { listId: session.listId, name: 'lentils' },
		})
		await send(session, { intent: 'restore', token: deleted.body.token })
		expect((await rowsOf(session)).map((r) => r.checked).sort()).toEqual([
			false,
			true,
		])
	})

	test('leaves out an amount whose Meal has gone since, and still comes back', async () => {
		const session = await setupUser()
		const meal = await seedMeal(session)
		const row = await seedRowWithAmount(session, meal.id, { name: 'lentils' })
		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [row.id],
		})
		await prisma.meal.delete({ where: { id: meal.id } })
		await send(session, { intent: 'restore', token: deleted.body.token })
		expect(await rowsOf(session)).toEqual([
			expect.objectContaining({ id: row.id, mealContributions: [] }),
		])
	})

	test("the other member's check in flight answers missing, and works once Undo has put the row back", async () => {
		const session = await setupUser()
		const row = await prisma.shoppingListItem.create({
			data: { listId: session.listId, name: 'milk' },
		})
		const check = async () =>
			(
				await checkAction({
					request: new Request(`${BASE_URL}/resources/shopping-check`, {
						method: 'POST',
						headers: {
							cookie: await getSessionCookieHeader(session),
							'Content-Type': 'application/x-www-form-urlencoded',
						},
						body: new URLSearchParams({
							itemId: row.id,
							checked: 'true',
							observedVersion: String(row.checkVersion),
							mutationId: crypto.randomUUID(),
						}),
					}),
					params: {},
					context: new RouterContextProvider(),
					pattern: '/resources/shopping-check',
					url: new URL(`${BASE_URL}/resources/shopping-check`),
				})
			).json() as Promise<{ status: string }>
		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [row.id],
		})
		expect(await check()).toMatchObject({ status: 'missing' })
		await send(session, { intent: 'restore', token: deleted.body.token })
		expect(await check()).toMatchObject({ status: 'success' })
	})
})

describe('Clear checked', () => {
	test('clears only named rows still checked, Undo brings them back checked, and the household hears only of a real clear', async () => {
		const session = await setupUser()
		const make = (name: string, checked: boolean) =>
			prisma.shoppingListItem.create({
				data: { listId: session.listId, name, checked },
			})
		const bread = await make('bread', true)
		const milk = await make('milk', true)
		const uncheckedSince = await make('eggs', false)
		const notNamed = await make('rice', true)

		const cleared = await send(session, {
			intent: 'delete-shopping',
			itemIds: [bread.id, milk.id, uncheckedSince.id],
			checkedOnly: true,
		})
		expect((await rowsOf(session)).map((r) => r.name)).toEqual(['eggs', 'rice'])
		expect(emitHouseholdEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'shopping_list_cleared' }),
		)
		await send(session, { intent: 'restore', token: cleared.body.token })
		expect((await rowsOf(session)).map((r) => [r.name, r.checked])).toEqual([
			['bread', true],
			['eggs', false],
			['milk', true],
			['rice', true],
		])

		vi.mocked(emitHouseholdEvent).mockClear()
		expect(
			(
				await send(session, {
					intent: 'delete-shopping',
					itemIds: [uncheckedSince.id],
					checkedOnly: true,
				})
			).body,
		).toEqual({ status: 'gone' })
		expect(emitHouseholdEvent).not.toHaveBeenCalled()
		expect(notNamed).toBeTruthy()
	})
})

describe('gone', () => {
	test("deleting what is not there, or another Household's, answers gone with a 200", async () => {
		const session = await setupUser()
		const other = await setupUser()
		const theirs = await prisma.shoppingListItem.create({
			data: { listId: other.listId, name: 'salt' },
		})
		for (const body of [
			{ intent: 'delete-shopping', itemIds: [theirs.id] },
			{ intent: 'delete-shopping', itemIds: ['missing'] },
			{
				intent: 'delete-meal',
				mealId: 'missing',
				removeShoppingContributions: false,
			},
			{ intent: 'delete-meal-item', itemId: 'missing' },
			{ intent: 'remove-staple', stapleId: 'missing' },
		]) {
			expect(await send(session, body)).toEqual({
				status: 200,
				body: { status: 'gone' },
			})
		}
		expect(
			await prisma.shoppingListItem.count({ where: { id: theirs.id } }),
		).toBe(1)
	})

	test('a malformed request is invalid, not a crash', async () => {
		const session = await setupUser()
		expect(
			await send(session, { intent: 'restore', snapshot: { kind: 'x' } }),
		).toEqual({
			status: 400,
			body: { status: 'invalid' },
		})
	})
})

describe('trust', () => {
	async function deletedSalt(session: Session) {
		const salt = await prisma.shoppingListItem.create({
			data: { listId: session.listId, name: 'salt' },
		})
		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [salt.id],
		})
		return deleted.body.token!
	}
	const refused = { status: 403, body: { status: 'refused' } }

	test("a seal made for another member's Household is refused and writes nothing", async () => {
		const session = await setupUser()
		const other = await setupUser()
		const token = await deletedSalt(other)
		expect(await send(session, { intent: 'restore', token })).toEqual(refused)
		expect(await prisma.shoppingListItem.count()).toBe(0)
	})

	test('a tampered or forged seal is refused', async () => {
		const session = await setupUser()
		const token = await deletedSalt(session)
		const [body, mac] = token.split('.') as [string, string]
		const sealed = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
			s: { rows: Array<{ name: string }> }
		}
		sealed.s.rows[0]!.name = 'gold'
		const altered = Buffer.from(JSON.stringify(sealed)).toString('base64url')
		for (const forged of [
			`${altered}.${mac}`,
			`${body}.${mac.slice(0, -2)}xx`,
			`${altered}.${createHmac('sha256', 'guess').update(altered).digest('base64url')}`,
			body,
			'',
		]) {
			expect(await send(session, { intent: 'restore', token: forged })).toEqual(
				refused,
			)
		}
		expect(await prisma.shoppingListItem.count()).toBe(0)
	})

	test('a seal past its time is refused', async () => {
		const session = await setupUser()
		const token = await deletedSalt(session)
		const now = Date.now()
		using _ = { [Symbol.dispose]: () => vi.restoreAllMocks() }
		vi.spyOn(Date, 'now').mockReturnValue(now + UNDO_TOKEN_TTL_MS + 1)
		expect(await send(session, { intent: 'restore', token })).toEqual(refused)
		expect(await prisma.shoppingListItem.count()).toBe(0)
	})

	test("even a sealed snapshot leaves another Household's rows, Meals, Recipes, sections and amounts alone", async () => {
		const session = await setupUser()
		const other = await setupUser()
		const theirMeal = await seedMeal(other)
		const theirSection = await prisma.mealSection.create({
			data: { mealId: theirMeal.id, order: 0 },
		})
		const theirRow = await seedRowWithAmount(other, null, { name: 'salt' })
		const theirOrphan = theirRow.mealContributions[0]!
		const ourMeal = await seedMeal(session)
		const deleted = await send(session, {
			intent: 'delete-meal',
			mealId: ourMeal.id,
			removeShoppingContributions: false,
		})
		const snapshot = openUndo(deleted.body.token!, session)
		if (snapshot?.kind !== 'meal') throw new Error('expected a Meal snapshot')
		// As if the snapshot itself named the other Household's things.
		snapshot.meal.recipeItems[0]!.recipeId = theirMeal.recipeItems[0]!.recipeId
		snapshot.meal.recipeItems[0]!.sectionId = theirSection.id
		snapshot.meal.orphanedContributionIds = [theirOrphan.id]
		await restoreMeal(prisma, {
			householdId: session.householdId,
			snapshot: snapshot.meal,
		})
		expect(
			await prisma.mealRecipeItem.findMany({
				where: { mealId: ourMeal.id },
				select: { recipeId: true, sectionId: true },
			}),
		).toEqual([{ recipeId: null, sectionId: null }])
		expect(
			await prisma.mealShoppingContribution.findUniqueOrThrow({
				where: { id: theirOrphan.id },
				select: { mealId: true },
			}),
		).toEqual({ mealId: null })

		// A row id that lives in their list is never touched, nor its amounts.
		await restoreShoppingRows(prisma, {
			householdId: session.householdId,
			rows: [
				{
					...theirRow,
					quantity: 'stolen',
					mealContributions: theirRow.mealContributions.map((c) => ({
						...c,
						mealId: theirMeal.id,
					})),
				},
			],
		})
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: theirRow.id },
				select: { listId: true, quantity: true },
			}),
		).toEqual({ listId: other.listId, quantity: '1' })
		expect(await rowsOf(session)).toEqual([])
	})
})

async function addMember(session: Session) {
	const member = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
		select: { id: true, userId: true },
	})
	await prisma.householdMember.create({
		data: {
			householdId: session.householdId,
			userId: member.userId,
			role: 'member',
		},
	})
	return { ...member, householdId: session.householdId, listId: session.listId }
}

describe('replays and edges', () => {
	test('a replay after the merged-into row was checked answers gone and doubles nothing', async () => {
		const session = await setupUser()
		const row = await prisma.shoppingListItem.create({
			data: { listId: session.listId, name: 'milk' },
		})
		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [row.id],
		})
		const added = await prisma.shoppingListItem.create({
			data: { listId: session.listId, name: 'milk', quantity: '2' },
		})
		const restore = { intent: 'restore', token: deleted.body.token }
		expect((await send(session, restore)).body).toMatchObject({ merged: 1 })
		await prisma.shoppingListItem.update({
			where: { id: added.id },
			data: { checked: true },
		})
		expect((await send(session, restore)).body).toEqual({ status: 'gone' })
		expect(await rowsOf(session)).toHaveLength(1)
	})

	test('restoring a Meal, a card or a row already back answers gone', async () => {
		const session = await setupUser()
		const meal = await seedMeal(session)
		const card = await prisma.mealRecipeItem.create({
			data: { mealId: meal.id, recipeTitle: 'Rice', order: 1 },
		})
		const removedCard = await send(session, {
			intent: 'delete-meal-item',
			itemId: card.id,
		})
		const cardSnapshot = openUndo(removedCard.body.token!, session)
		if (cardSnapshot?.kind !== 'meal-item') throw new Error('expected a card')
		const scope = { householdId: session.householdId }
		expect(
			await restoreMealItem(prisma, { ...scope, item: cardSnapshot.item }),
		).toEqual({
			status: 'restored',
		})
		expect(
			await restoreMealItem(prisma, { ...scope, item: cardSnapshot.item }),
		).toEqual({
			status: 'gone',
		})

		const removedMeal = await send(session, {
			intent: 'delete-meal',
			mealId: meal.id,
			removeShoppingContributions: false,
		})
		const mealSnapshot = openUndo(removedMeal.body.token!, session)
		if (mealSnapshot?.kind !== 'meal') throw new Error('expected a Meal')
		await restoreMeal(prisma, { ...scope, snapshot: mealSnapshot.meal })
		expect(
			await restoreMeal(prisma, { ...scope, snapshot: mealSnapshot.meal }),
		).toEqual({
			status: 'gone',
		})
	})

	test('nothing coming back sends no event', async () => {
		const session = await setupUser()
		const row = await prisma.shoppingListItem.create({
			data: { listId: session.listId, name: 'milk' },
		})
		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [row.id],
		})
		// Back by other means before Undo.
		await prisma.shoppingListItem.create({
			data: { id: row.id, listId: session.listId, name: 'milk' },
		})
		vi.mocked(emitHouseholdEvent).mockClear()
		expect(
			(await send(session, { intent: 'restore', token: deleted.body.token }))
				.body,
		).toEqual({ status: 'gone' })
		expect(emitHouseholdEvent).not.toHaveBeenCalled()
	})

	test('a restore whose transaction fails answers a clean conflict', async () => {
		const session = await setupUser()
		const row = await prisma.shoppingListItem.create({
			data: { listId: session.listId, name: 'milk' },
		})
		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [row.id],
		})
		using _ = { [Symbol.dispose]: () => vi.restoreAllMocks() }
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('FK'))
		expect(
			await send(session, { intent: 'restore', token: deleted.body.token }),
		).toEqual({
			status: 409,
			body: { status: 'conflict' },
		})
	})

	test("Clear checked's Undo reads as putting back checked items; a Meal's events say what Shopping lost and got back, and only then", async () => {
		const session = await setupUser()
		const make = (name: string) =>
			prisma.shoppingListItem.create({
				data: { listId: session.listId, name, checked: true },
			})
		const rows = [await make('bread'), await make('milk')]
		const cleared = await send(session, {
			intent: 'delete-shopping',
			itemIds: rows.map((r) => r.id),
			checkedOnly: true,
		})
		await send(session, { intent: 'restore', token: cleared.body.token })
		expect(emitHouseholdEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: 'shopping_list_restored',
				payload: { name: '2 checked items' },
			}),
		)

		// Keep Shopping: its amounts stay there, so neither the delete nor the
		// Undo is news on Shopping.
		const kept = await seedMeal(session)
		await seedRowWithAmount(session, kept.id, { name: 'lentils' })
		vi.mocked(emitHouseholdEvent).mockClear()
		const keptToken = (
			await send(session, {
				intent: 'delete-meal',
				mealId: kept.id,
				removeShoppingContributions: false,
			})
		).body.token
		await send(session, { intent: 'restore', token: keptToken })
		expect(emitHouseholdEvent).not.toHaveBeenCalled()

		// "Remove generated amount" on a Meal with nothing on Shopping: no news.
		const bare = await seedMeal(session, 'Rice')
		await send(session, {
			intent: 'delete-meal',
			mealId: bare.id,
			removeShoppingContributions: true,
		})
		expect(emitHouseholdEvent).not.toHaveBeenCalled()

		// With amounts there: the delete and the Undo name the Meal.
		const removed = await send(session, {
			intent: 'delete-meal',
			mealId: kept.id,
			removeShoppingContributions: true,
		})
		expect(emitHouseholdEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: 'shopping_list_item_deleted',
				payload: { name: 'the amounts for Dal' },
			}),
		)
		await send(session, { intent: 'restore', token: removed.body.token })
		expect(emitHouseholdEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: 'shopping_list_restored',
				payload: { name: 'the amounts for Dal' },
			}),
		)
	})

	test('a restore that failed gives its seal back, so a retry still works', async () => {
		const session = await setupUser()
		const row = await prisma.shoppingListItem.create({
			data: { listId: session.listId, name: 'milk' },
		})
		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [row.id],
		})
		const restore = { intent: 'restore', token: deleted.body.token }
		{
			using _ = { [Symbol.dispose]: () => vi.restoreAllMocks() }
			vi.spyOn(console, 'error').mockImplementation(() => {})
			vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('FK'))
			expect((await send(session, restore)).status).toBe(409)
		}
		expect((await send(session, restore)).body).toMatchObject({
			status: 'restored',
		})
		expect(await rowsOf(session)).toHaveLength(1)
	})

	test('a failure partway through a restore leaves nothing of it behind', async () => {
		const session = await setupUser()
		const scope = { householdId: session.householdId }
		const meal = await seedMeal(session)
		await prisma.mealSection.create({ data: { mealId: meal.id, order: 0 } })
		const removedMeal = await send(session, {
			intent: 'delete-meal',
			mealId: meal.id,
			removeShoppingContributions: false,
		})
		const mealSnapshot = openUndo(removedMeal.body.token!, session)
		if (mealSnapshot?.kind !== 'meal') throw new Error('expected a Meal')
		// The Meal is written first; the repeated section then fails.
		const sections = [
			...mealSnapshot.meal.sections,
			...mealSnapshot.meal.sections,
		]
		await expect(
			restoreMeal(prisma, {
				...scope,
				snapshot: { ...mealSnapshot.meal, sections },
			}),
		).rejects.toThrow()
		expect(await prisma.meal.count({ where: { id: meal.id } })).toBe(0)

		const row = await seedRowWithAmount(session, null, { name: 'lentils' })
		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [row.id],
		})
		const rowSnapshot = openUndo(deleted.body.token!, session)
		if (rowSnapshot?.kind !== 'shopping') throw new Error('expected rows')
		// The row is written first; writing its amounts then throws.
		const transaction = prisma.$transaction.bind(prisma)
		using _ = { [Symbol.dispose]: () => vi.restoreAllMocks() }
		vi.spyOn(prisma, '$transaction').mockImplementationOnce(((
			work: (tx: unknown) => Promise<unknown>,
		) =>
			transaction(async (tx) =>
				work(
					new Proxy(tx, {
						get(target, key, receiver) {
							if (key !== 'mealShoppingContribution') {
								return Reflect.get(target, key, receiver)
							}
							return {
								...target.mealShoppingContribution,
								createMany: () => {
									throw new Error('amounts failed')
								},
							}
						},
					}),
				),
			)) as never)
		await expect(
			restoreShoppingRows(prisma, { ...scope, rows: rowSnapshot.rows }),
		).rejects.toThrow('amounts failed')
		expect(await rowsOf(session)).toEqual([])
	})

	test('a Clear checked at its limits, long names and two amounts a row, fits its seal', async () => {
		const session = await setupUser()
		const long = (length: number, seed: number) =>
			`ü"${seed}`.padEnd(length, 'é')
		const at = new Date()
		const rows = Array.from({ length: MAX_UNDO_ROWS }, (_, index) => ({
			id: `row-${index}`.padEnd(64, 'x'),
			name: long(300, index),
			quantity: long(100, index),
			unit: long(60, index),
			category: long(60, index),
			checked: true,
			checkVersion: 2_000_000_000,
			source: 'manual'.padEnd(20, 'm'),
			horizon: 'next'.padEnd(20, 'n'),
			createdAt: at,
			mealContributions: [0, 1].map((n) => ({
				id: `amount-${index}-${n}`.padEnd(64, 'x'),
				mealId: `meal-${n}`.padEnd(64, 'x'),
				itemId: `row-${index}`.padEnd(64, 'x'),
				canonicalName: long(300, n),
				name: long(300, n),
				quantity: long(100, n),
				unit: long(60, n),
				createdAt: at,
			})),
		}))
		const token = sealUndo({ kind: 'shopping', rows }, session)
		expect(token.length).toBeLessThanOrEqual(MAX_UNDO_TOKEN)
		expect(openUndo(token, session)).toMatchObject({ kind: 'shopping' })
	})

	test('a removed row that is there again still gets its Meal amounts back', async () => {
		const session = await setupUser()
		const meal = await seedMeal(session)
		const row = await seedRowWithAmount(session, meal.id, { name: 'lentils' })
		const removed = await send(session, {
			intent: 'delete-meal',
			mealId: meal.id,
			removeShoppingContributions: true,
		})
		expect(await rowsOf(session)).toEqual([])
		await prisma.shoppingListItem.create({
			data: {
				id: row.id,
				listId: session.listId,
				name: 'lentils',
				source: 'meal',
			},
		})
		await send(session, { intent: 'restore', token: removed.body.token })
		expect((await rowsOf(session))[0]!.mealContributions).toEqual([
			{ id: row.mealContributions[0]!.id, mealId: meal.id },
		])
	})

	test('another row already holding a Meal demand keeps it', async () => {
		const session = await setupUser()
		const meal = await seedMeal(session)
		const row = await seedRowWithAmount(session, meal.id, {
			name: 'lentils',
			checked: true,
		})
		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [row.id],
		})
		const other = await seedRowWithAmount(session, meal.id, { name: 'lentils' })
		await send(session, { intent: 'restore', token: deleted.body.token })
		const rows = await rowsOf(session)
		expect(rows.find((r) => r.id === row.id)!.mealContributions).toEqual([])
		expect(rows.find((r) => r.id === other.id)!.mealContributions).toHaveLength(
			1,
		)
	})

	test('the last two cards removed at once leave no empty Meal', async () => {
		const session = await setupUser()
		const meal = await seedMeal(session)
		const rice = await prisma.mealRecipeItem.create({
			data: { mealId: meal.id, recipeTitle: 'Rice', order: 1 },
		})
		await Promise.all([
			send(session, {
				intent: 'delete-meal-item',
				itemId: meal.recipeItems[0]!.id,
			}),
			send(session, { intent: 'delete-meal-item', itemId: rice.id }),
		])
		expect(await prisma.meal.count({ where: { id: meal.id } })).toBe(0)
	})
})

describe('more trust', () => {
	test("another member of the same Household cannot use a member's seal", async () => {
		const session = await setupUser()
		const member = await addMember(session)
		const row = await prisma.shoppingListItem.create({
			data: { listId: session.listId, name: 'milk' },
		})
		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [row.id],
		})
		expect(
			await send(member, { intent: 'restore', token: deleted.body.token }),
		).toEqual({
			status: 403,
			body: { status: 'refused' },
		})
	})

	test('a seal made with an older listed secret still opens; one without the undo-delete prefix, or with an extra segment, does not', async () => {
		const session = await setupUser()
		const row = await prisma.shoppingListItem.create({
			data: { listId: session.listId, name: 'milk' },
		})
		const original = process.env.SESSION_SECRET
		using _ = {
			[Symbol.dispose]: () => void (process.env.SESSION_SECRET = original),
		}
		process.env.SESSION_SECRET = 'older'
		const deleted = await send(session, {
			intent: 'delete-shopping',
			itemIds: [row.id],
		})
		const token = deleted.body.token!
		process.env.SESSION_SECRET = 'newer,older'
		expect(openUndo(token, session)).not.toBeNull()
		process.env.SESSION_SECRET = 'newer'
		expect(openUndo(token, session)).toBeNull()

		process.env.SESSION_SECRET = 'older'
		const [body] = token.split('.') as [string, string]
		const unprefixed = createHmac('sha256', 'older')
			.update(body)
			.digest('base64url')
		expect(openUndo(`${body}.${unprefixed}`, session)).toBeNull()
		expect(openUndo(`${token}.x`, session)).toBeNull()
	})

	test('scoping holds for Staples, Meal plans, a card’s Meal, section and Recipe, a Meal’s Menu, and an amount’s Meal', async () => {
		const session = await setupUser()
		const other = await setupUser()
		const scope = { householdId: session.householdId }
		const theirStaple = await prisma.householdIngredient.create({
			data: {
				householdId: other.householdId,
				displayName: 'Salt',
				canonicalKey: 'salt',
				isStaple: false,
			},
		})
		expect(
			await restoreStaple(prisma, { ...scope, stapleId: theirStaple.id }),
		).toEqual({
			status: 'gone',
		})
		expect(
			(
				await prisma.householdIngredient.findUniqueOrThrow({
					where: { id: theirStaple.id },
				})
			).isStaple,
		).toBe(false)

		const theirMeal = await seedMeal(other)
		const theirMenu = await prisma.menu.create({
			data: {
				title: 'Theirs',
				titleKey: 'theirs',
				householdId: other.householdId,
			},
		})
		const ourMeal = await seedMeal(session)
		const section = await prisma.mealSection.create({
			data: { mealId: ourMeal.id, order: 0 },
		})
		const theirSection = await prisma.mealSection.create({
			data: { mealId: theirMeal.id, order: 0 },
		})

		// A card: their Meal is gone to us; our Meal with their section and
		// Recipe drops both.
		const card = {
			id: 'card-x',
			mealId: theirMeal.id,
			order: 2,
			recipeTitle: 'X',
			scaleMultiplier: 1,
			cooked: false,
			note: null,
			recipeId: theirMeal.recipeItems[0]!.recipeId,
			sectionId: theirSection.id,
			createdAt: new Date(),
		}
		expect(await restoreMealItem(prisma, { ...scope, item: card })).toEqual({
			status: 'gone',
		})
		await restoreMealItem(prisma, {
			...scope,
			item: { ...card, mealId: ourMeal.id },
		})
		expect(
			await prisma.mealRecipeItem.findUniqueOrThrow({
				where: { id: 'card-x' },
				select: { recipeId: true, sectionId: true },
			}),
		).toEqual({ recipeId: null, sectionId: null })
		await restoreMealItem(prisma, {
			...scope,
			item: {
				...card,
				id: 'card-y',
				mealId: ourMeal.id,
				sectionId: section.id,
				recipeId: null,
			},
		})
		expect(
			(
				await prisma.mealRecipeItem.findUniqueOrThrow({
					where: { id: 'card-y' },
				})
			).sectionId,
		).toBe(section.id)

		// A Meal: their plan is gone to us; their Menu is dropped.
		const removed = await send(session, {
			intent: 'delete-meal',
			mealId: ourMeal.id,
			removeShoppingContributions: false,
		})
		const snapshot = openUndo(removed.body.token!, session)
		if (snapshot?.kind !== 'meal') throw new Error('expected a Meal')
		expect(
			await restoreMeal(prisma, {
				...scope,
				snapshot: {
					...snapshot.meal,
					meal: { ...snapshot.meal.meal, mealPlanId: theirMeal.mealPlanId },
				},
			}),
		).toEqual({ status: 'gone' })
		await restoreMeal(prisma, {
			...scope,
			snapshot: {
				...snapshot.meal,
				meal: { ...snapshot.meal.meal, sourceMenuId: theirMenu.id },
			},
		})
		expect(
			(await prisma.meal.findUniqueOrThrow({ where: { id: ourMeal.id } }))
				.sourceMenuId,
		).toBeNull()

		// An amount naming their Meal is left out of a row put back.
		await restoreShoppingRows(prisma, {
			...scope,
			rows: [
				{
					id: 'row-x',
					name: 'flour',
					quantity: null,
					unit: null,
					category: null,
					checked: true,
					checkVersion: 0,
					source: 'meal',
					horizon: 'next',
					createdAt: new Date(),
					mealContributions: [
						{
							id: 'contribution-x',
							mealId: theirMeal.id,
							itemId: 'row-x',
							canonicalName: 'flour',
							name: 'flour',
							quantity: null,
							unit: null,
							createdAt: new Date(),
						},
					],
				},
			],
		})
		expect(
			await prisma.mealShoppingContribution.count({
				where: { id: 'contribution-x' },
			}),
		).toBe(0)
		expect(
			await prisma.shoppingListItem.count({ where: { id: 'row-x' } }),
		).toBe(1)
	})
})

describe('a Meal', () => {
	test('goes with its sections, cards, notes and lines, and comes back with its Shopping amounts relinked', async () => {
		const session = await setupUser()
		const meal = await seedMeal(session)
		const section = await prisma.mealSection.create({
			data: { mealId: meal.id, name: 'Mains', order: 0 },
		})
		await prisma.mealNoteItem.create({
			data: {
				mealId: meal.id,
				sectionId: section.id,
				order: 1,
				text: 'Bring bread',
				shoppingLines: { create: { name: 'bread', quantity: '1' } },
			},
		})
		const row = await seedRowWithAmount(session, meal.id, { name: 'lentils' })
		const snapshotOf = () =>
			prisma.meal.findUnique({
				where: { id: meal.id },
				include: {
					sections: true,
					recipeItems: true,
					noteItems: { include: { shoppingLines: true } },
					shoppingContributions: { select: { id: true } },
				},
			})
		const before = await snapshotOf()

		const deleted = await send(session, {
			intent: 'delete-meal',
			mealId: meal.id,
			removeShoppingContributions: false,
		})
		expect(await snapshotOf()).toBeNull()
		expect((await rowsOf(session))[0]!.mealContributions).toEqual([
			{ id: row.mealContributions[0]!.id, mealId: null },
		])

		await send(session, { intent: 'restore', token: deleted.body.token })
		const after = await snapshotOf()
		const withoutUpdatedAt = (value: unknown) =>
			JSON.parse(
				JSON.stringify(value, (key, v) =>
					key === 'updatedAt' ? undefined : v,
				),
			)
		expect(withoutUpdatedAt(after)).toEqual(withoutUpdatedAt(before))
	})

	test('with "remove generated amount", rows only it asked for go and come back', async () => {
		const session = await setupUser()
		const meal = await seedMeal(session)
		const other = await seedMeal(session, 'Rice')
		await seedRowWithAmount(session, meal.id, { name: 'lentils' })
		const shared = await seedRowWithAmount(session, other.id, { name: 'onion' })
		await prisma.mealShoppingContribution.create({
			data: {
				mealId: meal.id,
				itemId: shared.id,
				canonicalName: 'onion',
				name: 'onion',
			},
		})
		const before = await rowsOf(session)

		const deleted = await send(session, {
			intent: 'delete-meal',
			mealId: meal.id,
			removeShoppingContributions: true,
		})
		expect(
			(await rowsOf(session)).map((r) => [r.name, r.mealContributions.length]),
		).toEqual([['onion', 1]])
		await send(session, { intent: 'restore', token: deleted.body.token })
		const sortIds = (rows: typeof before) =>
			rows.map((r) => ({
				...r,
				mealContributions: [...r.mealContributions].sort((a, b) =>
					a.id.localeCompare(b.id),
				),
			}))
		expect(sortIds(await rowsOf(session))).toEqual(sortIds(before))
	})

	test('a Recipe deleted since comes back as a missing card', async () => {
		const session = await setupUser()
		const meal = await seedMeal(session)
		const deleted = await send(session, {
			intent: 'delete-meal',
			mealId: meal.id,
			removeShoppingContributions: false,
		})
		await prisma.recipe.deleteMany({
			where: { householdId: session.householdId },
		})
		await send(session, { intent: 'restore', token: deleted.body.token })
		expect(
			await prisma.mealRecipeItem.findMany({
				where: { mealId: meal.id },
				select: { recipeTitle: true, recipeId: true },
			}),
		).toEqual([{ recipeTitle: 'Dal', recipeId: null }])
	})
})

describe('a Recipe in a Meal', () => {
	test('is removed alone and put back; the last card takes the Meal, and Undo brings the Meal back', async () => {
		const session = await setupUser()
		const meal = await seedMeal(session)
		const rice = await prisma.mealRecipeItem.create({
			data: { mealId: meal.id, recipeTitle: 'Rice', order: 1 },
		})
		const cards = () =>
			prisma.mealRecipeItem.findMany({
				where: { mealId: meal.id },
				orderBy: { order: 'asc' },
				select: { id: true, recipeTitle: true, order: true },
			})
		const before = await cards()

		const removed = await send(session, {
			intent: 'delete-meal-item',
			itemId: rice.id,
		})
		expect((await cards()).map((c) => c.recipeTitle)).toEqual(['Dal'])
		await send(session, { intent: 'restore', token: removed.body.token })
		expect(await cards()).toEqual(before)

		await prisma.mealRecipeItem.delete({ where: { id: rice.id } })
		const last = await send(session, {
			intent: 'delete-meal-item',
			itemId: meal.recipeItems[0]!.id,
		})
		expect(await prisma.meal.count({ where: { id: meal.id } })).toBe(0)
		await send(session, { intent: 'restore', token: last.body.token })
		expect((await cards()).map((c) => c.recipeTitle)).toEqual(['Dal'])
	})
})

test('a Staple is unmarked at once and marked again by Undo', async () => {
	const session = await setupUser()
	const staple = await prisma.householdIngredient.create({
		data: {
			householdId: session.householdId,
			displayName: 'Salt',
			canonicalKey: 'salt',
			isStaple: true,
		},
	})
	const isStaple = async () =>
		(
			await prisma.householdIngredient.findUniqueOrThrow({
				where: { id: staple.id },
			})
		).isStaple
	const removed = await send(session, {
		intent: 'remove-staple',
		stapleId: staple.id,
	})
	expect(await isStaple()).toBe(false)
	await send(session, { intent: 'restore', token: removed.body.token })
	expect(await isStaple()).toBe(true)
})
