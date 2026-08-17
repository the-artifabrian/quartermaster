import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
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
