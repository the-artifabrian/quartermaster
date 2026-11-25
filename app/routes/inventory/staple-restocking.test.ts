import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createSignedInHousehold } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './index.tsx'
import '#tests/setup/db-setup.ts'

const ROUTE_ARGS = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/inventory',
	url: new URL(`${BASE_URL}/inventory`),
}

async function setupHousehold(displayName = 'Salt') {
	const user = await createSignedInHousehold({
		name: 'Restocking Household',
		tier: 'pro',
	})
	const staple = await prisma.householdIngredient.create({
		data: {
			householdId: user.householdId,
			displayName,
			canonicalKey: displayName.toLowerCase(),
			isStaple: true,
		},
		select: { id: true },
	})
	return { ...user, stapleId: staple.id }
}

async function postAddToShop(
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
				intent: 'add-staple-to-shop',
				itemId,
				originClientId: 'this-phone',
			}).toString(),
		}),
		...ROUTE_ARGS,
	})
}

describe('tapping a Staple restocks Next shop', () => {
	// The event carries the device's client id, so that device doesn't light its
	// own Shopping dot.
	test('the event names the device that tapped', async () => {
		const session = await setupHousehold()

		await postAddToShop(session)

		const event = await prisma.householdEvent.findFirstOrThrow({
			where: { householdId: session.householdId },
		})
		expect(event.type).toBe('shopping_list_item_added')
		expect(JSON.parse(event.payload)).toMatchObject({
			originClientId: 'this-phone',
		})
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

		const result = await postAddToShop(session)

		expect(result).toMatchObject({
			status: 'success',
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

		const result = await postAddToShop(session)

		expect(result).toMatchObject({
			status: 'success',
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

	test('leaves an unchecked Next-shop match intact, however often it is tapped', async () => {
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

		const firstTap = await postAddToShop(session)
		expect(firstTap).toMatchObject({
			status: 'success',
			shoppingEffect: 'already-in-next-shop',
			message: 'Salt is already in Next shop.',
		})

		// A second tap is not an undo: the list already says what it says.
		const secondTap = await postAddToShop(session)
		expect(secondTap).toMatchObject({
			status: 'success',
			shoppingEffect: 'already-in-next-shop',
			message: 'Salt is already in Next shop.',
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
		// Neither tap added anything, so neither told the other member one did.
		expect(
			await prisma.householdEvent.count({
				where: { householdId: session.householdId },
			}),
		).toBe(0)
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

		const result = await postAddToShop(session)

		expect(result).toMatchObject({ shoppingEffect: 'resurfaced' })
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

		await postAddToShop(session)

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

		await expect(postAddToShop(owner, other.stapleId)).rejects.toMatchObject({
			status: 404,
		})
		expect(
			await prisma.shoppingListItem.count({
				where: {
					list: { householdId: { in: [owner.householdId, other.householdId] } },
				},
			}),
		).toBe(0)
	})

	test('adds nothing when the Shopping write fails', async () => {
		const session = await setupHousehold()
		await prisma.$executeRawUnsafe(`
			CREATE TRIGGER reject_staple_restock
			BEFORE INSERT ON "ShoppingListItem"
			BEGIN
				SELECT RAISE(ABORT, 'simulated shopping failure');
			END
		`)

		try {
			const result = (await postAddToShop(session)) as any

			expect(result.init?.status).toBe(500)
			expect(result.data).toEqual({
				status: 'error',
				action: 'add-staple-to-shop',
				message: 'Could not add Salt to Next shop. Try again.',
			})
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
