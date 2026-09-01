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

	test('Recipe index completes Staples onboarding only after explicit cutover', async () => {
		const session = await setupHousehold(['Archived rice'])
		const cookie = await getSessionCookieHeader(session)
		const loadRecipes = () =>
			recipesLoader({
				request: new Request(`${BASE_URL}/recipes`, { headers: { cookie } }),
				...ROUTE_ARGS,
				pattern: '/recipes',
				url: new URL(`${BASE_URL}/recipes`),
			})

		const before = await loadRecipes()
		expect(before.onboarding.hasStaples).toBe(false)
		expect(before).not.toHaveProperty('hasInventory')

		await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: '[]',
		})

		const after = await loadRecipes()
		expect(after.onboarding.hasStaples).toBe(true)
		expect(after).not.toHaveProperty('hasInventory')
	})

	test('Recipe discovery omits household availability metadata', async () => {
		const session = await setupHousehold()
		await prisma.recipe.create({
			data: {
				title: 'Quiet recipe card',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: { create: { name: 'salt', order: 0 } },
			},
		})
		await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: JSON.stringify([{ displayName: 'Salt' }]),
		})
		const cookie = await getSessionCookieHeader(session)
		const result = await recipesLoader({
			request: new Request(`${BASE_URL}/recipes`, { headers: { cookie } }),
			...ROUTE_ARGS,
			pattern: '/recipes',
			url: new URL(`${BASE_URL}/recipes`),
		})

		expect(result.recipes[0]).not.toHaveProperty('needsItemCount')
	})

	test('Recipe discovery defaults to the visible Recently Updated order', async () => {
		const session = await setupHousehold()
		await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: JSON.stringify([{ displayName: 'Salt' }]),
		})
		await prisma.recipe.create({
			data: {
				title: 'Older all-Staple recipe',
				userId: session.userId,
				householdId: session.householdId,
				updatedAt: new Date('2026-08-25T08:00:00Z'),
				ingredients: { create: { name: 'salt', order: 0 } },
			},
		})
		await prisma.recipe.create({
			data: {
				title: 'Newer non-Staple recipe',
				userId: session.userId,
				householdId: session.householdId,
				updatedAt: new Date('2026-08-26T08:00:00Z'),
				ingredients: { create: { name: 'dragon fruit', order: 0 } },
			},
		})
		const cookie = await getSessionCookieHeader(session)
		const result = await recipesLoader({
			request: new Request(`${BASE_URL}/recipes`, { headers: { cookie } }),
			...ROUTE_ARGS,
			pattern: '/recipes',
			url: new URL(`${BASE_URL}/recipes`),
		})

		expect(result.recipes.map((recipe) => recipe.title)).toEqual([
			'Newer non-Staple recipe',
			'Older all-Staple recipe',
		])
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

	test('archived Pantry stops affecting explicit Shopping after cutover', async () => {
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

		await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: '[]',
		})

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

	test('Recipe search stays intact after household Staple changes', async () => {
		const session = await setupHousehold()
		await prisma.recipe.create({
			data: {
				title: 'Target supper',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: {
					create: [
						{ name: 'salt', amount: '1', unit: 'tsp', order: 0 },
						{ name: 'olive oil', amount: '2', unit: 'tbsp', order: 1 },
						{ name: 'chicken', amount: null, unit: null, order: 2 },
						{
							name: 'medium/small peaches',
							amount: null,
							unit: null,
							order: 3,
						},
					],
				},
			},
		})
		await prisma.recipe.create({
			data: {
				title: 'Other dinner',
				userId: session.userId,
				householdId: session.householdId,
			},
		})
		await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: JSON.stringify([
				{ displayName: 'salt' },
				{ displayName: 'olive oil' },
			]),
		})
		const oliveOil = (await loadInventory(session)).staples.find(
			(staple) => staple.canonicalKey === 'olive oil',
		)!
		await postInventory(session, {
			intent: 'toggle-staple-out',
			itemId: oliveOil.id,
		})
		const cookie = await getSessionCookieHeader(session)
		const result = await recipesLoader({
			request: new Request(`${BASE_URL}/recipes?search=Target`, {
				headers: { cookie },
			}),
			...ROUTE_ARGS,
			pattern: '/recipes',
			url: new URL(`${BASE_URL}/recipes`),
		})

		expect(result.recipes.map((recipe) => recipe.title)).toEqual([
			'Target supper',
		])
	})
})

describe('active household Staples', () => {
	test('a cut-over household can add a normalized Staple', async () => {
		const session = await setupHousehold()
		await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: '[]',
		})

		const result = await postInventory(session, {
			intent: 'add-staple',
			displayName: '  Smoked   salt ',
		})

		expect(result).toMatchObject({
			status: 'success',
			action: 'add-staple',
		})
		const loaded = await loadInventory(session)
		expect(loaded.staples).toEqual([
			expect.objectContaining({
				displayName: 'Smoked salt',
				canonicalKey: 'smoked salt',
				isStaple: true,
				isOut: false,
			}),
		])
	})

	test('a household can toggle a Staple Out and back', async () => {
		const session = await setupHousehold()
		await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: JSON.stringify([{ displayName: 'Salt' }]),
		})
		const staple = (await loadInventory(session)).staples[0]!

		await postInventory(session, {
			intent: 'toggle-staple-out',
			itemId: staple.id,
		})
		expect((await loadInventory(session)).staples[0]!.isOut).toBe(true)

		await postInventory(session, {
			intent: 'toggle-staple-out',
			itemId: staple.id,
		})
		expect((await loadInventory(session)).staples[0]!.isOut).toBe(false)
	})

	test('removing a Staple hides it without deleting its durable identity', async () => {
		const session = await setupHousehold()
		await postInventory(session, {
			intent: 'confirm-staples-cutover',
			items: JSON.stringify([{ displayName: 'Salt' }]),
		})
		const staple = (await loadInventory(session)).staples[0]!
		await postInventory(session, {
			intent: 'toggle-staple-out',
			itemId: staple.id,
		})

		await postInventory(session, {
			intent: 'remove-staple',
			itemId: staple.id,
		})

		expect((await loadInventory(session)).staples).toEqual([])
		expect(
			await prisma.householdIngredient.findUniqueOrThrow({
				where: { id: staple.id },
				select: { isStaple: true, isOut: true },
			}),
		).toEqual({ isStaple: false, isOut: false })
	})

	test('a household cannot change another household’s Staple', async () => {
		const owner = await setupHousehold()
		const other = await setupHousehold()
		await postInventory(owner, {
			intent: 'confirm-staples-cutover',
			items: JSON.stringify([{ displayName: 'Salt' }]),
		})
		await postInventory(other, {
			intent: 'confirm-staples-cutover',
			items: JSON.stringify([{ displayName: 'Rice' }]),
		})
		const foreignStaple = (await loadInventory(other)).staples[0]!

		await expect(
			postInventory(owner, {
				intent: 'toggle-staple-out',
				itemId: foreignStaple.id,
			}),
		).rejects.toMatchObject({ status: 404 })
		expect((await loadInventory(other)).staples[0]!.isOut).toBe(false)
	})
})
