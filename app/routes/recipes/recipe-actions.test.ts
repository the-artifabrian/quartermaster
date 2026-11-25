/**
 * Favourite failure list:
 * - Two members both add a Recipe to favourites and it ends up unstarred.
 * - Two taps asking for the same state at once cancel out.
 * - A double tap (add, then remove) ends in the first tap's state.
 * - A state that is neither true nor false is saved as one of them.
 * - A page loaded before the change, which posts no state, stops working.
 *
 * Failure list for this change (Recipe detail → Shopping):
 * - Adding an ingredient to Shopping emits a household event that carries
 *   the device's client id, so that device doesn't light its own Shopping
 *   dot.
 * - Adding an ingredient another member has just removed throws a 404, which
 *   the page shows as "Recipe not found" over a Recipe that is still there.
 */
import { RouterContextProvider } from 'react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { loader, action } from './$recipeId.tsx'
import '#tests/setup/db-setup.ts'

function makeActionArgs(recipeId: string) {
	return {
		params: { recipeId },
		context: new RouterContextProvider(),
		pattern: '/recipes/:recipeId',
		url: new URL(`${BASE_URL}/recipes/${recipeId}`),
	}
}

async function setupUser() {
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
				name: 'Test Household',
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		return { ...session, householdId: household.id }
	})
}

async function setupRecipe(
	userId: string,
	householdId: string,
	overrides?: { isFavorite?: boolean },
) {
	return prisma.recipe.create({
		data: {
			title: 'Test Recipe',
			description: 'A test description',
			userId,
			householdId,
			activeTime: 10,
			totalTime: 40,
			yieldAmount: 4,
			yieldLabel: 'servings',
			isFavorite: overrides?.isFavorite ?? false,
			ingredients: {
				create: [
					{ name: 'flour', amount: '2', unit: 'cups', order: 0 },
					{ name: 'butter', amount: '1', unit: 'tbsp', order: 1 },
				],
			},
			instructions: {
				create: [
					{ content: 'Mix ingredients', order: 0 },
					{ content: 'Bake at 350F', order: 1 },
				],
			},
		},
	})
}

async function makeRequest(
	session: { id: string },
	recipeId: string,
	formFields: Record<string, string>,
	method: 'GET' | 'POST' = 'POST',
) {
	const cookie = await getSessionCookieHeader(session)
	if (method === 'GET') {
		return new Request(`${BASE_URL}/recipes/${recipeId}`, {
			method: 'GET',
			headers: { cookie },
		})
	}
	const formData = new URLSearchParams(formFields)
	return new Request(`${BASE_URL}/recipes/${recipeId}`, {
		method: 'POST',
		headers: {
			cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: formData.toString(),
	})
}

describe('recipe detail loader', () => {
	test('returns 404 for nonexistent recipe', async () => {
		const session = await setupUser()

		const request = await makeRequest(session, 'nonexistent', {}, 'GET')
		const response = loader({
			request,
			...makeActionArgs('nonexistent'),
		})
		await expect(response).rejects.toEqual(
			expect.objectContaining({ status: 404 }),
		)
	})

	test('returns 403 for other user recipe', async () => {
		const session1 = await setupUser()
		const session2 = await setupUser()
		const recipe = await setupRecipe(session1.userId, session1.householdId)

		const request = await makeRequest(session2, recipe.id, {}, 'GET')
		const response = loader({
			request,
			...makeActionArgs(recipe.id),
		})
		await expect(response).rejects.toEqual(
			expect.objectContaining({ status: 403 }),
		)
	})
})

describe('recipe detail actions', () => {
	test.each(['next', 'later'])(
		'an explicit ingredient addition keeps a checked purchase in %s separate (#226)',
		async (horizon) => {
			const session = await setupUser()
			const recipe = await setupRecipe(session.userId, session.householdId)
			const ingredient = await prisma.ingredient.create({
				data: {
					recipeId: recipe.id,
					name: 'rice',
					amount: '400',
					unit: 'g',
					order: 2,
				},
			})
			const list = await prisma.shoppingList.create({
				data: { userId: session.userId, householdId: session.householdId },
			})
			const purchased = await prisma.shoppingListItem.create({
				data: {
					listId: list.id,
					name: 'rice',
					quantity: '200',
					unit: 'g',
					checked: true,
					horizon,
				},
			})
			const addIngredient = async () =>
				action({
					request: await makeRequest(session, recipe.id, {
						intent: 'add-single-to-shopping-list',
						ingredientId: ingredient.id,
					}),
					...makeActionArgs(recipe.id),
				})

			const result = await addIngredient()
			const rows = await prisma.shoppingListItem.findMany({
				where: { listId: list.id },
			})
			expect(rows).toHaveLength(2)
			expect(result).toMatchObject({ wasNew: true })
			expect(rows.find((row) => row.id === purchased.id)).toEqual(purchased)
			expect(rows.find((row) => row.id !== purchased.id)).toMatchObject({
				name: 'rice',
				quantity: '400',
				unit: 'g',
				checked: false,
				source: 'recipe',
				horizon: 'next',
			})

			// A repeated ingredient tap still deduplicates the outstanding purchase.
			expect(await addIngredient()).toMatchObject({ wasNew: false })
			expect(
				await prisma.shoppingListItem.findMany({ where: { listId: list.id } }),
			).toEqual(rows)
		},
	)

	test.each(['next', 'later'])(
		'an ingredient tap reuses an unchecked %s purchase without changing its amount (#226)',
		async (horizon) => {
			const session = await setupUser()
			const recipe = await setupRecipe(session.userId, session.householdId)
			const ingredient = await prisma.ingredient.findFirstOrThrow({
				where: { recipeId: recipe.id, name: 'flour' },
			})
			const list = await prisma.shoppingList.create({
				data: { userId: session.userId, householdId: session.householdId },
			})
			const existing = await prisma.shoppingListItem.create({
				data: {
					listId: list.id,
					name: 'flour',
					quantity: '1',
					unit: 'bag',
					horizon,
				},
			})
			expect(
				await action({
					request: await makeRequest(session, recipe.id, {
						intent: 'add-single-to-shopping-list',
						ingredientId: ingredient.id,
					}),
					...makeActionArgs(recipe.id),
				}),
			).toMatchObject({ wasNew: false, wasPromoted: horizon === 'later' })
			expect(
				await prisma.shoppingListItem.findMany({ where: { listId: list.id } }),
			).toEqual([
				{
					...existing,
					horizon: 'next',
					checkVersion: existing.checkVersion + Number(horizon === 'later'),
				},
			])
		},
	)

	test('adding an ingredient that was removed answers with an error, not a thrown 404', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const ingredient = await prisma.ingredient.findFirstOrThrow({
			where: { recipeId: recipe.id, name: 'flour' },
		})
		await prisma.ingredient.delete({ where: { id: ingredient.id } })

		const result = await action({
			request: await makeRequest(session, recipe.id, {
				intent: 'add-single-to-shopping-list',
				ingredientId: ingredient.id,
			}),
			...makeActionArgs(recipe.id),
		})

		expect(result).toMatchObject({
			init: { status: 404 },
			data: { success: false, error: expect.any(String) },
		})
		expect(await prisma.shoppingListItem.count()).toBe(0)
	})

	test('adding an ingredient to Shopping names the device in its event', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const ingredient = await prisma.ingredient.create({
			data: { recipeId: recipe.id, name: 'leeks', amount: '2', order: 0 },
		})
		vi.mocked(emitHouseholdEvent).mockClear()

		await action({
			request: await makeRequest(session, recipe.id, {
				intent: 'add-single-to-shopping-list',
				ingredientId: ingredient.id,
				originClientId: 'this-phone',
			}),
			...makeActionArgs(recipe.id),
		})

		expect(vi.mocked(emitHouseholdEvent)).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'shopping_list_item_added',
				originClientId: 'this-phone',
			}),
		)
	})

	test('caps enhancement descriptions at the Recipe field limit', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		const request = await makeRequest(session, recipe.id, {
			intent: 'applyEnhancement',
			enhance_description: `  ${'a'.repeat(600)}  `,
		})
		expect(await action({ request, ...makeActionArgs(recipe.id) })).toEqual({
			success: true,
		})

		await expect(
			prisma.recipe.findUniqueOrThrow({
				where: { id: recipe.id },
				select: { description: true },
			}),
		).resolves.toEqual({ description: 'a'.repeat(500) })
	})

	test('rejects an enhancement time that conflicts with saved time', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		const request = await makeRequest(session, recipe.id, {
			intent: 'applyEnhancement',
			enhance_activeTime: '50',
		})
		expect(await action({ request, ...makeActionArgs(recipe.id) })).toEqual({
			success: false,
			error:
				'Total time can’t be shorter than active time. Untick one of them.',
		})

		await expect(
			prisma.recipe.findUniqueOrThrow({
				where: { id: recipe.id },
				select: { activeTime: true, totalTime: true },
			}),
		).resolves.toEqual({ activeTime: 10, totalTime: 40 })
	})

	test('a favourite tap saves the state it asked for, however often it arrives', async () => {
		const session = await setupUser()
		const partner = await prisma.$transaction(async (tx) => {
			const member = await tx.session.create({
				data: {
					expirationDate: getSessionExpirationDate(),
					user: { create: createUser() },
				},
				select: { id: true, userId: true },
			})
			await tx.householdMember.create({
				data: {
					householdId: session.householdId,
					userId: member.userId,
					role: 'member',
				},
			})
			return member
		})
		const recipe = await setupRecipe(session.userId, session.householdId)
		const setFavorite = async (who: { id: string }, value: string) =>
			action({
				request: await makeRequest(who, recipe.id, {
					intent: 'toggleFavorite',
					isFavorite: value,
				}),
				...makeActionArgs(recipe.id),
			})
		const stored = async () =>
			(
				await prisma.recipe.findUniqueOrThrow({
					where: { id: recipe.id },
					select: { isFavorite: true },
				})
			).isFavorite

		// Both members add it from a page that showed it unstarred.
		expect(await setFavorite(session, 'true')).toEqual({ success: true })
		expect(await setFavorite(partner, 'true')).toEqual({ success: true })
		expect(await stored()).toBe(true)

		// Two at once, both asking for the same state.
		await Promise.all([
			setFavorite(session, 'false'),
			setFavorite(partner, 'false'),
		])
		expect(await stored()).toBe(false)

		// A double tap: add, then remove. The last one wins.
		await setFavorite(session, 'true')
		await setFavorite(session, 'false')
		expect(await stored()).toBe(false)
	})

	test('a favourite tap with a state that is neither true nor false changes nothing', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId, {
			isFavorite: true,
		})

		await expect(
			action({
				request: await makeRequest(session, recipe.id, {
					intent: 'toggleFavorite',
					isFavorite: 'yes',
				}),
				...makeActionArgs(recipe.id),
			}),
		).rejects.toEqual(expect.objectContaining({ status: 400 }))
		const after = await prisma.recipe.findUniqueOrThrow({
			where: { id: recipe.id },
			select: { isFavorite: true },
		})
		expect(after.isFavorite).toBe(true)
	})

	test('a favourite tap from a page loaded before the state was sent still flips it', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId, {
			isFavorite: false,
		})

		await action({
			request: await makeRequest(session, recipe.id, {
				intent: 'toggleFavorite',
			}),
			...makeActionArgs(recipe.id),
		})
		const after = await prisma.recipe.findUniqueOrThrow({
			where: { id: recipe.id },
			select: { isFavorite: true },
		})
		expect(after.isFavorite).toBe(true)
	})

	test('action on nonexistent recipe returns 404', async () => {
		const session = await setupUser()

		const request = await makeRequest(session, 'nonexistent', {
			intent: 'toggleFavorite',
		})
		const response = action({
			request,
			...makeActionArgs('nonexistent'),
		})
		await expect(response).rejects.toEqual(
			expect.objectContaining({ status: 404 }),
		)
	})

	test('action on other user recipe returns 403', async () => {
		const session1 = await setupUser()
		const session2 = await setupUser()
		const recipe = await setupRecipe(session1.userId, session1.householdId)

		const request = await makeRequest(session2, recipe.id, {
			intent: 'toggleFavorite',
		})
		const response = action({
			request,
			...makeActionArgs(recipe.id),
		})
		await expect(response).rejects.toEqual(
			expect.objectContaining({ status: 403 }),
		)
	})
})
