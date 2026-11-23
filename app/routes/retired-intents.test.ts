/**
 * Deletes on Shopping, Plan and Staples go through resources/undo-delete now.
 * The form intents they used to post to each page's own action are gone, but a
 * tab or the service worker can still hold a page from before that and post
 * one of them.
 *
 * Failure list (what such an old page must get):
 * - Shopping `delete` with a real row id: a 400 the page reads as data, the
 *   row is still there, and the other member hears nothing.
 * - Shopping `clear-checked` for a section with checked rows: a 400, every
 *   checked row is still there, nobody hears of a clear.
 * - Plan `removeItem` on the last card of a Meal: a 400, the card and its
 *   Meal are still there.
 * - Plan `removeMeal` asking to remove its Shopping amounts: a 400, the Meal,
 *   its Shopping row and the amount linking them are all still there.
 * - Staples `remove-staple`: a 400, and it is still a Staple.
 * - A form posted to /plan/shopping-list, Shopping's old address: a 405, not
 *   a redirect to Shopping that drops the body (tests/e2e/shopping-list.test.ts,
 *   since only the built router answers a route with no action).
 * - Any of these must never be a 200 that saved nothing (the page would take
 *   it as done), a thrown error (the page would swap to the error page) or a
 *   500.
 */
import { RouterContextProvider } from 'react-router'
import { expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as staplesAction } from './inventory/index.tsx'
import { action as planAction } from './plan/index.tsx'
import { action as shoppingAction } from './shopping.tsx'
import '#tests/setup/db-setup.ts'

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
			name: 'Old page',
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

/** A form posted the way an old page's fetcher or Form posted it. */
async function oldForm(
	path: string,
	session: Session,
	fields: Record<string, string>,
) {
	return {
		request: new Request(`${BASE_URL}${path}`, {
			method: 'POST',
			headers: {
				cookie: await getSessionCookieHeader(session),
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams(fields),
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: path,
		url: new URL(`${BASE_URL}${path}`),
	}
}

const REFUSED = { data: { status: 'error' }, init: { status: 400 } }

async function seedMealOnShopping(session: Session) {
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Dal',
			userId: session.userId,
			householdId: session.householdId,
		},
	})
	const meal = await prisma.meal.create({
		data: {
			mealPlan: {
				create: {
					householdId: session.householdId,
					weekStart: new Date('2026-11-16'),
				},
			},
			date: new Date('2026-11-17'),
			order: 0,
			recipeItems: {
				create: { recipeId: recipe.id, recipeTitle: 'Dal', order: 0 },
			},
		},
		include: { recipeItems: true },
	})
	const row = await prisma.shoppingListItem.create({
		data: {
			listId: session.listId,
			name: 'lentils',
			quantity: '1',
			source: 'meal',
			mealContributions: {
				create: {
					mealId: meal.id,
					canonicalName: 'lentils',
					name: 'lentils',
					quantity: '1',
				},
			},
		},
	})
	return { meal, card: meal.recipeItems[0]!, row }
}

test('an old Shopping page that deletes a row gets a 400 and the row stays', async () => {
	const session = await setupUser()
	const row = await prisma.shoppingListItem.create({
		data: { listId: session.listId, name: 'milk' },
	})

	await expect(
		shoppingAction(
			await oldForm('/shopping', session, {
				intent: 'delete',
				itemId: row.id,
			}),
		),
	).resolves.toMatchObject(REFUSED)
	expect(await prisma.shoppingListItem.count({ where: { id: row.id } })).toBe(1)
	expect(emitHouseholdEvent).not.toHaveBeenCalledWith(
		expect.objectContaining({ householdId: session.householdId }),
	)
})

test('an old Shopping page that clears checked items gets a 400 and they stay', async () => {
	const session = await setupUser()
	await prisma.shoppingListItem.createMany({
		data: [
			{ listId: session.listId, name: 'bread', checked: true },
			{ listId: session.listId, name: 'butter', checked: true },
		],
	})

	await expect(
		shoppingAction(
			await oldForm('/shopping', session, {
				intent: 'clear-checked',
				horizon: 'next',
			}),
		),
	).resolves.toMatchObject(REFUSED)
	expect(
		await prisma.shoppingListItem.count({
			where: { listId: session.listId, checked: true },
		}),
	).toBe(2)
	expect(emitHouseholdEvent).not.toHaveBeenCalledWith(
		expect.objectContaining({ householdId: session.householdId }),
	)
})

test('an old Plan page that removes the last card gets a 400 and the Meal stays', async () => {
	const session = await setupUser()
	const { meal, card } = await seedMealOnShopping(session)

	await expect(
		planAction(
			await oldForm('/plan', session, {
				intent: 'removeItem',
				itemId: card.id,
			}),
		),
	).resolves.toMatchObject(REFUSED)
	expect(await prisma.meal.count({ where: { id: meal.id } })).toBe(1)
	expect(await prisma.mealRecipeItem.count({ where: { id: card.id } })).toBe(1)
})

test('an old Plan page that deletes a Meal and its Shopping amounts gets a 400 and all of it stays', async () => {
	const session = await setupUser()
	const { meal, row } = await seedMealOnShopping(session)

	await expect(
		planAction(
			await oldForm('/plan', session, {
				intent: 'removeMeal',
				mealId: meal.id,
				removeShoppingContributions: 'true',
			}),
		),
	).resolves.toMatchObject(REFUSED)
	expect(await prisma.meal.count({ where: { id: meal.id } })).toBe(1)
	expect(await prisma.shoppingListItem.count({ where: { id: row.id } })).toBe(1)
	expect(
		await prisma.mealShoppingContribution.count({
			where: { mealId: meal.id, itemId: row.id },
		}),
	).toBe(1)
	expect(emitHouseholdEvent).not.toHaveBeenCalledWith(
		expect.objectContaining({ householdId: session.householdId }),
	)
})

test('an old Staples page that deletes a Staple gets a 400 and it stays a Staple', async () => {
	const session = await setupUser()
	const staple = await prisma.householdIngredient.create({
		data: {
			householdId: session.householdId,
			displayName: 'Salt',
			canonicalKey: 'salt',
			isStaple: true,
		},
	})

	await expect(
		staplesAction(
			await oldForm('/inventory', session, {
				intent: 'remove-staple',
				itemId: staple.id,
			}),
		),
	).resolves.toMatchObject(REFUSED)
	expect(
		(
			await prisma.householdIngredient.findUniqueOrThrow({
				where: { id: staple.id },
			})
		).isStaple,
	).toBe(true)
})
