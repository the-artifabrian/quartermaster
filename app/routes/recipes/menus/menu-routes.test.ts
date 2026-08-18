import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { menuTitleKey } from '#app/utils/menu-validation.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { loader as detailLoader } from './$menuId.tsx'
import { action as editAction, loader as editLoader } from './$menuId_.edit.tsx'
import { loader as indexLoader } from './index.tsx'
import { action as newAction } from './new.tsx'

function makeIndexArgs() {
	return {
		params: {},
		context: new RouterContextProvider(),
		pattern: '/recipes/menus',
		url: new URL(`${BASE_URL}/recipes/menus`),
	}
}

function makeNewArgs() {
	return {
		params: {},
		context: new RouterContextProvider(),
		pattern: '/recipes/menus/new',
		url: new URL(`${BASE_URL}/recipes/menus/new`),
	}
}

function makeMenuArgs(menuId: string, suffix = '') {
	return {
		params: { menuId },
		context: new RouterContextProvider(),
		pattern: `/recipes/menus/:menuId${suffix}`,
		url: new URL(`${BASE_URL}/recipes/menus/${menuId}${suffix}`),
	}
}

async function setupUser() {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: { create: createUser() },
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

async function addHouseholdMember(householdId: string) {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: { create: createUser() },
			},
			select: { id: true, userId: true },
		})
		await tx.householdMember.create({
			data: { householdId, userId: session.userId, role: 'member' },
		})
		return { ...session, householdId }
	})
}

async function makeRequest(
	session: { id: string },
	pathname: string,
	formFields?: Record<string, string>,
) {
	const cookie = await getSessionCookieHeader(session)
	if (!formFields) {
		return new Request(`${BASE_URL}${pathname}`, {
			method: 'GET',
			headers: { cookie },
		})
	}
	return new Request(`${BASE_URL}${pathname}`, {
		method: 'POST',
		headers: {
			cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams(formFields).toString(),
	})
}

async function createMenu(
	session: { id: string },
	fields: Record<string, string>,
) {
	const request = await makeRequest(session, '/recipes/menus/new', fields)
	return newAction({ request, ...makeNewArgs() })
}

function redirectLocation(response: unknown) {
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(302)
	return (response as Response).headers.get('location')
}

async function createRecipe(
	session: { userId: string },
	householdId: string,
	title: string,
) {
	return prisma.recipe.create({
		data: { title, userId: session.userId, householdId },
		select: { id: true, title: true },
	})
}

async function createMenuWithId(
	session: { id: string; householdId: string },
	title: string,
) {
	redirectLocation(await createMenu(session, { title }))
	return prisma.menu.findFirstOrThrow({
		where: { householdId: session.householdId, titleKey: menuTitleKey(title) },
		select: { id: true },
	})
}

async function saveMenu(
	session: { id: string },
	menuId: string,
	fields: Record<string, string>,
) {
	const request = await makeRequest(
		session,
		`/recipes/menus/${menuId}/edit`,
		fields,
	)
	return editAction({ request, ...makeMenuArgs(menuId, '/edit') })
}

function menuItems(menuId: string) {
	return prisma.menuItem.findMany({
		where: { section: { menuId } },
		orderBy: [{ section: { order: 'asc' } }, { order: 'asc' }],
	})
}

function menuSections(menuId: string) {
	return prisma.menuSection.findMany({
		where: { menuId },
		orderBy: { order: 'asc' },
		include: { items: { orderBy: { order: 'asc' } } },
	})
}

function unnamedSection(menuId: string) {
	return prisma.menuSection.findFirstOrThrow({
		where: { menuId, name: null },
		select: { id: true },
	})
}

/** Flattens per-section item fields into the form-encoded submission shape. */
function sectionFields(
	index: number,
	section: { id?: string; name?: string },
	items: Array<Record<string, string>> = [],
) {
	const fields: Record<string, string> = {}
	if (section.id != null) fields[`sections[${index}].id`] = section.id
	if (section.name != null) fields[`sections[${index}].name`] = section.name
	items.forEach((item, itemIndex) => {
		for (const [key, value] of Object.entries(item)) {
			fields[`sections[${index}].items[${itemIndex}].${key}`] = value
		}
	})
	return fields
}

/** The common single-section case: items submitted under the unnamed section. */
async function unnamedItemsFields(
	menuId: string,
	items: Array<Record<string, string>>,
) {
	const section = await unnamedSection(menuId)
	return sectionFields(0, { id: section.id }, items)
}

describe('menu create', () => {
	test('creates a menu with a normalized title key and one durable unnamed section', async () => {
		const session = await setupUser()

		const response = await createMenu(session, {
			title: '  Levantine Terrace Dinner ',
			description: 'Hosted dinner on the terrace',
			defaultGuestCount: '6',
		})
		const location = redirectLocation(response)
		expect(location).toMatch(/^\/recipes\/menus\/.+$/)

		const menu = await prisma.menu.findFirstOrThrow({
			where: { householdId: session.householdId },
			include: { sections: true },
		})
		expect(location).toBe(`/recipes/menus/${menu.id}`)
		expect(menu.title).toBe('Levantine Terrace Dinner')
		expect(menu.titleKey).toBe('levantine terrace dinner')
		expect(menu.description).toBe('Hosted dinner on the terrace')
		expect(menu.defaultGuestCount).toBe(6)
		expect(menu.sections).toHaveLength(1)
		expect(menu.sections[0]!.name).toBeNull()
		expect(menu.sections[0]!.order).toBe(0)
	})

	test('title and guest count are optional-field tolerant but validated', async () => {
		const session = await setupUser()

		const missingTitle = (await createMenu(session, { title: '   ' })) as any
		expect(missingTitle.init?.status).toBe(400)

		const badGuests = (await createMenu(session, {
			title: 'Weeknight',
			defaultGuestCount: '0',
		})) as any
		expect(badGuests.init?.status).toBe(400)

		const minimal = await createMenu(session, { title: 'Weeknight' })
		redirectLocation(minimal)
		const menu = await prisma.menu.findFirstOrThrow({
			where: { householdId: session.householdId },
		})
		expect(menu.description).toBeNull()
		expect(menu.defaultGuestCount).toBeNull()
	})

	test('rejects a duplicate title case-insensitively within the household', async () => {
		const session = await setupUser()
		redirectLocation(await createMenu(session, { title: 'Taco Night' }))

		const duplicate = (await createMenu(session, {
			title: '  TACO NIGHT ',
		})) as any
		expect(duplicate.init?.status).toBe(400)
		expect(duplicate.data.result.error.title).toEqual([
			'A menu with this title already exists',
		])
		expect(
			await prisma.menu.count({ where: { householdId: session.householdId } }),
		).toBe(1)
	})

	test('another household may reuse the same title', async () => {
		const session1 = await setupUser()
		const session2 = await setupUser()
		redirectLocation(await createMenu(session1, { title: 'Taco Night' }))
		redirectLocation(await createMenu(session2, { title: 'Taco Night' }))
		expect(await prisma.menu.count()).toBe(2)
	})
})

describe('menu library and detail', () => {
	test('lists only the household menus, most recently updated first', async () => {
		const session = await setupUser()
		const otherSession = await setupUser()
		redirectLocation(await createMenu(session, { title: 'First' }))
		redirectLocation(await createMenu(session, { title: 'Second' }))
		redirectLocation(await createMenu(otherSession, { title: 'Elsewhere' }))
		// Pin the relative recency — back-to-back creates can share a timestamp
		await prisma.menu.update({
			where: {
				householdId_titleKey: {
					householdId: session.householdId,
					titleKey: 'first',
				},
			},
			data: { updatedAt: new Date(Date.now() - 60_000) },
		})

		const request = await makeRequest(session, '/recipes/menus')
		const result = (await indexLoader({
			request,
			...makeIndexArgs(),
		})) as { menus: Array<{ title: string }> }

		expect(result.menus.map((m) => m.title)).toEqual(['Second', 'First'])
	})

	test('household members share the same menus after reload', async () => {
		const session = await setupUser()
		redirectLocation(await createMenu(session, { title: 'Shared Menu' }))
		const menu = await prisma.menu.findFirstOrThrow({
			where: { householdId: session.householdId },
		})

		const memberSession = await addHouseholdMember(session.householdId)
		const request = await makeRequest(
			memberSession,
			`/recipes/menus/${menu.id}`,
		)
		const result = (await detailLoader({
			request,
			...makeMenuArgs(menu.id),
		})) as { menu: { title: string; sections: Array<{ name: string | null }> } }

		expect(result.menu.title).toBe('Shared Menu')
		expect(result.menu.sections).toEqual([
			expect.objectContaining({ name: null }),
		])
	})

	test('denies another household and 404s on a missing menu', async () => {
		const session = await setupUser()
		const stranger = await setupUser()
		redirectLocation(await createMenu(session, { title: 'Private Menu' }))
		const menu = await prisma.menu.findFirstOrThrow({
			where: { householdId: session.householdId },
		})

		const strangerRequest = await makeRequest(
			stranger,
			`/recipes/menus/${menu.id}`,
		)
		await expect(
			detailLoader({ request: strangerRequest, ...makeMenuArgs(menu.id) }),
		).rejects.toEqual(expect.objectContaining({ status: 403 }))

		const missingRequest = await makeRequest(session, '/recipes/menus/missing')
		await expect(
			detailLoader({ request: missingRequest, ...makeMenuArgs('missing') }),
		).rejects.toEqual(expect.objectContaining({ status: 404 }))
	})
})

describe('menu edit and delete', () => {
	test('saves title, description, and guest count atomically and keeps the unnamed section', async () => {
		const session = await setupUser()
		redirectLocation(
			await createMenu(session, { title: 'Before', description: 'Old' }),
		)
		const menu = await prisma.menu.findFirstOrThrow({
			where: { householdId: session.householdId },
		})

		const request = await makeRequest(
			session,
			`/recipes/menus/${menu.id}/edit`,
			{ title: 'After Ünïcode', defaultGuestCount: '8' },
		)
		const response = await editAction({
			request,
			...makeMenuArgs(menu.id, '/edit'),
		})
		expect(redirectLocation(response)).toBe(`/recipes/menus/${menu.id}`)

		const updated = await prisma.menu.findUniqueOrThrow({
			where: { id: menu.id },
			include: { sections: true },
		})
		expect(updated.title).toBe('After Ünïcode')
		expect(updated.titleKey).toBe('after ünïcode'.normalize('NFKC'))
		expect(updated.description).toBeNull()
		expect(updated.defaultGuestCount).toBe(8)
		expect(updated.sections).toHaveLength(1)
		expect(updated.sections[0]!.name).toBeNull()
	})

	test('resaving the same title does not collide with itself', async () => {
		const session = await setupUser()
		redirectLocation(await createMenu(session, { title: 'Stable Title' }))
		const menu = await prisma.menu.findFirstOrThrow({
			where: { householdId: session.householdId },
		})

		const request = await makeRequest(
			session,
			`/recipes/menus/${menu.id}/edit`,
			{ title: 'Stable Title', description: 'Now with a description' },
		)
		const response = await editAction({
			request,
			...makeMenuArgs(menu.id, '/edit'),
		})
		expect(redirectLocation(response)).toBe(`/recipes/menus/${menu.id}`)
	})

	test('renaming onto another menu title reports a field error and changes nothing', async () => {
		const session = await setupUser()
		redirectLocation(await createMenu(session, { title: 'Keep Me' }))
		redirectLocation(await createMenu(session, { title: 'Rename Me' }))
		const target = await prisma.menu.findFirstOrThrow({
			where: { titleKey: 'rename me' },
		})

		const request = await makeRequest(
			session,
			`/recipes/menus/${target.id}/edit`,
			{ title: 'KEEP ME' },
		)
		const result = (await editAction({
			request,
			...makeMenuArgs(target.id, '/edit'),
		})) as any
		expect(result.init?.status).toBe(400)
		expect(result.data.result.error.title).toEqual([
			'A menu with this title already exists',
		])

		const unchanged = await prisma.menu.findUniqueOrThrow({
			where: { id: target.id },
		})
		expect(unchanged.title).toBe('Rename Me')
	})

	test('delete removes the menu and its sections', async () => {
		const session = await setupUser()
		redirectLocation(await createMenu(session, { title: 'Doomed' }))
		const menu = await prisma.menu.findFirstOrThrow({
			where: { householdId: session.householdId },
		})

		const request = await makeRequest(
			session,
			`/recipes/menus/${menu.id}/edit`,
			{ intent: 'delete' },
		)
		const response = await editAction({
			request,
			...makeMenuArgs(menu.id, '/edit'),
		})
		expect(redirectLocation(response)).toBe('/recipes/menus')

		expect(await prisma.menu.count()).toBe(0)
		expect(await prisma.menuSection.count()).toBe(0)
	})

	test('a metadata-only save keeps working on a menu without items', async () => {
		const session = await setupUser()
		const menu = await createMenuWithId(session, 'Just Words')

		const response = await saveMenu(session, menu.id, {
			title: 'Just Words',
			description: 'Nothing composed yet',
		})
		expect(redirectLocation(response)).toBe(`/recipes/menus/${menu.id}`)
		expect(await menuItems(menu.id)).toEqual([])
	})

	test('edit routes enforce household access', async () => {
		const session = await setupUser()
		const stranger = await setupUser()
		redirectLocation(await createMenu(session, { title: 'Guarded' }))
		const menu = await prisma.menu.findFirstOrThrow({
			where: { householdId: session.householdId },
		})

		const loaderRequest = await makeRequest(
			stranger,
			`/recipes/menus/${menu.id}/edit`,
		)
		await expect(
			editLoader({ request: loaderRequest, ...makeMenuArgs(menu.id, '/edit') }),
		).rejects.toEqual(expect.objectContaining({ status: 403 }))

		const deleteRequest = await makeRequest(
			stranger,
			`/recipes/menus/${menu.id}/edit`,
			{ intent: 'delete' },
		)
		await expect(
			editAction({ request: deleteRequest, ...makeMenuArgs(menu.id, '/edit') }),
		).rejects.toEqual(expect.objectContaining({ status: 403 }))
		expect(await prisma.menu.count()).toBe(1)
	})
})

describe('menu recipe items', () => {
	test('adds picked recipes with frozen titles, stable order, and independent multipliers', async () => {
		const session = await setupUser()
		const menu = await createMenuWithId(session, 'Terrace Dinner')
		const hummus = await createRecipe(session, session.householdId, 'Hummus')
		const pita = await createRecipe(session, session.householdId, 'Pita')

		const response = await saveMenu(session, menu.id, {
			title: 'Terrace Dinner',
			...(await unnamedItemsFields(menu.id, [
				{ recipeId: hummus.id, scaleMultiplier: '1' },
				{ recipeId: pita.id, scaleMultiplier: '2.5', note: 'Two oven batches' },
			])),
		})
		expect(redirectLocation(response)).toBe(`/recipes/menus/${menu.id}`)

		const items = await menuItems(menu.id)
		expect(items).toHaveLength(2)
		expect(items[0]).toMatchObject({
			kind: 'recipe',
			order: 0,
			recipeId: hummus.id,
			recipeTitle: 'Hummus',
			scaleMultiplier: 1,
			note: null,
		})
		expect(items[1]).toMatchObject({
			kind: 'recipe',
			order: 1,
			recipeId: pita.id,
			recipeTitle: 'Pita',
			scaleMultiplier: 2.5,
			note: 'Two oven batches',
		})

		// A household member reopening the menu sees the same composition
		const memberSession = await addHouseholdMember(session.householdId)
		const request = await makeRequest(
			memberSession,
			`/recipes/menus/${menu.id}`,
		)
		const result = (await detailLoader({
			request,
			...makeMenuArgs(menu.id),
		})) as {
			menu: {
				sections: Array<{
					items: Array<{ recipe: { title: string } | null }>
				}>
			}
		}
		expect(result.menu.sections[0]!.items.map((i) => i.recipe?.title)).toEqual([
			'Hummus',
			'Pita',
		])
	})

	test('accepts a comma decimal multiplier', async () => {
		const session = await setupUser()
		const menu = await createMenuWithId(session, 'Comma Locale')
		const recipe = await createRecipe(session, session.householdId, 'Ciorbă')

		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Comma Locale',
				...(await unnamedItemsFields(menu.id, [
					{ recipeId: recipe.id, scaleMultiplier: '1,5' },
				])),
			}),
		)
		const items = await menuItems(menu.id)
		expect(items[0]!.scaleMultiplier).toBe(1.5)
	})

	test('rejects non-positive, malformed, and oversized multipliers', async () => {
		const session = await setupUser()
		const menu = await createMenuWithId(session, 'Strict Numbers')
		const recipe = await createRecipe(session, session.householdId, 'Falafel')

		for (const bad of ['0', '-1', 'abc', '101', '1.234']) {
			const result = (await saveMenu(session, menu.id, {
				title: 'Strict Numbers',
				...(await unnamedItemsFields(menu.id, [
					{ recipeId: recipe.id, scaleMultiplier: bad },
				])),
			})) as any
			expect(result.init?.status, `multiplier ${bad}`).toBe(400)
		}
		expect(await menuItems(menu.id)).toEqual([])
	})

	test('rejects the same recipe appearing twice in one menu', async () => {
		const session = await setupUser()
		const menu = await createMenuWithId(session, 'No Doubles')
		const recipe = await createRecipe(session, session.householdId, 'Tabbouleh')

		const result = (await saveMenu(session, menu.id, {
			title: 'No Doubles',
			...(await unnamedItemsFields(menu.id, [
				{ recipeId: recipe.id, scaleMultiplier: '1' },
				{ recipeId: recipe.id, scaleMultiplier: '2' },
			])),
		})) as any
		expect(result.init?.status).toBe(400)
		expect(result.data.result.error['']).toEqual([
			'Each recipe can appear only once per menu',
		])
		expect(await menuItems(menu.id)).toEqual([])
	})

	test('rejects a recipe from another household', async () => {
		const session = await setupUser()
		const stranger = await setupUser()
		const menu = await createMenuWithId(session, 'Boundaries')
		const foreign = await createRecipe(stranger, stranger.householdId, 'Theirs')

		const result = (await saveMenu(session, menu.id, {
			title: 'Boundaries',
			...(await unnamedItemsFields(menu.id, [
				{ recipeId: foreign.id, scaleMultiplier: '1' },
			])),
		})) as any
		expect(result.init?.status).toBe(400)
		expect(result.data.result.error['']).toEqual([
			'That recipe is no longer in your library',
		])
		expect(await menuItems(menu.id)).toEqual([])
	})

	test('rejects a forged item id from another menu', async () => {
		const session = await setupUser()
		const menuA = await createMenuWithId(session, 'Menu A')
		const menuB = await createMenuWithId(session, 'Menu B')
		const recipe = await createRecipe(session, session.householdId, 'Kebab')
		redirectLocation(
			await saveMenu(session, menuB.id, {
				title: 'Menu B',
				...(await unnamedItemsFields(menuB.id, [
					{ recipeId: recipe.id, scaleMultiplier: '1' },
				])),
			}),
		)
		const [foreignItem] = await menuItems(menuB.id)

		await expect(
			saveMenu(session, menuA.id, {
				title: 'Menu A',
				...(await unnamedItemsFields(menuA.id, [
					{ id: foreignItem!.id, scaleMultiplier: '3' },
				])),
			}),
		).rejects.toEqual(expect.objectContaining({ status: 400 }))
		const untouched = await menuItems(menuB.id)
		expect(untouched[0]!.scaleMultiplier).toBe(1)
	})

	test('updates, reorders, and removes items in one atomic save', async () => {
		const session = await setupUser()
		const menu = await createMenuWithId(session, 'Rework')
		const a = await createRecipe(session, session.householdId, 'A Salad')
		const b = await createRecipe(session, session.householdId, 'B Stew')
		const c = await createRecipe(session, session.householdId, 'C Bread')
		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Rework',
				...(await unnamedItemsFields(menu.id, [
					{ recipeId: a.id, scaleMultiplier: '1' },
					{ recipeId: b.id, scaleMultiplier: '1' },
					{ recipeId: c.id, scaleMultiplier: '1' },
				])),
			}),
		)
		const before = await menuItems(menu.id)

		// Reverse C and A, drop B, retune C
		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Rework',
				...(await unnamedItemsFields(menu.id, [
					{
						id: before[2]!.id,
						recipeId: c.id,
						scaleMultiplier: '3',
						note: 'Triple batch',
					},
					{ id: before[0]!.id, recipeId: a.id, scaleMultiplier: '0.5' },
				])),
			}),
		)

		const after = await menuItems(menu.id)
		expect(after).toHaveLength(2)
		expect(after[0]).toMatchObject({
			id: before[2]!.id,
			order: 0,
			recipeId: c.id,
			scaleMultiplier: 3,
			note: 'Triple batch',
		})
		expect(after[1]).toMatchObject({
			id: before[0]!.id,
			order: 1,
			recipeId: a.id,
			scaleMultiplier: 0.5,
			note: null,
		})
	})

	test('a rejected save changes nothing — menu fields and items are atomic', async () => {
		const session = await setupUser()
		await createMenuWithId(session, 'Taken Title')
		const menu = await createMenuWithId(session, 'Mine')
		const a = await createRecipe(session, session.householdId, 'Aioli')
		const b = await createRecipe(session, session.householdId, 'Bruschetta')
		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Mine',
				...(await unnamedItemsFields(menu.id, [
					{ recipeId: a.id, scaleMultiplier: '1' },
				])),
			}),
		)
		const [item] = await menuItems(menu.id)

		// Rename onto a taken title while also editing and adding items
		const result = (await saveMenu(session, menu.id, {
			title: 'TAKEN TITLE',
			...(await unnamedItemsFields(menu.id, [
				{ id: item!.id, recipeId: a.id, scaleMultiplier: '4' },
				{ recipeId: b.id, scaleMultiplier: '1' },
			])),
		})) as any
		expect(result.init?.status).toBe(400)
		expect(result.data.result.error.title).toEqual([
			'A menu with this title already exists',
		])

		const unchanged = await menuItems(menu.id)
		expect(unchanged).toHaveLength(1)
		expect(unchanged[0]!.scaleMultiplier).toBe(1)
		expect(
			await prisma.menu.findUniqueOrThrow({
				where: { id: menu.id },
				select: { title: true },
			}),
		).toEqual({ title: 'Mine' })
	})

	test('deleting a recipe leaves a missing card with frozen identity, multiplier, and order', async () => {
		const session = await setupUser()
		const menu = await createMenuWithId(session, 'Resilient')
		const keeper = await createRecipe(session, session.householdId, 'Keeper')
		const doomed = await createRecipe(
			session,
			session.householdId,
			'Doomed Dish',
		)
		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Resilient',
				...(await unnamedItemsFields(menu.id, [
					{ recipeId: doomed.id, scaleMultiplier: '2', note: 'Make ahead' },
					{ recipeId: keeper.id, scaleMultiplier: '1' },
				])),
			}),
		)

		await prisma.recipe.delete({ where: { id: doomed.id } })

		const items = await menuItems(menu.id)
		expect(items[0]).toMatchObject({
			order: 0,
			recipeId: null,
			recipeTitle: 'Doomed Dish',
			scaleMultiplier: 2,
			note: 'Make ahead',
		})

		const request = await makeRequest(session, `/recipes/menus/${menu.id}`)
		const result = (await detailLoader({
			request,
			...makeMenuArgs(menu.id),
		})) as {
			menu: {
				sections: Array<{
					items: Array<{
						recipeTitle: string | null
						recipe: { id: string } | null
					}>
				}>
			}
		}
		const [missingCard, keptCard] = result.menu.sections[0]!.items
		expect(missingCard!.recipe).toBeNull()
		expect(missingCard!.recipeTitle).toBe('Doomed Dish')
		expect(keptCard!.recipe?.id).toBe(keeper.id)
	})

	test('a missing card survives an unrelated save and is replaced or removed only explicitly', async () => {
		const session = await setupUser()
		const menu = await createMenuWithId(session, 'Recovery')
		const doomed = await createRecipe(session, session.householdId, 'Old Star')
		const substitute = await createRecipe(
			session,
			session.householdId,
			'New Star',
		)
		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Recovery',
				...(await unnamedItemsFields(menu.id, [
					{ recipeId: doomed.id, scaleMultiplier: '2' },
				])),
			}),
		)
		const [item] = await menuItems(menu.id)
		await prisma.recipe.delete({ where: { id: doomed.id } })

		// Unrelated save keeps the missing card as-is (empty recipeId ≠ unlink)
		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Recovery',
				description: 'Still hosting',
				...(await unnamedItemsFields(menu.id, [
					{ id: item!.id, recipeId: '', scaleMultiplier: '2' },
				])),
			}),
		)
		let items = await menuItems(menu.id)
		expect(items[0]).toMatchObject({
			id: item!.id,
			recipeId: null,
			recipeTitle: 'Old Star',
			scaleMultiplier: 2,
		})

		// Explicit replacement re-freezes the title and keeps the multiplier
		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Recovery',
				...(await unnamedItemsFields(menu.id, [
					{ id: item!.id, recipeId: substitute.id, scaleMultiplier: '2' },
				])),
			}),
		)
		items = await menuItems(menu.id)
		expect(items[0]).toMatchObject({
			id: item!.id,
			recipeId: substitute.id,
			recipeTitle: 'New Star',
			scaleMultiplier: 2,
		})

		// Explicit removal deletes the card
		redirectLocation(await saveMenu(session, menu.id, { title: 'Recovery' }))
		expect(await menuItems(menu.id)).toEqual([])
	})

	test('the edit loader returns ordered sections and household recipes for the builder', async () => {
		const session = await setupUser()
		const menu = await createMenuWithId(session, 'Builder Data')
		const recipe = await createRecipe(session, session.householdId, 'Shakshuka')
		const stranger = await setupUser()
		await createRecipe(stranger, stranger.householdId, 'Not Yours')
		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Builder Data',
				...(await unnamedItemsFields(menu.id, [
					{ recipeId: recipe.id, scaleMultiplier: '1.25' },
				])),
			}),
		)

		const request = await makeRequest(session, `/recipes/menus/${menu.id}/edit`)
		const result = (await editLoader({
			request,
			...makeMenuArgs(menu.id, '/edit'),
		})) as {
			sections: Array<{
				name: string | null
				items: Array<{ recipeId: string | null; scaleMultiplier: number }>
			}>
			recipes: Array<{ title: string }>
		}
		expect(result.sections).toEqual([
			expect.objectContaining({
				name: null,
				items: [
					expect.objectContaining({
						recipeId: recipe.id,
						scaleMultiplier: 1.25,
					}),
				],
			}),
		])
		expect(result.recipes.map((r) => r.title)).toEqual(['Shakshuka'])
	})
})

describe('menu sections and ordering', () => {
	/** A menu with Hummus in the unnamed section and a 'Dessert' section
	 * holding Baklava then Knafeh — the base for most section tests. */
	async function setupSectionedMenu() {
		const session = await setupUser()
		const menu = await createMenuWithId(session, 'Feast')
		const hummus = await createRecipe(session, session.householdId, 'Hummus')
		const baklava = await createRecipe(session, session.householdId, 'Baklava')
		const knafeh = await createRecipe(session, session.householdId, 'Knafeh')
		const unnamed = await unnamedSection(menu.id)
		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Feast',
				...sectionFields(0, { id: unnamed.id }, [
					{ recipeId: hummus.id, scaleMultiplier: '1' },
				]),
				...sectionFields(1, { name: 'Dessert' }, [
					{ recipeId: baklava.id, scaleMultiplier: '1' },
					{ recipeId: knafeh.id, scaleMultiplier: '2' },
				]),
			}),
		)
		return { session, menu, hummus, baklava, knafeh, unnamed }
	}

	test('adds a named section and persists section and item order for the household', async () => {
		const { session, menu } = await setupSectionedMenu()

		const sections = await menuSections(menu.id)
		expect(sections).toHaveLength(2)
		expect(sections[0]).toMatchObject({ name: null, order: 0 })
		expect(sections[1]).toMatchObject({ name: 'Dessert', order: 1 })
		expect(sections[0]!.items.map((i) => i.recipeTitle)).toEqual(['Hummus'])
		expect(sections[1]!.items.map((i) => i.recipeTitle)).toEqual([
			'Baklava',
			'Knafeh',
		])
		expect(sections[1]!.items.map((i) => i.order)).toEqual([0, 1])

		// A household member reopening the menu sees the same structure
		const memberSession = await addHouseholdMember(session.householdId)
		const request = await makeRequest(
			memberSession,
			`/recipes/menus/${menu.id}`,
		)
		const result = (await detailLoader({
			request,
			...makeMenuArgs(menu.id),
		})) as {
			menu: {
				sections: Array<{
					name: string | null
					items: Array<{ recipeTitle: string | null }>
				}>
			}
		}
		expect(
			result.menu.sections.map((s) => ({
				name: s.name,
				titles: s.items.map((i) => i.recipeTitle),
			})),
		).toEqual([
			{ name: null, titles: ['Hummus'] },
			{ name: 'Dessert', titles: ['Baklava', 'Knafeh'] },
		])
	})

	test('reorders sections and items within a section in one save', async () => {
		const { session, menu, hummus, baklava, knafeh, unnamed } =
			await setupSectionedMenu()
		const before = await menuSections(menu.id)
		const dessert = before[1]!
		const [baklavaItem, knafehItem] = dessert.items
		const [hummusItem] = before[0]!.items

		// Dessert first with its items reversed; the unnamed section moves last
		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Feast',
				...sectionFields(0, { id: dessert.id, name: 'Dessert' }, [
					{ id: knafehItem!.id, recipeId: knafeh.id, scaleMultiplier: '2' },
					{ id: baklavaItem!.id, recipeId: baklava.id, scaleMultiplier: '1' },
				]),
				...sectionFields(1, { id: unnamed.id }, [
					{ id: hummusItem!.id, recipeId: hummus.id, scaleMultiplier: '1' },
				]),
			}),
		)

		const after = await menuSections(menu.id)
		expect(after.map((s) => s.name)).toEqual(['Dessert', null])
		expect(after[0]!.items.map((i) => i.recipeTitle)).toEqual([
			'Knafeh',
			'Baklava',
		])
		expect(after[1]!.items.map((i) => i.recipeTitle)).toEqual(['Hummus'])
	})

	test('moves an item to another section explicitly', async () => {
		const { session, menu, hummus, baklava, knafeh, unnamed } =
			await setupSectionedMenu()
		const before = await menuSections(menu.id)
		const dessert = before[1]!
		const [baklavaItem, knafehItem] = dessert.items
		const [hummusItem] = before[0]!.items

		// Baklava leaves Dessert for the unnamed section
		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Feast',
				...sectionFields(0, { id: unnamed.id }, [
					{ id: hummusItem!.id, recipeId: hummus.id, scaleMultiplier: '1' },
					{ id: baklavaItem!.id, recipeId: baklava.id, scaleMultiplier: '1' },
				]),
				...sectionFields(1, { id: dessert.id, name: 'Dessert' }, [
					{ id: knafehItem!.id, recipeId: knafeh.id, scaleMultiplier: '2' },
				]),
			}),
		)

		const after = await menuSections(menu.id)
		expect(after[0]!.items.map((i) => i.recipeTitle)).toEqual([
			'Hummus',
			'Baklava',
		])
		expect(after[1]!.items.map((i) => i.recipeTitle)).toEqual(['Knafeh'])
		const moved = after[0]!.items[1]!
		expect(moved.id).toBe(baklavaItem!.id)
		expect(moved.sectionId).toBe(unnamed.id)
	})

	test('renames a custom section', async () => {
		const { session, menu, hummus, baklava, knafeh, unnamed } =
			await setupSectionedMenu()
		const before = await menuSections(menu.id)
		const dessert = before[1]!
		const [baklavaItem, knafehItem] = dessert.items
		const [hummusItem] = before[0]!.items

		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Feast',
				...sectionFields(0, { id: unnamed.id }, [
					{ id: hummusItem!.id, recipeId: hummus.id, scaleMultiplier: '1' },
				]),
				...sectionFields(1, { id: dessert.id, name: 'Sweets' }, [
					{ id: baklavaItem!.id, recipeId: baklava.id, scaleMultiplier: '1' },
					{ id: knafehItem!.id, recipeId: knafeh.id, scaleMultiplier: '2' },
				]),
			}),
		)

		const after = await menuSections(menu.id)
		expect(after.map((s) => s.name)).toEqual([null, 'Sweets'])
	})

	test('removing a non-empty custom section moves its items to the unnamed section', async () => {
		const { session, menu, hummus, baklava, knafeh, unnamed } =
			await setupSectionedMenu()
		const before = await menuSections(menu.id)
		const [baklavaItem, knafehItem] = before[1]!.items
		const [hummusItem] = before[0]!.items

		// The builder submits the removed section's items under the unnamed one
		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Feast',
				...sectionFields(0, { id: unnamed.id }, [
					{ id: hummusItem!.id, recipeId: hummus.id, scaleMultiplier: '1' },
					{ id: baklavaItem!.id, recipeId: baklava.id, scaleMultiplier: '1' },
					{ id: knafehItem!.id, recipeId: knafeh.id, scaleMultiplier: '2' },
				]),
			}),
		)

		const after = await menuSections(menu.id)
		expect(after).toHaveLength(1)
		expect(after[0]!.name).toBeNull()
		expect(after[0]!.items.map((i) => i.recipeTitle)).toEqual([
			'Hummus',
			'Baklava',
			'Knafeh',
		])
		// The items themselves survived — same rows, new home
		expect(after[0]!.items.map((i) => i.id)).toContain(knafehItem!.id)
	})

	test('omitting a custom section and its items deletes both — the save is the full state', async () => {
		const { session, menu, hummus, unnamed } = await setupSectionedMenu()
		const [hummusItem] = (await menuSections(menu.id))[0]!.items

		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Feast',
				...sectionFields(0, { id: unnamed.id }, [
					{ id: hummusItem!.id, recipeId: hummus.id, scaleMultiplier: '1' },
				]),
			}),
		)

		const after = await menuSections(menu.id)
		expect(after).toHaveLength(1)
		expect(await menuItems(menu.id)).toHaveLength(1)
	})

	test('the unnamed section cannot be removed and never takes a name', async () => {
		const { session, menu, unnamed } = await setupSectionedMenu()
		const dessert = (await menuSections(menu.id))[1]!

		// A submission without the unnamed section is rejected outright
		await expect(
			saveMenu(session, menu.id, {
				title: 'Feast',
				...sectionFields(0, { id: dessert.id, name: 'Dessert' }),
			}),
		).rejects.toEqual(expect.objectContaining({ status: 400 }))

		// A name submitted for the unnamed section is ignored, not persisted
		redirectLocation(
			await saveMenu(session, menu.id, {
				title: 'Feast',
				...sectionFields(0, { id: unnamed.id, name: 'Sneaky Name' }),
			}),
		)
		const stored = await prisma.menuSection.findUniqueOrThrow({
			where: { id: unnamed.id },
		})
		expect(stored.name).toBeNull()
	})

	test('rejects forged and duplicated section ids', async () => {
		const session = await setupUser()
		const menuA = await createMenuWithId(session, 'Menu A')
		const menuB = await createMenuWithId(session, 'Menu B')
		const unnamedA = await unnamedSection(menuA.id)
		const unnamedB = await unnamedSection(menuB.id)

		await expect(
			saveMenu(session, menuA.id, {
				title: 'Menu A',
				...sectionFields(0, { id: unnamedA.id }),
				...sectionFields(1, { id: unnamedB.id }),
			}),
		).rejects.toEqual(expect.objectContaining({ status: 400 }))

		await expect(
			saveMenu(session, menuA.id, {
				title: 'Menu A',
				...sectionFields(0, { id: unnamedA.id }),
				...sectionFields(1, { id: unnamedA.id }),
			}),
		).rejects.toEqual(expect.objectContaining({ status: 400 }))
	})

	test('a new section requires a name and an existing one cannot lose its name', async () => {
		const { session, menu, unnamed } = await setupSectionedMenu()
		const dessert = (await menuSections(menu.id))[1]!

		const nameless = (await saveMenu(session, menu.id, {
			title: 'Feast',
			...sectionFields(0, { id: unnamed.id }),
			...sectionFields(1, { name: '   ' }),
		})) as any
		expect(nameless.init?.status).toBe(400)
		expect(nameless.data.result.error['sections[1].name']).toEqual([
			'Section name is required',
		])

		const cleared = (await saveMenu(session, menu.id, {
			title: 'Feast',
			...sectionFields(0, { id: unnamed.id }),
			...sectionFields(1, { id: dessert.id }),
		})) as any
		expect(cleared.init?.status).toBe(400)
		expect(cleared.data.result.error['sections[1].name']).toEqual([
			'Section name is required',
		])
		expect((await menuSections(menu.id))[1]!.name).toBe('Dessert')
	})

	test('rejects an item id submitted under two sections at once', async () => {
		const { session, menu, hummus, unnamed } = await setupSectionedMenu()
		const before = await menuSections(menu.id)
		const dessert = before[1]!
		const [hummusItem] = before[0]!.items

		await expect(
			saveMenu(session, menu.id, {
				title: 'Feast',
				...sectionFields(0, { id: unnamed.id }, [
					{ id: hummusItem!.id, recipeId: hummus.id, scaleMultiplier: '1' },
				]),
				...sectionFields(1, { id: dessert.id, name: 'Dessert' }, [
					{ id: hummusItem!.id, recipeId: hummus.id, scaleMultiplier: '1' },
				]),
			}),
		).rejects.toEqual(expect.objectContaining({ status: 400 }))
	})

	test('a recipe still appears only once per menu across sections', async () => {
		const { session, menu, hummus, unnamed } = await setupSectionedMenu()
		const before = await menuSections(menu.id)
		const dessert = before[1]!
		const [hummusItem] = before[0]!.items

		const result = (await saveMenu(session, menu.id, {
			title: 'Feast',
			...sectionFields(0, { id: unnamed.id }, [
				{ id: hummusItem!.id, recipeId: hummus.id, scaleMultiplier: '1' },
			]),
			...sectionFields(1, { id: dessert.id, name: 'Dessert' }, [
				{ recipeId: hummus.id, scaleMultiplier: '1' },
			]),
		})) as any
		expect(result.init?.status).toBe(400)
		expect(result.data.result.error['']).toEqual([
			'Each recipe can appear only once per menu',
		])
	})
})
