import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as recipeAction } from '../recipes/$recipeId.tsx'
import { loader as recipesLoader } from '../recipes/index.tsx'
import { action, loader } from './index.tsx'

const ROUTE_ARGS = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/inventory',
	url: new URL(`${BASE_URL}/inventory`),
}

async function setupHousehold(inventoryNames: string[] = []) {
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
				name: 'Cutover Household',
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		if (inventoryNames.length > 0) {
			await tx.inventoryItem.createMany({
				data: inventoryNames.map((name) => ({
					name,
					userId: session.userId,
					householdId: household.id,
				})),
			})
		}
		return { ...session, householdId: household.id }
	})
}

async function routeRequest(
	session: { id: string },
	fields?: Record<string, string>,
) {
	const cookie = await getSessionCookieHeader(session)
	return new Request(`${BASE_URL}/inventory`, {
		method: fields ? 'POST' : 'GET',
		headers: fields
			? { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }
			: { cookie },
		...(fields ? { body: new URLSearchParams(fields).toString() } : {}),
	})
}

async function loadInventory(session: { id: string }) {
	return loader({ request: await routeRequest(session), ...ROUTE_ARGS })
}

async function postInventory(
	session: { id: string },
	fields: Record<string, string>,
) {
	return action({ request: await routeRequest(session, fields), ...ROUTE_ARGS })
}

describe('Staples cutover', () => {
	test('seeds a reviewable selection from archived Pantry plus editable suggestions', async () => {
		const session = await setupHousehold(['Sesame   Oil', 'Smoked paprika'])

		const result = await loadInventory(session)

		expect(result.staplesCutoverAt).toBeNull()
		expect(result.staples).toEqual([])
		expect(result.archivedInventoryCount).toBe(2)
		expect(
			result.cutoverOptions
				.filter((item) => item.source === 'pantry')
				.map((item) => [item.displayName, item.canonicalKey, item.selected]),
		).toEqual([
			['Sesame Oil', 'sesame oil', true],
			['Smoked paprika', 'smoked paprika', true],
		])
		// The common sesame-oil suggestion is merged into the reviewed Pantry
		// identity rather than shown as a duplicate unchecked choice.
		expect(
			result.cutoverOptions.filter(
				(item) => item.canonicalKey === 'sesame oil',
			),
		).toHaveLength(1)
		expect(
			result.cutoverOptions.find((item) => item.canonicalKey === 'salt'),
		).toMatchObject({ source: 'suggestion', selected: true })
	})

	test('confirmation atomically saves normalized household Staples and leaves Pantry archived', async () => {
		const session = await setupHousehold(['Legacy garlic'])

		const result = await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: JSON.stringify([
				{ displayName: '  Olive   Oil ' },
				{ displayName: 'OLIVE OIL' },
				{ displayName: 'Salt' },
			]),
		})

		expect(result).toMatchObject({
			status: 'success',
			action: 'confirm-staples-cutover',
			savedCount: 2,
		})
		const household = await prisma.household.findUniqueOrThrow({
			where: { id: session.householdId },
			select: { staplesCutoverAt: true },
		})
		expect(household.staplesCutoverAt).toBeInstanceOf(Date)
		expect(
			await prisma.householdIngredient.findMany({
				where: { householdId: session.householdId },
				orderBy: { canonicalKey: 'asc' },
				select: {
					displayName: true,
					canonicalKey: true,
					isStaple: true,
					isOut: true,
				},
			}),
		).toEqual([
			{
				displayName: 'Olive Oil',
				canonicalKey: 'olive oil',
				isStaple: true,
				isOut: false,
			},
			{
				displayName: 'Salt',
				canonicalKey: 'salt',
				isStaple: true,
				isOut: false,
			},
		])
		expect(
			await prisma.inventoryItem.findMany({
				where: { householdId: session.householdId },
				select: { name: true },
			}),
		).toEqual([{ name: 'Legacy garlic' }])
	})

	test('an empty confirmed selection is distinct from a household that has not cut over', async () => {
		const session = await setupHousehold(['Archived rice'])

		const result = await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: '[]',
		})

		expect(result).toMatchObject({ status: 'success', savedCount: 0 })
		const after = await loadInventory(session)
		expect(after.staplesCutoverAt).toBeInstanceOf(Date)
		expect(after.staples).toEqual([])
		expect(after.cutoverOptions).toEqual([])
		expect(after.archivedInventoryCount).toBe(1)
	})

	test('invalid or repeated confirmation cannot partially change the cutover', async () => {
		const session = await setupHousehold()

		const invalid = (await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: JSON.stringify([{ displayName: '   ' }]),
		})) as any
		expect(invalid.init?.status).toBe(400)
		expect(
			await prisma.household.findUniqueOrThrow({
				where: { id: session.householdId },
				select: { staplesCutoverAt: true },
			}),
		).toEqual({ staplesCutoverAt: null })
		expect(
			await prisma.householdIngredient.count({
				where: { householdId: session.householdId },
			}),
		).toBe(0)

		await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: JSON.stringify([{ displayName: 'Salt' }]),
		})
		const repeated = (await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: JSON.stringify([{ displayName: 'Sugar' }]),
		})) as any
		expect(repeated.init?.status).toBe(409)
		expect(
			await prisma.householdIngredient.findMany({
				where: { householdId: session.householdId },
				select: { canonicalKey: true },
			}),
		).toEqual([{ canonicalKey: 'salt' }])
	})

	test('explicit recovery clears only the timestamp and restores the archived Pantry review path', async () => {
		const session = await setupHousehold(['Cumin'])
		await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: JSON.stringify([{ displayName: 'Salt' }]),
		})
		await prisma.householdIngredient.updateMany({
			where: { householdId: session.householdId, canonicalKey: 'salt' },
			data: { isOut: true },
		})

		const result = await postInventory(session, {
			intent: 'restore-legacy-pantry',
		})

		expect(result).toMatchObject({
			status: 'success',
			action: 'restore-legacy-pantry',
		})
		const after = await loadInventory(session)
		expect(after.staplesCutoverAt).toBeNull()
		expect(
			after.cutoverOptions.find((item) => item.canonicalKey === 'cumin'),
		).toMatchObject({ source: 'pantry', selected: true })
		expect(
			await prisma.householdIngredient.findMany({
				where: { householdId: session.householdId },
				select: { canonicalKey: true, isStaple: true, isOut: true },
			}),
		).toEqual([{ canonicalKey: 'salt', isStaple: true, isOut: true }])

		await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: JSON.stringify([{ displayName: 'Salt' }]),
		})
		expect(
			await prisma.householdIngredient.findFirstOrThrow({
				where: { householdId: session.householdId, canonicalKey: 'salt' },
				select: { isStaple: true, isOut: true },
			}),
		).toEqual({ isStaple: true, isOut: true })
	})

	test('archived Pantry stops affecting Recipe discovery and explicit Shopping after cutover', async () => {
		const session = await setupHousehold(['chicken breast'])
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Roast chicken',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: {
					create: {
						name: 'chicken breast',
						amount: '2',
						unit: 'pieces',
						order: 0,
					},
				},
			},
		})
		const cookie = await getSessionCookieHeader(session)
		const recipesArgs = {
			...ROUTE_ARGS,
			pattern: '/recipes',
			url: new URL(`${BASE_URL}/recipes`),
		}
		const before = await recipesLoader({
			request: new Request(`${BASE_URL}/recipes`, { headers: { cookie } }),
			...recipesArgs,
		})
		expect(before.hasInventory).toBe(true)
		expect(before.matchData?.makeableCount).toBe(1)

		await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: '[]',
		})

		const after = await recipesLoader({
			request: new Request(`${BASE_URL}/recipes`, { headers: { cookie } }),
			...recipesArgs,
		})
		expect(after.hasInventory).toBe(false)
		expect(after.matchData).toBeNull()

		const shoppingResult = await recipeAction({
			request: new Request(`${BASE_URL}/recipes/${recipe.id}`, {
				method: 'POST',
				headers: {
					cookie,
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					intent: 'add-to-shopping-list',
					servingRatio: '1',
				}).toString(),
			}),
			params: { recipeId: recipe.id },
			context: new RouterContextProvider(),
			pattern: '/recipes/:recipeId',
			url: new URL(`${BASE_URL}/recipes/${recipe.id}`),
		})
		expect(shoppingResult).toMatchObject({
			success: true,
			addedToShoppingList: 1,
			addedInStock: 0,
		})
		expect(
			await prisma.shoppingListItem.findFirstOrThrow({
				where: { list: { householdId: session.householdId } },
				select: { name: true, checked: true, source: true },
			}),
		).toEqual({ name: 'chicken breast', checked: false, source: 'recipe' })
	})
})
