import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action, loader } from './index.tsx'

const ROUTE_ARGS = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/inventory',
	url: new URL(`${BASE_URL}/inventory`),
}

async function setupHousehold(displayName = 'Salt') {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: {
					create: {
						...createUser(),
						subscription: { create: { tier: 'pro' } },
					},
				},
			},
			select: { id: true, userId: true },
		})
		const household = await tx.household.create({
			data: {
				name: 'Restocking Household',
				staplesCutoverAt: new Date(),
				members: { create: { userId: session.userId, role: 'owner' } },
				householdIngredients: {
					create: {
						displayName,
						canonicalKey: displayName.toLowerCase(),
						isStaple: true,
					},
				},
			},
			select: {
				id: true,
				householdIngredients: { select: { id: true } },
			},
		})
		return {
			...session,
			householdId: household.id,
			stapleId: household.householdIngredients[0]!.id,
		}
	})
}

async function postToggle(
	session: { id: string; stapleId: string },
	itemId = session.stapleId,
) {
	const cookie = await getSessionCookieHeader(session)
	return action({
		request: new Request(`${BASE_URL}/inventory`, {
			method: 'POST',
			headers: {
				cookie,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				intent: 'toggle-staple-out',
				itemId,
			}).toString(),
		}),
		...ROUTE_ARGS,
	})
}

async function loadInventory(session: { id: string }) {
	const cookie = await getSessionCookieHeader(session)
	return loader({
		request: new Request(`${BASE_URL}/inventory`, { headers: { cookie } }),
		...ROUTE_ARGS,
	})
}

describe('marking a Staple Out restocks Next shop', () => {
	test('creates one manual Next-shop row when no match exists', async () => {
		const session = await setupHousehold()

		const result = await postToggle(session)

		expect(result).toMatchObject({
			status: 'success',
			action: 'toggle-staple-out',
			isOut: true,
			shoppingEffect: 'added',
			message: 'Salt was added to Next shop.',
		})
		expect((await loadInventory(session)).staples[0]!.isOut).toBe(true)
		expect(
			await prisma.shoppingListItem.findMany({
				where: { list: { householdId: session.householdId } },
				select: {
					name: true,
					category: true,
					source: true,
					horizon: true,
					checked: true,
				},
			}),
		).toEqual([
			{
				name: 'Salt',
				category: 'pantry',
				source: 'manual',
				horizon: 'next',
				checked: false,
			},
		])
		await expect
			.poll(() =>
				prisma.householdEvent.count({
					where: {
						householdId: session.householdId,
						type: 'shopping_list_item_added',
					},
				}),
			)
			.toBe(1)
	})

	test('moves an unchecked Later match to Next shop without rewriting it', async () => {
		const session = await setupHousehold()
		const list = await prisma.shoppingList.create({
			data: {
				userId: session.userId,
				householdId: session.householdId,
			},
		})
		const row = await prisma.shoppingListItem.create({
			data: {
				name: 'SALTS',
				quantity: '2',
				unit: 'boxes',
				category: 'other',
				source: 'recipe',
				horizon: 'later',
				listId: list.id,
			},
		})

		const result = await postToggle(session)

		expect(result).toMatchObject({
			status: 'success',
			isOut: true,
			shoppingEffect: 'moved',
			message: 'Salt was moved to Next shop.',
		})
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: row.id },
				select: {
					name: true,
					quantity: true,
					unit: true,
					category: true,
					source: true,
					horizon: true,
					checked: true,
				},
			}),
		).toEqual({
			name: 'SALTS',
			quantity: '2',
			unit: 'boxes',
			category: 'other',
			source: 'recipe',
			horizon: 'next',
			checked: false,
		})
	})

	test('resurfaces a checked Next-shop match instead of creating a duplicate', async () => {
		const session = await setupHousehold()
		const list = await prisma.shoppingList.create({
			data: {
				userId: session.userId,
				householdId: session.householdId,
			},
		})
		const row = await prisma.shoppingListItem.create({
			data: {
				name: 'salt',
				checked: true,
				horizon: 'next',
				listId: list.id,
			},
		})

		const result = await postToggle(session)

		expect(result).toMatchObject({
			status: 'success',
			isOut: true,
			shoppingEffect: 'resurfaced',
			message: 'Salt was brought back to Next shop.',
		})
		expect(
			await prisma.shoppingListItem.findMany({
				where: { listId: list.id },
				select: { id: true, checked: true, horizon: true },
			}),
		).toEqual([{ id: row.id, checked: false, horizon: 'next' }])
	})

	test('leaves an unchecked Next-shop match intact and decouples marking not Out', async () => {
		const session = await setupHousehold()
		const list = await prisma.shoppingList.create({
			data: {
				userId: session.userId,
				householdId: session.householdId,
			},
		})
		const row = await prisma.shoppingListItem.create({
			data: {
				name: 'salt',
				quantity: '1',
				unit: 'bag',
				horizon: 'next',
				listId: list.id,
			},
		})

		const markedOut = await postToggle(session)
		expect(markedOut).toMatchObject({
			status: 'success',
			isOut: true,
			shoppingEffect: 'already-in-next-shop',
			message: 'Salt is already in Next shop.',
		})

		const markedNotOut = await postToggle(session)
		expect(markedNotOut).toMatchObject({
			status: 'success',
			isOut: false,
			message: 'Salt marked not Out.',
		})
		expect(
			await prisma.shoppingListItem.findMany({
				where: { listId: list.id },
				select: {
					id: true,
					name: true,
					quantity: true,
					unit: true,
					checked: true,
					horizon: true,
				},
			}),
		).toEqual([
			{
				id: row.id,
				name: 'salt',
				quantity: '1',
				unit: 'bag',
				checked: false,
				horizon: 'next',
			},
		])
		expect(
			await prisma.householdEvent.count({
				where: { householdId: session.householdId },
			}),
		).toBe(1)
	})

	test('resurfaces a checked Later match with its Meal contribution intact', async () => {
		const session = await setupHousehold()
		const list = await prisma.shoppingList.create({
			data: {
				userId: session.userId,
				householdId: session.householdId,
			},
		})
		const row = await prisma.shoppingListItem.create({
			data: {
				name: 'Salt',
				quantity: '3',
				unit: 'tsp',
				source: 'recipe',
				checked: true,
				horizon: 'later',
				listId: list.id,
			},
		})
		const plan = await prisma.mealPlan.create({
			data: {
				householdId: session.householdId,
				weekStart: new Date('2026-09-07T00:00:00Z'),
				meals: {
					create: {
						date: new Date('2026-09-07T00:00:00Z'),
						order: 0,
						genericText: 'Dinner',
					},
				},
			},
			select: { meals: { select: { id: true } } },
		})
		const contribution = await prisma.mealShoppingContribution.create({
			data: {
				mealId: plan.meals[0]!.id,
				itemId: row.id,
				canonicalName: 'salt',
				name: 'Salt',
				quantity: '3',
				unit: 'tsp',
			},
		})

		const result = await postToggle(session)

		expect(result).toMatchObject({
			shoppingEffect: 'resurfaced',
			isOut: true,
		})
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: row.id },
				select: {
					quantity: true,
					unit: true,
					source: true,
					checked: true,
					horizon: true,
					mealContributions: { select: { id: true, itemId: true } },
				},
			}),
		).toEqual({
			quantity: '3',
			unit: 'tsp',
			source: 'recipe',
			checked: false,
			horizon: 'next',
			mealContributions: [{ id: contribution.id, itemId: row.id }],
		})
	})

	test('changes only the preferred match when duplicate rows already exist', async () => {
		const session = await setupHousehold()
		const list = await prisma.shoppingList.create({
			data: {
				userId: session.userId,
				householdId: session.householdId,
			},
		})
		const checkedLater = await prisma.shoppingListItem.create({
			data: {
				name: 'Salt',
				checked: true,
				horizon: 'later',
				listId: list.id,
				createdAt: new Date('2026-09-01T00:00:00Z'),
			},
		})
		const checkedNext = await prisma.shoppingListItem.create({
			data: {
				name: 'salts',
				checked: true,
				horizon: 'next',
				listId: list.id,
				createdAt: new Date('2026-09-02T00:00:00Z'),
			},
		})

		await postToggle(session)

		expect(
			await prisma.shoppingListItem.findMany({
				where: { listId: list.id },
				orderBy: { createdAt: 'asc' },
				select: { id: true, checked: true, horizon: true },
			}),
		).toEqual([
			{ id: checkedLater.id, checked: true, horizon: 'later' },
			{ id: checkedNext.id, checked: false, horizon: 'next' },
		])
	})

	test('cannot restock a Staple owned by another household', async () => {
		const owner = await setupHousehold('Salt')
		const other = await setupHousehold('Rice')

		await expect(postToggle(owner, other.stapleId)).rejects.toMatchObject({
			status: 404,
		})
		expect((await loadInventory(other)).staples[0]!.isOut).toBe(false)
		expect(
			await prisma.shoppingListItem.count({
				where: {
					list: { householdId: { in: [owner.householdId, other.householdId] } },
				},
			}),
		).toBe(0)
	})

	test('rolls back Out when the Shopping update fails', async () => {
		const session = await setupHousehold()
		await prisma.$executeRawUnsafe(`
			CREATE TRIGGER reject_staple_restock
			BEFORE INSERT ON "ShoppingListItem"
			BEGIN
				SELECT RAISE(ABORT, 'simulated shopping failure');
			END
		`)

		try {
			const result = (await postToggle(session)) as any

			expect(result.init?.status).toBe(500)
			expect(result.data).toEqual({
				status: 'error',
				action: 'toggle-staple-out',
				message: 'Could not mark Salt Out. Try again.',
			})
			expect((await loadInventory(session)).staples[0]!.isOut).toBe(false)
			expect(
				await prisma.shoppingListItem.count({
					where: { list: { householdId: session.householdId } },
				}),
			).toBe(0)
			expect(
				await prisma.householdEvent.count({
					where: { householdId: session.householdId },
				}),
			).toBe(0)
		} finally {
			await prisma.$executeRawUnsafe('DROP TRIGGER reject_staple_restock')
		}
	})
})
