import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader as exportLoader } from '../../resources/export-all-data.tsx'
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
