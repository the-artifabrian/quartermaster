import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { demandIdentity } from '#app/utils/shopping-demand.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader as exportLoader } from '../../resources/export-all-data.tsx'
import { loader as recipeExportLoader } from '../../resources/export-recipes.tsx'
import { loader as shoppingLoader } from '../../shopping.tsx'
import { action } from './import.tsx'

const ACTION_ARGS_BASE = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/settings/profile/import',
	url: new URL(`${BASE_URL}/settings/profile/import`),
}

async function setupUser({ tier = 'pro' as string | null } = {}) {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: {
					create: {
						...createUser(),
						...(tier ? { subscription: { create: { tier } } } : {}),
					},
				},
			},
			select: { id: true, userId: true },
		})
		const household = await tx.household.create({
			data: {
				name: 'Import Household',
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		await tx.shoppingList.create({
			data: {
				userId: session.userId,
				householdId: household.id,
				items: {
					create: {
						name: 'Apples',
						quantity: '2',
						category: 'produce',
						source: 'manual',
					},
				},
			},
		})
		return { ...session, householdId: household.id }
	})
}

async function makeImportRequest(session: { id: string }) {
	const cookie = await getSessionCookieHeader(session)
	return new Request(`${BASE_URL}/settings/profile/import`, {
		method: 'POST',
		headers: {
			cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			importData: JSON.stringify({
				format: 'quartermaster-full-export-v1',
				recipes: [],
				shoppingLists: [
					{
						name: 'Shopping List',
						items: [
							{
								name: 'Apples',
								quantity: '2',
								category: 'produce',
								checked: false,
								source: 'manual',
							},
							{
								name: 'Bananas',
								quantity: '6',
								category: 'produce',
								checked: false,
								source: 'manual',
							},
						],
					},
				],
			}),
		}).toString(),
	})
}

test('re-importing a shopping list skips items already in the household list', async () => {
	const session = await setupUser()

	const firstResult = await action({
		request: await makeImportRequest(session),
		...ACTION_ARGS_BASE,
	})
	expect(firstResult).toEqual(
		expect.objectContaining({
			results: expect.objectContaining({
				shoppingLists: { created: 1, skipped: 1 },
			}),
		}),
	)

	const secondResult = await action({
		request: await makeImportRequest(session),
		...ACTION_ARGS_BASE,
	})
	expect(secondResult).toEqual(
		expect.objectContaining({
			results: expect.objectContaining({
				shoppingLists: { created: 0, skipped: 2 },
			}),
		}),
	)

	const shoppingList = await shoppingLoader({
		request: new Request(`${BASE_URL}/shopping`, {
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
		...ACTION_ARGS_BASE,
	})
	expect(
		shoppingList.shoppingList.items.map((item) => item.name).sort(),
	).toEqual(['Apples', 'Bananas'])
})

describe('Recipe classification recovery', () => {
	test('full recovery preserves assigned and unassigned household values with target identity winning', async () => {
		const source = await setupUser()
		const [levantine, winter, snack] = await Promise.all([
			prisma.recipeMetadataValue.create({
				data: {
					householdId: source.householdId,
					dimension: 'cuisine',
					name: 'Levantine',
					nameKey: 'levantine',
				},
			}),
			prisma.recipeMetadataValue.create({
				data: {
					householdId: source.householdId,
					dimension: 'season',
					name: 'Winter',
					nameKey: 'winter',
					sortOrder: 40,
				},
			}),
			prisma.recipeMetadataValue.create({
				data: {
					householdId: source.householdId,
					dimension: 'course',
					name: 'Snack',
					nameKey: 'snack',
				},
			}),
		])
		await prisma.recipe.create({
			data: {
				title: 'Winter mezze',
				userId: source.userId,
				householdId: source.householdId,
				metadataAssignments: {
					create: [{ valueId: levantine.id }, { valueId: winter.id }],
				},
				ingredients: { create: { name: 'chickpeas', order: 0 } },
				instructions: { create: { content: 'Mix.', order: 0 } },
			},
		})

		const exported = await exportHousehold(source)
		expect(exported.recipeMetadataValues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nameKey: 'levantine' }),
				expect.objectContaining({ nameKey: 'winter' }),
				expect.objectContaining({ nameKey: 'snack' }),
			]),
		)
		expect(exported.recipes[0].metadataValues).toHaveLength(2)

		const target = await setupUser()
		const targetLevantine = await prisma.recipeMetadataValue.create({
			data: {
				householdId: target.householdId,
				dimension: 'cuisine',
				name: 'LEVANTINE',
				nameKey: 'levantine',
			},
		})
		await importPayload(target, exported)

		const restored = await prisma.recipe.findFirstOrThrow({
			where: { householdId: target.householdId, title: 'Winter mezze' },
			select: {
				metadataAssignments: {
					select: {
						valueId: true,
						value: { select: { name: true, nameKey: true } },
					},
				},
			},
		})
		expect(restored.metadataAssignments).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					valueId: targetLevantine.id,
					value: { name: 'LEVANTINE', nameKey: 'levantine' },
				}),
				expect.objectContaining({
					value: { name: 'Winter', nameKey: 'winter' },
				}),
			]),
		)
		expect(
			await prisma.recipeMetadataValue.findFirst({
				where: { householdId: target.householdId, nameKey: snack.nameKey },
			}),
		).not.toBeNull()
		expect(
			await prisma.recipeMetadataValue.count({
				where: { householdId: target.householdId, nameKey: 'levantine' },
			}),
		).toBe(1)
	})

	test('Recipe-only recovery recreates the assigned vocabulary', async () => {
		const source = await setupUser()
		const romanian = await prisma.recipeMetadataValue.create({
			data: {
				householdId: source.householdId,
				dimension: 'cuisine',
				name: 'Romanian',
				nameKey: 'romanian',
			},
		})
		await prisma.recipe.create({
			data: {
				title: 'Bean stew',
				userId: source.userId,
				householdId: source.householdId,
				metadataAssignments: { create: { valueId: romanian.id } },
				ingredients: { create: { name: 'beans', order: 0 } },
				instructions: { create: { content: 'Simmer.', order: 0 } },
			},
		})

		const exported = await exportRecipes(source)
		const target = await setupUser()
		await importPayload(target, exported)
		const restored = await prisma.recipe.findFirstOrThrow({
			where: { householdId: target.householdId, title: 'Bean stew' },
			select: {
				metadataAssignments: {
					select: { value: { select: { dimension: true, name: true } } },
				},
			},
		})
		expect(restored.metadataAssignments).toEqual([
			{ value: { dimension: 'cuisine', name: 'Romanian' } },
		])
	})
})

// --- Menu recovery (#102) ---

async function importPayload(session: { id: string }, payload: unknown) {
	const cookie = await getSessionCookieHeader(session)
	const request = new Request(`${BASE_URL}/settings/profile/import`, {
		method: 'POST',
		headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			importData: JSON.stringify(payload),
		}).toString(),
	})
	return action({ request, ...ACTION_ARGS_BASE })
}

async function exportHousehold(session: { id: string }) {
	const cookie = await getSessionCookieHeader(session)
	const response = await exportLoader({
		request: new Request(`${BASE_URL}/resources/export-all-data`, {
			headers: { cookie },
		}),
		...ACTION_ARGS_BASE,
	})
	return JSON.parse(await response.text()) as Record<string, any>
}

async function exportRecipes(session: { id: string }) {
	const cookie = await getSessionCookieHeader(session)
	const response = await recipeExportLoader({
		request: new Request(`${BASE_URL}/resources/export-recipes`, {
			headers: { cookie },
		}),
		...ACTION_ARGS_BASE,
	})
	return JSON.parse(await response.text()) as Record<string, any>
}

describe('Recipe time and typed yield recovery', () => {
	test('full export and import preserve explicit Recipe metadata', async () => {
		const source = await setupUser()
		await prisma.recipe.create({
			data: {
				title: 'Celebration loaf',
				activeTime: 25,
				totalTime: 180,
				yieldAmount: 2.5,
				yieldLabel: 'large braided loaves for a celebration table',
				userId: source.userId,
				householdId: source.householdId,
				ingredients: { create: { name: 'flour', order: 0 } },
				instructions: {
					create: { content: 'Knead the dough.', order: 0 },
				},
			},
		})

		const exported = await exportHousehold(source)
		expect(exported.recipes).toContainEqual(
			expect.objectContaining({
				title: 'Celebration loaf',
				activeTime: 25,
				totalTime: 180,
				yieldAmount: 2.5,
				yieldLabel: 'large braided loaves for a celebration table',
			}),
		)

		const target = await setupUser()
		await importPayload(target, exported)
		const recovered = await exportHousehold(target)
		expect(recovered.recipes).toContainEqual(
			expect.objectContaining({
				title: 'Celebration loaf',
				activeTime: 25,
				totalTime: 180,
				yieldAmount: 2.5,
				yieldLabel: 'large braided loaves for a celebration table',
			}),
		)
	})

	test('older exports ignore legacy servings and conservatively recover Total only', async () => {
		const target = await setupUser()
		await importPayload(target, {
			format: 'quartermaster-full-export-v1',
			recipes: [
				{
					title: 'Legacy four servings',
					servings: 4,
					prepTime: 10,
					cookTime: 20,
					ingredients: [{ name: 'onion' }],
					instructions: ['Cook the onion.'],
				},
			],
		})

		const recovered = await exportHousehold(target)
		const recipe = recovered.recipes.find(
			(item: { title: string }) => item.title === 'Legacy four servings',
		)
		expect(recipe).toEqual(
			expect.objectContaining({
				activeTime: null,
				totalTime: 30,
				yieldAmount: null,
				yieldLabel: null,
			}),
		)
		expect(recipe).not.toHaveProperty('servings')
		expect(recipe).not.toHaveProperty('prepTime')
		expect(recipe).not.toHaveProperty('cookTime')
	})

	test('Recipe-only export and import preserve explicit metadata', async () => {
		const source = await setupUser()
		await prisma.recipe.create({
			data: {
				title: 'Small jar batch',
				activeTime: 15,
				totalTime: 75,
				yieldAmount: 3.5,
				yieldLabel: 'small jars',
				userId: source.userId,
				householdId: source.householdId,
				ingredients: { create: { name: 'tomatoes', order: 0 } },
				instructions: { create: { content: 'Simmer.', order: 0 } },
			},
		})

		const exported = await exportRecipes(source)
		expect(exported.recipes).toContainEqual(
			expect.objectContaining({
				title: 'Small jar batch',
				activeTime: 15,
				totalTime: 75,
				yieldAmount: 3.5,
				yieldLabel: 'small jars',
			}),
		)

		const target = await setupUser()
		await importPayload(target, exported)
		const recovered = await exportHousehold(target)
		expect(recovered.recipes).toContainEqual(
			expect.objectContaining({
				title: 'Small jar batch',
				activeTime: 15,
				totalTime: 75,
				yieldAmount: 3.5,
				yieldLabel: 'small jars',
			}),
		)
	})
})

describe('household Staples recovery', () => {
	test('full export and import preserve canonical rows, cutover state, and archived Pantry independently', async () => {
		const source = await setupUser()
		const cutoverAt = new Date('2026-08-25T10:30:00.000Z')
		await prisma.household.update({
			where: { id: source.householdId },
			data: { staplesCutoverAt: cutoverAt },
		})
		await prisma.householdIngredient.createMany({
			data: [
				{
					displayName: 'Salt',
					canonicalKey: 'salt',
					isStaple: true,
					isOut: false,
					householdId: source.householdId,
				},
				{
					displayName: 'Olive oil',
					canonicalKey: 'olive oil',
					isStaple: true,
					isOut: true,
					householdId: source.householdId,
				},
				{
					displayName: 'Lemons',
					canonicalKey: 'lemons',
					isStaple: false,
					isOut: false,
					householdId: source.householdId,
				},
			],
		})
		await prisma.inventoryItem.create({
			data: {
				name: 'Archived garlic',
				userId: source.userId,
				householdId: source.householdId,
			},
		})

		const exported = await exportHousehold(source)
		expect(exported.household).toEqual({
			staplesCutoverAt: cutoverAt.toISOString(),
		})
		expect(exported.householdIngredients).toEqual([
			{
				displayName: 'Lemons',
				canonicalKey: 'lemons',
				isStaple: false,
				isOut: false,
			},
			{
				displayName: 'Olive oil',
				canonicalKey: 'olive oil',
				isStaple: true,
				isOut: true,
			},
			{
				displayName: 'Salt',
				canonicalKey: 'salt',
				isStaple: true,
				isOut: false,
			},
		])
		expect(exported.inventory).toContainEqual({ name: 'Archived garlic' })

		const target = await setupUser()
		const result = (await importPayload(target, exported)) as any
		expect(result.results.householdIngredients).toEqual({
			created: 3,
			skipped: 0,
		})
		expect(
			await prisma.household.findUniqueOrThrow({
				where: { id: target.householdId },
				select: { staplesCutoverAt: true },
			}),
		).toEqual({ staplesCutoverAt: cutoverAt })
		expect(
			await prisma.householdIngredient.findMany({
				where: { householdId: target.householdId },
				orderBy: { canonicalKey: 'asc' },
				select: {
					displayName: true,
					canonicalKey: true,
					isStaple: true,
					isOut: true,
				},
			}),
		).toEqual(exported.householdIngredients)
		expect(
			await prisma.inventoryItem.findFirst({
				where: {
					householdId: target.householdId,
					name: 'archived garlic',
				},
				select: { name: true },
			}),
		).toEqual({ name: 'archived garlic' })
		expect(
			await prisma.household.findUniqueOrThrow({
				where: { id: source.householdId },
				select: {
					staplesCutoverAt: true,
					householdIngredients: {
						orderBy: { canonicalKey: 'asc' },
						select: {
							displayName: true,
							canonicalKey: true,
							isStaple: true,
							isOut: true,
						},
					},
				},
			}),
		).toEqual({
			staplesCutoverAt: cutoverAt,
			householdIngredients: exported.householdIngredients,
		})
	})

	test('target and first-imported canonical identities win collisions without changing the source household', async () => {
		const source = await setupUser()
		const sourceCutoverAt = new Date('2026-08-25T12:00:00.000Z')
		await prisma.household.update({
			where: { id: source.householdId },
			data: { staplesCutoverAt: sourceCutoverAt },
		})
		await prisma.householdIngredient.createMany({
			data: [
				{
					displayName: 'Cumin',
					canonicalKey: 'cumin',
					isStaple: true,
					isOut: true,
					householdId: source.householdId,
				},
				{
					displayName: 'Salt',
					canonicalKey: 'salt',
					isStaple: true,
					isOut: true,
					householdId: source.householdId,
				},
			],
		})

		const target = await setupUser()
		const targetCutoverAt = new Date('2026-08-24T12:00:00.000Z')
		await prisma.household.update({
			where: { id: target.householdId },
			data: { staplesCutoverAt: targetCutoverAt },
		})
		await prisma.householdIngredient.create({
			data: {
				displayName: 'Salt',
				canonicalKey: 'salt',
				isStaple: true,
				isOut: false,
				householdId: target.householdId,
			},
		})

		const exported = await exportHousehold(source)
		exported.householdIngredients.push({
			displayName: 'cumin',
			canonicalKey: 'cumin',
			isStaple: false,
			isOut: false,
		})
		const result = (await importPayload(target, exported)) as any

		expect(result.results.householdIngredients).toEqual({
			created: 1,
			skipped: 2,
		})
		expect(result.results.staplesCutoverRestored).toBe(false)
		expect(
			await prisma.household.findMany({
				where: { id: { in: [source.householdId, target.householdId] } },
				orderBy: { id: 'asc' },
				select: {
					id: true,
					staplesCutoverAt: true,
					householdIngredients: {
						orderBy: { canonicalKey: 'asc' },
						select: {
							displayName: true,
							canonicalKey: true,
							isStaple: true,
							isOut: true,
						},
					},
				},
			}),
		).toEqual(
			[
				{
					id: source.householdId,
					staplesCutoverAt: sourceCutoverAt,
					householdIngredients: [
						{
							displayName: 'Cumin',
							canonicalKey: 'cumin',
							isStaple: true,
							isOut: true,
						},
						{
							displayName: 'Salt',
							canonicalKey: 'salt',
							isStaple: true,
							isOut: true,
						},
					],
				},
				{
					id: target.householdId,
					staplesCutoverAt: targetCutoverAt,
					householdIngredients: [
						{
							displayName: 'Cumin',
							canonicalKey: 'cumin',
							isStaple: true,
							isOut: true,
						},
						{
							displayName: 'Salt',
							canonicalKey: 'salt',
							isStaple: true,
							isOut: false,
						},
					],
				},
			].sort((a, b) => a.id.localeCompare(b.id)),
		)
	})

	test('a confirmed empty Staples selection round-trips independently of canonical rows', async () => {
		const source = await setupUser()
		const cutoverAt = new Date('2026-08-25T12:30:00.000Z')
		await prisma.household.update({
			where: { id: source.householdId },
			data: { staplesCutoverAt: cutoverAt },
		})
		const exported = await exportHousehold(source)
		expect(exported.householdIngredients).toEqual([])

		const target = await setupUser()
		await importPayload(target, exported)

		expect(
			await prisma.household.findUniqueOrThrow({
				where: { id: target.householdId },
				select: {
					staplesCutoverAt: true,
					_count: { select: { householdIngredients: true } },
				},
			}),
		).toEqual({
			staplesCutoverAt: cutoverAt,
			_count: { householdIngredients: 0 },
		})
	})

	test('older full exports without Staples still restore archived Inventory', async () => {
		const target = await setupUser()
		await importPayload(target, {
			format: 'quartermaster-full-export-v1',
			recipes: [],
			inventory: [{ name: 'Legacy Vanilla Beans', location: 'pantry' }],
		})

		expect(
			await prisma.household.findUniqueOrThrow({
				where: { id: target.householdId },
				select: {
					staplesCutoverAt: true,
					householdIngredients: true,
					inventoryItems: {
						where: { name: 'legacy vanilla beans' },
						select: { name: true },
					},
				},
			}),
		).toEqual({
			staplesCutoverAt: null,
			householdIngredients: [],
			inventoryItems: [{ name: 'legacy vanilla beans' }],
		})
	})

	test('imports reject Out state for a non-Staple without partial canonical recovery', async () => {
		const target = await setupUser()
		const response = await importPayload(target, {
			format: 'quartermaster-full-export-v1',
			recipes: [],
			household: { staplesCutoverAt: '2026-08-25T13:00:00.000Z' },
			householdIngredients: [
				{
					displayName: 'Salt',
					canonicalKey: 'salt',
					isStaple: false,
					isOut: true,
				},
			],
		})

		expect(response).toEqual(
			expect.objectContaining({
				data: expect.objectContaining({
					error: expect.stringContaining('Only a Staple can be Out'),
					results: null,
				}),
				init: { status: 400 },
			}),
		)
		expect(
			await prisma.household.findUniqueOrThrow({
				where: { id: target.householdId },
				select: {
					staplesCutoverAt: true,
					_count: { select: { householdIngredients: true } },
				},
			}),
		).toEqual({
			staplesCutoverAt: null,
			_count: { householdIngredients: 0 },
		})
	})

	test('free households restore Staples without opening Pro-only legacy import sections', async () => {
		const target = await setupUser({ tier: null })
		const cutoverAt = '2026-08-25T11:00:00.000Z'
		const result = (await importPayload(target, {
			format: 'quartermaster-full-export-v1',
			recipes: [],
			household: { staplesCutoverAt: cutoverAt },
			householdIngredients: [
				{
					displayName: 'Salt',
					canonicalKey: 'salt',
					isStaple: true,
					isOut: false,
				},
			],
			inventory: [{ name: 'Pro-only archived garlic' }],
		})) as any

		expect(result.results.householdIngredients).toEqual({
			created: 1,
			skipped: 0,
		})
		expect(result.results.staplesCutoverRestored).toBe(true)
		expect(
			await prisma.household.findUniqueOrThrow({
				where: { id: target.householdId },
				select: { staplesCutoverAt: true },
			}),
		).toEqual({ staplesCutoverAt: new Date(cutoverAt) })
		expect(
			await prisma.householdIngredient.findFirstOrThrow({
				where: { householdId: target.householdId },
				select: { canonicalKey: true, isStaple: true, isOut: true },
			}),
		).toEqual({ canonicalKey: 'salt', isStaple: true, isOut: false })
		expect(
			await prisma.inventoryItem.count({
				where: { householdId: target.householdId },
			}),
		).toBe(0)
	})
})

/** Two recipes plus the menu shapes #102 must round-trip: sections, recipe
 * cards with multipliers and notes, a note card with ordered Shopping lines,
 * and a missing card with only its frozen title. */
async function seedMenuFixture(session: {
	userId: string
	householdId: string
}) {
	const hummus = await prisma.recipe.create({
		data: {
			title: 'Hummus',
			userId: session.userId,
			householdId: session.householdId,
		},
	})
	const pita = await prisma.recipe.create({
		data: {
			title: 'Pita',
			userId: session.userId,
			householdId: session.householdId,
		},
	})
	const menu = await prisma.menu.create({
		data: {
			title: 'Feast',
			titleKey: 'feast',
			description: 'Terrace dinner',
			defaultGuestCount: 6,
			householdId: session.householdId,
			sections: {
				create: [
					{
						name: null,
						order: 0,
						items: {
							create: [
								{
									kind: 'recipe',
									order: 0,
									recipeId: hummus.id,
									recipeTitle: 'Hummus',
									scaleMultiplier: 1.5,
									note: 'serve at room temperature',
								},
								{
									kind: 'note',
									order: 1,
									note: 'Drinks: lemonade with mint',
									shoppingLines: {
										create: [
											{ name: 'lemons', quantity: '6', order: 0 },
											{
												name: 'mint',
												quantity: '2',
												unit: 'bunches',
												order: 1,
											},
										],
									},
								},
							],
						},
					},
					{
						name: 'Dessert',
						order: 1,
						items: {
							create: [
								{
									kind: 'recipe',
									order: 0,
									recipeId: pita.id,
									recipeTitle: 'Pita',
									scaleMultiplier: 4,
								},
								{
									kind: 'recipe',
									order: 1,
									recipeId: null,
									recipeTitle: 'Gone Cake',
									scaleMultiplier: 1,
								},
							],
						},
					},
				],
			},
		},
	})
	return { hummus, pita, menu }
}

function loadMenus(householdId: string) {
	return prisma.menu.findMany({
		where: { householdId },
		orderBy: { titleKey: 'asc' },
		include: {
			sections: {
				orderBy: { order: 'asc' },
				include: {
					items: {
						orderBy: { order: 'asc' },
						include: { shoppingLines: { orderBy: { order: 'asc' } } },
					},
				},
			},
		},
	})
}

describe('menu export', () => {
	test('full export carries menus with reference keys, ordering, notes, and lines — no internal ids', async () => {
		const session = await setupUser()
		await seedMenuFixture(session)

		const exported = await exportHousehold(session)

		// Recipes are keyed for reference restore (export-local, not DB ids)
		expect(exported.recipes.map((r: any) => [r.ref, r.title])).toEqual([
			['r1', 'Hummus'],
			['r2', 'Pita'],
		])

		expect(exported.menus).toHaveLength(1)
		const menu = exported.menus[0]
		expect(menu).toMatchObject({
			title: 'Feast',
			description: 'Terrace dinner',
			defaultGuestCount: 6,
		})
		expect(menu.sections.map((s: any) => s.name)).toEqual([null, 'Dessert'])
		expect(menu.sections[0].items).toEqual([
			{
				kind: 'recipe',
				recipeRef: 'r1',
				recipeTitle: 'Hummus',
				scaleMultiplier: 1.5,
				note: 'serve at room temperature',
			},
			{
				kind: 'note',
				text: 'Drinks: lemonade with mint',
				shoppingLines: [
					{ name: 'lemons', quantity: '6', unit: null },
					{ name: 'mint', quantity: '2', unit: 'bunches' },
				],
			},
		])
		// The missing card keeps its frozen title and exports no reference
		expect(menu.sections[1].items[1]).toEqual({
			kind: 'recipe',
			recipeRef: null,
			recipeTitle: 'Gone Cake',
			scaleMultiplier: 1,
			note: null,
		})
		// Internal identifiers never leak into the export
		expect(JSON.stringify(exported.menus)).not.toContain('"id"')
	})
})

describe('menu import', () => {
	test('a full export restores menus into a fresh household with references, ordering, notes, and lines', async () => {
		const source = await setupUser()
		const { hummus } = await seedMenuFixture(source)
		const exported = await exportHousehold(source)

		const target = await setupUser()
		const result = (await importPayload(target, exported)) as any
		expect(result.results.recipes.created).toBe(2)
		expect(result.results.menus).toEqual({
			created: 1,
			skipped: 0,
			errored: 0,
		})

		const [menu] = await loadMenus(target.householdId)
		expect(menu).toMatchObject({
			title: 'Feast',
			titleKey: 'feast',
			description: 'Terrace dinner',
			defaultGuestCount: 6,
		})
		expect(menu!.sections.map((s) => s.name)).toEqual([null, 'Dessert'])

		const [hummusCard, noteCard] = menu!.sections[0]!.items
		// The reference reconnects to the household's own restored Recipe
		const targetHummus = await prisma.recipe.findFirstOrThrow({
			where: { householdId: target.householdId, title: 'Hummus' },
		})
		expect(targetHummus.id).not.toBe(hummus.id)
		expect(hummusCard).toMatchObject({
			kind: 'recipe',
			recipeId: targetHummus.id,
			recipeTitle: 'Hummus',
			scaleMultiplier: 1.5,
			note: 'serve at room temperature',
		})
		expect(noteCard).toMatchObject({
			kind: 'note',
			note: 'Drinks: lemonade with mint',
		})
		expect(
			noteCard!.shoppingLines.map((l) => [l.name, l.quantity, l.unit, l.order]),
		).toEqual([
			['lemons', '6', null, 0],
			['mint', '2', 'bunches', 1],
		])
		// The missing card stays honestly missing — frozen title, no reference
		expect(menu!.sections[1]!.items[1]).toMatchObject({
			kind: 'recipe',
			recipeId: null,
			recipeTitle: 'Gone Cake',
		})
	})

	test('reference keys win over titles; the title fallback applies only when a key is absent', async () => {
		const session = await setupUser()

		const result = (await importPayload(session, {
			format: 'quartermaster-full-export-v1',
			recipes: [
				{ ref: 'a', title: 'Alpha', ingredients: [], instructions: [] },
				{ ref: 'b', title: 'Beta', ingredients: [], instructions: [] },
			],
			menus: [
				{
					title: 'Mixed',
					sections: [
						{
							name: null,
							items: [
								// The key says Beta even though the title says Alpha
								{ kind: 'recipe', recipeRef: 'b', recipeTitle: 'Alpha' },
								// No key (older data): normalized title fallback
								{ kind: 'recipe', recipeTitle: 'alpha' },
								// A key that resolves nowhere never falls back to title
								{ kind: 'recipe', recipeRef: 'zzz', recipeTitle: 'Alpha' },
							],
						},
					],
				},
			],
		})) as any
		expect(result.results.menus.created).toBe(1)

		const alpha = await prisma.recipe.findFirstOrThrow({
			where: { householdId: session.householdId, title: 'Alpha' },
		})
		const beta = await prisma.recipe.findFirstOrThrow({
			where: { householdId: session.householdId, title: 'Beta' },
		})
		const [menu] = await loadMenus(session.householdId)
		const items = menu!.sections[0]!.items
		expect(items.map((i) => i.recipeId)).toEqual([beta.id, alpha.id, null])
		// Default multiplier and frozen titles hold even for unresolved cards
		expect(items.map((i) => i.recipeTitle)).toEqual(['Alpha', 'alpha', 'Alpha'])
		expect(items.map((i) => i.scaleMultiplier)).toEqual([1, 1, 1])
	})

	test('an existing menu wins its normalized title wholesale, and within one import the first occurrence wins', async () => {
		const session = await setupUser()
		const existing = await prisma.menu.create({
			data: {
				title: 'Dinner Party',
				titleKey: 'dinner party',
				householdId: session.householdId,
				sections: {
					create: {
						name: null,
						order: 0,
						items: {
							create: {
								kind: 'note',
								order: 0,
								note: 'the original note',
							},
						},
					},
				},
			},
		})

		const result = (await importPayload(session, {
			format: 'quartermaster-full-export-v1',
			recipes: [],
			menus: [
				{
					title: 'DINNER PARTY',
					sections: [
						{
							name: 'Imported Section',
							items: [{ kind: 'note', text: 'an imported note' }],
						},
					],
				},
				{ title: 'Soirée' },
				{ title: 'soirée' },
			],
		})) as any
		expect(result.results.menus).toEqual({
			created: 1,
			skipped: 2,
			errored: 0,
		})

		// Nothing merged into the existing menu — it won wholesale
		const menus = await loadMenus(session.householdId)
		expect(menus.map((m) => m.title)).toEqual(['Dinner Party', 'Soirée'])
		const kept = menus.find((m) => m.id === existing.id)!
		expect(kept.sections).toHaveLength(1)
		expect(kept.sections[0]!.items.map((i) => i.note)).toEqual([
			'the original note',
		])
		// An imported menu without sections still gets its durable unnamed one
		const soiree = menus.find((m) => m.title === 'Soirée')!
		expect(soiree.sections.map((s) => s.name)).toEqual([null])
	})

	test('pre-menu exports still import, reporting no menu activity', async () => {
		const session = await setupUser()
		const result = (await importPayload(session, {
			format: 'quartermaster-full-export-v1',
			recipes: [{ title: 'Old Recipe', ingredients: [], instructions: [] }],
		})) as any
		expect(result.results.recipes.created).toBe(1)
		expect(result.results.menus).toEqual({
			created: 0,
			skipped: 0,
			errored: 0,
		})
	})

	test('menus import for free users even though Pro-only sections are skipped', async () => {
		const session = await setupUser({ tier: null })
		const result = (await importPayload(session, {
			format: 'quartermaster-full-export-v1',
			recipes: [],
			menus: [
				{
					title: 'Free Menu',
					sections: [
						{ name: null, items: [{ kind: 'note', text: 'still yours' }] },
					],
				},
			],
			shoppingLists: [{ name: 'List', items: [{ name: 'apples' }] }],
		})) as any
		expect(result.results.menus.created).toBe(1)
		expect(result.results.shoppingLists).toEqual({ created: 0, skipped: 0 })
	})
})

// --- Meal parent recovery (#104) ---

/** A week plan carrying the Meal shapes #104 must round-trip: a multi-Recipe
 * dinner with multipliers, cooked state, serving instant/timezone, guest
 * count, a source Menu link with revision, a missing card, and a completed
 * text-only Meal. */
async function seedMealFixture(session: {
	userId: string
	householdId: string
}) {
	const kofta = await prisma.recipe.create({
		data: {
			title: 'Kofta',
			userId: session.userId,
			householdId: session.householdId,
		},
	})
	const salad = await prisma.recipe.create({
		data: {
			title: 'Salad',
			userId: session.userId,
			householdId: session.householdId,
		},
	})
	const menu = await prisma.menu.create({
		data: {
			title: 'Terrace Feast',
			titleKey: 'terrace feast',
			householdId: session.householdId,
			sections: { create: { name: null, order: 0 } },
		},
	})
	const plan = await prisma.mealPlan.create({
		data: {
			householdId: session.householdId,
			weekStart: new Date('2026-08-17T00:00:00.000Z'),
		},
	})
	const revision = new Date('2026-08-18T09:00:00.000Z')
	await prisma.meal.create({
		data: {
			mealPlanId: plan.id,
			date: new Date('2026-08-19T00:00:00.000Z'),
			order: 0,
			label: 'dinner',
			guestCount: 6,
			servingAt: new Date('2026-08-19T17:30:00.000Z'),
			servingTimeZone: 'Europe/Bucharest',
			sourceMenuId: menu.id,
			sourceMenuRevision: revision,
			recipeItems: {
				create: [
					{
						order: 0,
						recipeId: kofta.id,
						recipeTitle: 'Kofta',
						scaleMultiplier: 2.25,
						cooked: true,
					},
					{
						order: 1,
						recipeId: salad.id,
						recipeTitle: 'Salad',
						scaleMultiplier: 1,
					},
					{
						order: 2,
						recipeId: null,
						recipeTitle: 'Gone Cake',
						scaleMultiplier: 0.75,
					},
				],
			},
		},
	})
	await prisma.meal.create({
		data: {
			mealPlanId: plan.id,
			date: new Date('2026-08-19T00:00:00.000Z'),
			order: 1,
			genericText: 'Leftovers',
			completed: true,
		},
	})
	return { kofta, salad, menu, plan, revision }
}

describe('meal export', () => {
	test('full export carries Meal parents with items, refs, order, and serving context — no internal ids', async () => {
		const session = await setupUser()
		await seedMealFixture(session)

		const exported = await exportHousehold(session)

		expect(exported.mealPlans).toHaveLength(1)
		const meals = exported.mealPlans[0].meals
		expect(meals).toEqual([
			{
				ref: 'm1',
				date: '2026-08-19T00:00:00.000Z',
				order: 0,
				label: 'dinner',
				servingAt: '2026-08-19T17:30:00.000Z',
				servingTimeZone: 'Europe/Bucharest',
				genericText: null,
				completed: false,
				guestCount: 6,
				sourceMenuTitle: 'Terrace Feast',
				sourceMenuRevision: '2026-08-18T09:00:00.000Z',
				items: [
					{
						kind: 'recipe',
						recipeRef: 'r1',
						recipeTitle: 'Kofta',
						scaleMultiplier: 2.25,
						note: null,
						cooked: true,
					},
					{
						kind: 'recipe',
						recipeRef: 'r2',
						recipeTitle: 'Salad',
						scaleMultiplier: 1,
						note: null,
						cooked: false,
					},
					{
						kind: 'recipe',
						recipeRef: null,
						recipeTitle: 'Gone Cake',
						scaleMultiplier: 0.75,
						note: null,
						cooked: false,
					},
				],
				sections: [],
			},
			{
				ref: 'm2',
				date: '2026-08-19T00:00:00.000Z',
				order: 1,
				label: null,
				servingAt: null,
				servingTimeZone: null,
				genericText: 'Leftovers',
				completed: true,
				guestCount: null,
				sourceMenuTitle: null,
				sourceMenuRevision: null,
				items: [],
				sections: [],
			},
		])
		expect(JSON.stringify(exported.mealPlans)).not.toContain('"id"')
		// The retired fixed-slot shape left the export in #106.
		expect(exported.mealPlans[0].entries).toBeUndefined()
	})
})

describe('meal import', () => {
	test('a full export restores Meals into a fresh household with references, order, and serving context', async () => {
		const source = await setupUser()
		const { kofta, revision } = await seedMealFixture(source)
		const exported = await exportHousehold(source)

		const target = await setupUser()
		const result = (await importPayload(target, exported)) as any
		expect(result.results.meals).toEqual({ created: 2, skipped: 0 })

		const meals = await prisma.meal.findMany({
			where: { mealPlan: { householdId: target.householdId } },
			orderBy: { order: 'asc' },
			include: { recipeItems: { orderBy: { order: 'asc' } } },
		})
		expect(meals).toHaveLength(2)

		const dinner = meals[0]!
		const targetKofta = await prisma.recipe.findFirstOrThrow({
			where: { householdId: target.householdId, title: 'Kofta' },
		})
		expect(targetKofta.id).not.toBe(kofta.id)
		const targetMenu = await prisma.menu.findFirstOrThrow({
			where: { householdId: target.householdId, titleKey: 'terrace feast' },
		})
		expect(dinner).toMatchObject({
			date: new Date('2026-08-19T00:00:00.000Z'),
			order: 0,
			label: 'dinner',
			guestCount: 6,
			servingAt: new Date('2026-08-19T17:30:00.000Z'),
			servingTimeZone: 'Europe/Bucharest',
			genericText: null,
			completed: false,
			sourceMenuId: targetMenu.id,
			sourceMenuRevision: revision,
		})
		expect(
			dinner.recipeItems.map((item) => [
				item.order,
				item.recipeId,
				item.recipeTitle,
				item.scaleMultiplier,
				item.cooked,
			]),
		).toEqual([
			[0, targetKofta.id, 'Kofta', 2.25, true],
			[1, expect.any(String), 'Salad', 1, false],
			// The missing card stays honestly missing — frozen title, no link
			[2, null, 'Gone Cake', 0.75, false],
		])

		const leftovers = meals[1]!
		expect(leftovers).toMatchObject({
			order: 1,
			genericText: 'Leftovers',
			completed: true,
			label: null,
		})
		expect(leftovers.recipeItems).toHaveLength(0)

		// Re-importing the same file is idempotent for Meals.
		const again = (await importPayload(target, exported)) as any
		expect(again.results.meals).toEqual({ created: 0, skipped: 2 })
	})

	test('reference keys win over titles for Meal items, unknown keys stay missing, and titles work without keys', async () => {
		const session = await setupUser()
		const result = (await importPayload(session, {
			format: 'quartermaster-full-export-v1',
			recipes: [
				{ ref: 'a', title: 'Alpha', ingredients: [], instructions: [] },
				{ ref: 'b', title: 'Beta', ingredients: [], instructions: [] },
			],
			mealPlans: [
				{
					weekStart: '2026-08-17T00:00:00.000Z',
					entries: [],
					meals: [
						{
							date: '2026-08-19T00:00:00.000Z',
							order: 0,
							items: [
								{ recipeRef: 'a', recipeTitle: 'Beta' },
								{ recipeRef: 'zz', recipeTitle: 'Ghost' },
								{ recipeTitle: 'Beta' },
							],
						},
					],
				},
			],
		})) as any
		expect(result.results.meals).toEqual({ created: 1, skipped: 0 })

		const alpha = await prisma.recipe.findFirstOrThrow({
			where: { householdId: session.householdId, title: 'Alpha' },
		})
		const beta = await prisma.recipe.findFirstOrThrow({
			where: { householdId: session.householdId, title: 'Beta' },
		})
		const meal = await prisma.meal.findFirstOrThrow({
			where: { mealPlan: { householdId: session.householdId } },
			include: { recipeItems: { orderBy: { order: 'asc' } } },
		})
		expect(
			meal.recipeItems.map((item) => [item.recipeId, item.recipeTitle]),
		).toEqual([
			// The key decides the link; the file's frozen title is preserved
			[alpha.id, 'Beta'],
			// An unknown key restores as a missing card, never a title guess
			[null, 'Ghost'],
			// No key: the normalized title fallback connects
			[beta.id, 'Beta'],
		])
	})

	test('imported Meals append after existing Meals on the same day so order stays contiguous', async () => {
		const session = await setupUser()
		const plan = await prisma.mealPlan.create({
			data: {
				householdId: session.householdId,
				weekStart: new Date('2026-08-17T00:00:00.000Z'),
			},
		})
		await prisma.meal.create({
			data: {
				mealPlanId: plan.id,
				date: new Date('2026-08-19T00:00:00.000Z'),
				order: 0,
				genericText: 'Already here',
			},
		})

		const result = (await importPayload(session, {
			format: 'quartermaster-full-export-v1',
			recipes: [],
			mealPlans: [
				{
					weekStart: '2026-08-17T00:00:00.000Z',
					entries: [],
					meals: [
						{
							date: '2026-08-19T00:00:00.000Z',
							order: 0,
							genericText: 'Leftovers',
						},
					],
				},
			],
		})) as any
		expect(result.results.meals).toEqual({ created: 1, skipped: 0 })

		const meals = await prisma.meal.findMany({
			where: { mealPlanId: plan.id },
			orderBy: { order: 'asc' },
		})
		expect(meals.map((meal) => [meal.order, meal.genericText])).toEqual([
			[0, 'Already here'],
			[1, 'Leftovers'],
		])
	})

	test('a Meal carrying both generic text and Recipe items is rejected as invalid', async () => {
		const session = await setupUser()
		const result = (await importPayload(session, {
			format: 'quartermaster-full-export-v1',
			recipes: [],
			mealPlans: [
				{
					weekStart: '2026-08-17T00:00:00.000Z',
					entries: [],
					meals: [
						{
							date: '2026-08-19T00:00:00.000Z',
							genericText: 'Leftovers',
							items: [{ recipeTitle: 'Kofta' }],
						},
					],
				},
			],
		})) as any
		const body = result.data ?? result
		expect(body.error).toContain(
			'A Meal cannot carry both generic text and snapshot cards',
		)
		expect(
			await prisma.meal.count({
				where: { mealPlan: { householdId: session.householdId } },
			}),
		).toBe(0)
	})

	test('pre-Meal exports still import, reporting no Meal activity', async () => {
		const session = await setupUser()
		const result = (await importPayload(session, {
			format: 'quartermaster-full-export-v1',
			recipes: [],
			mealPlans: [
				{
					weekStart: '2026-08-17T00:00:00.000Z',
					entries: [],
				},
			],
		})) as any
		expect(result.results.meals).toEqual({ created: 0, skipped: 0 })
	})

	test('a pre-#104 export restores its fixed-slot entries as Meals under the backfill rules', async () => {
		const session = await setupUser()
		const legacyPayload = {
			format: 'quartermaster-full-export-v1',
			recipes: [
				{ title: 'Kofta', servings: 4, ingredients: [], instructions: [] },
				{ title: 'Salad', servings: 6, ingredients: [], instructions: [] },
			],
			mealPlans: [
				{
					weekStart: '2026-08-17T00:00:00.000Z',
					// No `meals` key at all — the pre-#104 shape.
					entries: [
						// Two dinner entries on one day (differing times of day)
						// collapse into one multi-Recipe Meal by UTC day.
						{
							date: '2026-08-19T12:00:00.000Z',
							mealType: 'dinner',
							recipe: 'Kofta',
							servings: 8,
							cooked: true,
						},
						{
							date: '2026-08-19T18:30:00.000Z',
							mealType: 'dinner',
							recipe: 'Salad',
						},
						{
							date: '2026-08-19T00:00:00.000Z',
							mealType: 'breakfast',
							recipe: 'Salad',
							servings: 3,
						},
						// A Recipe that no longer resolves is skipped, as the legacy
						// import path skipped it.
						{
							date: '2026-08-19T00:00:00.000Z',
							mealType: 'lunch',
							recipe: 'Ghost',
						},
					],
				},
			],
		}
		const result = (await importPayload(session, legacyPayload)) as any
		expect(result.results.meals).toEqual({ created: 2, skipped: 0 })
		expect(result.results.mealPlans).toEqual({ created: 0, skipped: 1 })

		const meals = await prisma.meal.findMany({
			where: { mealPlan: { householdId: session.householdId } },
			orderBy: { order: 'asc' },
			include: { recipeItems: { orderBy: { order: 'asc' } } },
		})
		// Slot order: breakfast before dinner, dates normalized to UTC midnight.
		expect(
			meals.map((meal) => [
				meal.order,
				meal.label,
				meal.date.toISOString(),
				meal.recipeItems.map((item) => [
					item.recipeTitle,
					item.scaleMultiplier,
					item.cooked,
				]),
			]),
		).toEqual([
			// 3 servings / 6 recipe servings = 0.5×
			[0, 'breakfast', '2026-08-19T00:00:00.000Z', [['Salad', 0.5, false]]],
			[
				1,
				'dinner',
				'2026-08-19T00:00:00.000Z',
				[
					// 8 servings / 4 recipe servings = 2×; no override = 1×
					['Kofta', 2, true],
					['Salad', 1, false],
				],
			],
		])

		// Re-importing the same legacy file is idempotent.
		const again = (await importPayload(session, legacyPayload)) as any
		expect(again.results.meals).toEqual({ created: 0, skipped: 2 })
		expect(
			await prisma.meal.count({
				where: { mealPlan: { householdId: session.householdId } },
			}),
		).toBe(2)
	})

	test('entries are ignored when the file also carries Meals — they are the dual-write mirrors', async () => {
		const session = await setupUser()
		const result = (await importPayload(session, {
			format: 'quartermaster-full-export-v1',
			recipes: [
				{ title: 'Kofta', servings: 4, ingredients: [], instructions: [] },
			],
			mealPlans: [
				{
					weekStart: '2026-08-17T00:00:00.000Z',
					entries: [
						{
							date: '2026-08-19T00:00:00.000Z',
							mealType: 'dinner',
							recipe: 'Kofta',
						},
					],
					meals: [
						{
							date: '2026-08-19T00:00:00.000Z',
							order: 0,
							label: 'dinner',
							items: [{ recipeTitle: 'Kofta', scaleMultiplier: 1 }],
						},
					],
				},
			],
		})) as any
		expect(result.results.meals).toEqual({ created: 1, skipped: 0 })
		expect(result.results.mealPlans).toEqual({ created: 0, skipped: 0 })

		const meals = await prisma.meal.findMany({
			where: { mealPlan: { householdId: session.householdId } },
			include: { recipeItems: true },
		})
		expect(meals).toHaveLength(1)
		expect(meals[0]!.recipeItems).toHaveLength(1)
	})
})

/** A planned Menu snapshot (#107): frozen sections, an item display note, a
 * note card with ordinary Shopping lines, and a missing card. */
async function seedSnapshotMealFixture(session: {
	userId: string
	householdId: string
}) {
	const hummus = await prisma.recipe.create({
		data: {
			title: 'Hummus',
			userId: session.userId,
			householdId: session.householdId,
		},
	})
	const menu = await prisma.menu.create({
		data: {
			title: 'Levantine Feast',
			titleKey: 'levantine feast',
			householdId: session.householdId,
			sections: { create: { name: null, order: 0 } },
		},
	})
	const plan = await prisma.mealPlan.create({
		data: {
			householdId: session.householdId,
			weekStart: new Date('2026-08-31T00:00:00.000Z'),
		},
	})
	const revision = new Date('2026-08-30T10:00:00.000Z')
	const meal = await prisma.meal.create({
		data: {
			mealPlanId: plan.id,
			date: new Date('2026-09-01T00:00:00.000Z'),
			order: 0,
			label: 'dinner',
			guestCount: 8,
			sourceMenuId: menu.id,
			sourceMenuRevision: revision,
		},
	})
	const [starters, mains] = await Promise.all([
		prisma.mealSection.create({
			data: { mealId: meal.id, name: null, order: 0 },
		}),
		prisma.mealSection.create({
			data: { mealId: meal.id, name: 'Mains', order: 1 },
		}),
	])
	await prisma.mealRecipeItem.createMany({
		data: [
			{
				mealId: meal.id,
				sectionId: starters.id,
				order: 0,
				recipeId: hummus.id,
				recipeTitle: 'Hummus',
				scaleMultiplier: 1,
				cooked: true,
			},
			{
				mealId: meal.id,
				sectionId: mains.id,
				order: 0,
				recipeId: null,
				recipeTitle: 'Lost Baklava',
				scaleMultiplier: 2.5,
				note: 'Two oven batches',
			},
			// A Recipe added to the snapshot Meal later — unsectioned
			{
				mealId: meal.id,
				sectionId: null,
				order: 0,
				recipeId: hummus.id,
				recipeTitle: 'Hummus Extra',
				scaleMultiplier: 0.5,
			},
		],
	})
	await prisma.mealNoteItem.create({
		data: {
			mealId: meal.id,
			sectionId: mains.id,
			order: 1,
			text: 'Drinks and candles',
			shoppingLines: {
				create: [
					{ name: 'Lemonade', quantity: '2', unit: 'l', order: 0 },
					{ name: 'Candles', order: 1 },
				],
			},
		},
	})
	return { meal, menu, revision }
}

describe('meal snapshot export/import (#107)', () => {
	test('export carries the frozen snapshot and import restores it whole, idempotently', async () => {
		const source = await setupUser()
		await seedSnapshotMealFixture(source)
		const exported = await exportHousehold(source)

		const exportedMeal = exported.mealPlans[0].meals[0]
		expect(exportedMeal.sections).toEqual([
			{
				name: null,
				items: [
					{
						kind: 'recipe',
						recipeRef: 'r1',
						recipeTitle: 'Hummus',
						scaleMultiplier: 1,
						note: null,
						cooked: true,
					},
				],
			},
			{
				name: 'Mains',
				items: [
					{
						kind: 'recipe',
						recipeRef: null,
						recipeTitle: 'Lost Baklava',
						scaleMultiplier: 2.5,
						note: 'Two oven batches',
						cooked: false,
					},
					{
						kind: 'note',
						text: 'Drinks and candles',
						shoppingLines: [
							{ name: 'Lemonade', quantity: '2', unit: 'l' },
							{ name: 'Candles', quantity: null, unit: null },
						],
					},
				],
			},
		])
		expect(exportedMeal.items).toEqual([
			{
				kind: 'recipe',
				recipeRef: 'r1',
				recipeTitle: 'Hummus Extra',
				scaleMultiplier: 0.5,
				note: null,
				cooked: false,
			},
		])
		expect(JSON.stringify(exported.mealPlans)).not.toContain('"id"')

		const target = await setupUser()
		const result = (await importPayload(target, exported)) as any
		expect(result.results.meals).toEqual({ created: 1, skipped: 0 })

		const restored = await prisma.meal.findFirstOrThrow({
			where: { mealPlan: { householdId: target.householdId } },
			include: {
				sections: { orderBy: { order: 'asc' } },
				noteItems: {
					orderBy: { order: 'asc' },
					include: { shoppingLines: { orderBy: { order: 'asc' } } },
				},
				recipeItems: { orderBy: { order: 'asc' } },
			},
		})
		const targetHummus = await prisma.recipe.findFirstOrThrow({
			where: { householdId: target.householdId, title: 'Hummus' },
		})
		const targetMenu = await prisma.menu.findFirstOrThrow({
			where: { householdId: target.householdId, titleKey: 'levantine feast' },
		})
		expect(restored).toMatchObject({
			label: 'dinner',
			guestCount: 8,
			sourceMenuId: targetMenu.id,
			sourceMenuRevision: new Date('2026-08-30T10:00:00.000Z'),
		})
		expect(restored.sections.map((s) => [s.name, s.order])).toEqual([
			[null, 0],
			['Mains', 1],
		])
		const [starters, mains] = restored.sections
		expect(
			restored.recipeItems.map((item) => [
				item.sectionId,
				item.order,
				item.recipeId,
				item.recipeTitle,
				item.scaleMultiplier,
				item.note,
				item.cooked,
			]),
		).toEqual(
			expect.arrayContaining([
				[starters!.id, 0, targetHummus.id, 'Hummus', 1, null, true],
				[mains!.id, 0, null, 'Lost Baklava', 2.5, 'Two oven batches', false],
				[null, 0, targetHummus.id, 'Hummus Extra', 0.5, null, false],
			]),
		)
		expect(restored.noteItems).toMatchObject([
			{ sectionId: mains!.id, order: 1, text: 'Drinks and candles' },
		])
		expect(restored.noteItems[0]!.shoppingLines).toMatchObject([
			{ name: 'Lemonade', quantity: '2', unit: 'l', order: 0 },
			{ name: 'Candles', quantity: null, unit: null, order: 1 },
		])

		// Idempotent: the same file again restores nothing new.
		const again = (await importPayload(target, exported)) as any
		expect(again.results.meals).toEqual({ created: 0, skipped: 1 })

		// Deep round-trip: the target's own export reproduces the Meal payload.
		const reExported = await exportHousehold(target)
		expect(reExported.mealPlans).toEqual(exported.mealPlans)
	})

	test('a note-only snapshot Meal restores without Recipe items', async () => {
		const source = await setupUser()
		const plan = await prisma.mealPlan.create({
			data: {
				householdId: source.householdId,
				weekStart: new Date('2026-08-31T00:00:00.000Z'),
			},
		})
		const meal = await prisma.meal.create({
			data: {
				mealPlanId: plan.id,
				date: new Date('2026-09-02T00:00:00.000Z'),
				order: 0,
			},
		})
		const section = await prisma.mealSection.create({
			data: { mealId: meal.id, name: 'Reminders', order: 0 },
		})
		await prisma.mealNoteItem.create({
			data: {
				mealId: meal.id,
				sectionId: section.id,
				order: 0,
				text: 'Set the table early',
			},
		})
		const exported = await exportHousehold(source)

		const target = await setupUser()
		const result = (await importPayload(target, exported)) as any
		expect(result.results.meals).toEqual({ created: 1, skipped: 0 })
		const restored = await prisma.meal.findFirstOrThrow({
			where: { mealPlan: { householdId: target.householdId } },
			include: {
				recipeItems: true,
				sections: true,
				noteItems: true,
			},
		})
		expect(restored.genericText).toBeNull()
		expect(restored.recipeItems).toHaveLength(0)
		expect(restored.sections.map((s) => s.name)).toEqual(['Reminders'])
		expect(restored.noteItems.map((n) => n.text)).toEqual([
			'Set the table early',
		])
	})
})

describe('Shopping contribution recovery (#110)', () => {
	test('round-trips Meal refs, fingerprints, orphan state, and exact checked-row identity idempotently', async () => {
		const source = await setupUser()
		const lemonIdentity = demandIdentity('lemons')
		const candleIdentity = demandIdentity('candles')
		const plan = await prisma.mealPlan.create({
			data: {
				householdId: source.householdId,
				weekStart: new Date('2026-09-07T00:00:00.000Z'),
			},
		})
		const meal = await prisma.meal.create({
			data: {
				mealPlanId: plan.id,
				date: new Date('2026-09-08T00:00:00.000Z'),
				order: 0,
				genericText: 'Contribution recovery fixture',
			},
		})
		const list = await prisma.shoppingList.findFirstOrThrow({
			where: { householdId: source.householdId },
		})
		const lemons = await prisma.shoppingListItem.create({
			data: {
				listId: list.id,
				// #109 allowed a Meal-fed row to be renamed without moving its
				// contribution. #110 recovery must preserve that legacy current state.
				name: 'Citrus basket',
				quantity: '2',
				checked: true,
				source: 'manual',
				category: 'produce',
			},
		})
		const candles = await prisma.shoppingListItem.create({
			data: {
				listId: list.id,
				name: 'candles',
				quantity: '1',
				unit: 'box',
				checked: false,
				source: 'meal',
				category: 'other',
			},
		})
		await prisma.mealShoppingContribution.createMany({
			data: [
				{
					mealId: meal.id,
					itemId: lemons.id,
					canonicalName: lemonIdentity,
					name: 'lemons',
					quantity: '6',
					unit: null,
				},
				{
					mealId: null,
					itemId: candles.id,
					canonicalName: candleIdentity,
					name: 'candles',
					quantity: '1',
					unit: 'box',
				},
				// Two deleted Meals may leave indistinguishable orphan records.
				// Both remain current displayed demand and must survive recovery.
				{
					mealId: null,
					itemId: candles.id,
					canonicalName: candleIdentity,
					name: 'candles',
					quantity: '1',
					unit: 'box',
				},
			],
		})

		const exported = await exportHousehold(source)
		expect(exported.mealPlans[0].meals[0].ref).toBe('m1')
		expect(
			exported.shoppingLists[0].items.find(
				(item: any) => item.name === 'Citrus basket',
			),
		).toMatchObject({
			checked: true,
			mealContributions: [
				{
					sourceMealRef: 'm1',
					orphaned: false,
					fingerprint: {
						canonicalName: lemonIdentity,
						name: 'lemons',
						quantity: '6',
						unit: null,
					},
				},
			],
		})
		expect(
			exported.shoppingLists[0].items.find(
				(item: any) => item.name === 'candles',
			).mealContributions,
		).toEqual([
			{
				sourceMealRef: null,
				orphaned: true,
				fingerprint: {
					canonicalName: candleIdentity,
					name: 'candles',
					quantity: '1',
					unit: 'box',
				},
			},
			{
				sourceMealRef: null,
				orphaned: true,
				fingerprint: {
					canonicalName: candleIdentity,
					name: 'candles',
					quantity: '1',
					unit: 'box',
				},
			},
		])

		const target = await setupUser()
		await importPayload(target, exported)
		const targetLemons = await prisma.shoppingListItem.findFirstOrThrow({
			where: {
				list: { householdId: target.householdId },
				name: 'Citrus basket',
			},
		})
		const restored = await prisma.mealShoppingContribution.findMany({
			where: { item: { list: { householdId: target.householdId } } },
			orderBy: { canonicalName: 'asc' },
		})
		expect(targetLemons.checked).toBe(true)
		expect(restored).toHaveLength(3)
		expect(
			restored.find((entry) => entry.canonicalName === lemonIdentity),
		).toMatchObject({
			itemId: targetLemons.id,
			mealId: expect.any(String),
			name: 'lemons',
			quantity: '6',
			unit: null,
		})
		expect(
			restored.filter((entry) => entry.canonicalName === candleIdentity),
		).toHaveLength(2)
		expect(
			restored
				.filter((entry) => entry.canonicalName === candleIdentity)
				.every((entry) => entry.mealId == null),
		).toBe(true)

		await importPayload(target, exported)
		expect(
			await prisma.mealShoppingContribution.count({
				where: { item: { list: { householdId: target.householdId } } },
			}),
		).toBe(3)
		const reExported = await exportHousehold(target)
		expect(reExported.shoppingLists).toEqual(exported.shoppingLists)
	})
})
