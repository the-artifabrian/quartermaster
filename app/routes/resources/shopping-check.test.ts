import { RouterContextProvider } from 'react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { action } from './shopping-check.tsx'
import '#tests/setup/db-setup.ts'

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

async function setupRice(amount: { quantity?: string; unit?: string } = {}) {
	const session = await setupUser()
	const list = await ensureShoppingList(prisma, session)
	const item = await prisma.shoppingListItem.create({
		data: { listId: list.id, name: 'Rice', ...amount },
	})
	return { session, item }
}

async function postCheck(
	session: { id: string },
	fields: {
		itemId: string
		checked: 'true' | 'false'
		observedVersion: string
		mutationId: string
	},
) {
	const response = await action({
		request: new Request(`${BASE_URL}/resources/shopping-check`, {
			method: 'POST',
			headers: {
				cookie: await getSessionCookieHeader(session),
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams(fields).toString(),
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/resources/shopping-check',
		url: new URL(`${BASE_URL}/resources/shopping-check`),
	})
	const body = (await response.json()) as { status: string }
	return { status: response.status, body }
}

const storedCheck = (id: string) =>
	prisma.shoppingListItem.findUniqueOrThrow({
		where: { id },
		select: { checked: true, checkVersion: true },
	})

describe('shopping check writes', () => {
	test('retrying the same desired check does not uncheck the purchase', async () => {
		const { session, item } = await setupRice()
		const check = {
			itemId: item.id,
			checked: 'true',
			observedVersion: '0',
			mutationId: 'same-check-request',
		} as const

		await postCheck(session, check)
		// The retry's conditional write matches nothing; it finds its own
		// earlier commit and reports that as the success it was.
		expect(await postCheck(session, check)).toMatchObject({
			status: 200,
			body: { status: 'success', item: { checked: true, checkVersion: 1 } },
		})
		expect(await storedCheck(item.id)).toEqual({
			checked: true,
			checkVersion: 1,
		})
	})

	test('a retry after another member unchecks cannot overwrite their later decision', async () => {
		const { session, item } = await setupRice()
		const other = await prisma.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: {
					create: {
						...createUser(),
						householdMembers: {
							create: { householdId: session.householdId, role: 'member' },
						},
					},
				},
			},
			select: { id: true },
		})
		const first = {
			itemId: item.id,
			checked: 'true',
			observedVersion: '0',
			mutationId: 'lost-response',
		} as const
		await postCheck(session, first)
		await postCheck(other, {
			...first,
			checked: 'false',
			observedVersion: '1',
			mutationId: 'later-uncheck',
		})

		expect(await postCheck(session, first)).toMatchObject({
			status: 409,
			body: { status: 'conflict', item: { checked: false, checkVersion: 2 } },
		})
		expect(await storedCheck(item.id)).toEqual({
			checked: false,
			checkVersion: 2,
		})
	})

	test('overlapping observed writes have one winner without toggling twice', async () => {
		const { session, item } = await setupRice()
		const results = await Promise.all(
			['first', 'second'].map((mutationId) =>
				postCheck(session, {
					itemId: item.id,
					checked: 'true',
					observedVersion: '0',
					mutationId,
				}),
			),
		)

		expect(
			results.map(({ status, body }) => `${status} ${body.status}`).sort(),
		).toEqual(['200 success', '409 conflict'])
		expect(await storedCheck(item.id)).toEqual({
			checked: true,
			checkVersion: 1,
		})
	})

	test('a contribution-only change invalidates the requirement seen in Shopping', async () => {
		const { session, item } = await setupRice({ quantity: '200', unit: 'g' })
		// Meal demand joins the row without changing its own quantity.
		await prisma.mealShoppingContribution.create({
			data: {
				itemId: item.id,
				canonicalName: 'rice',
				name: 'Rice',
				quantity: '400',
				unit: 'g',
			},
		})

		// The phone shows the conflict's item as confirmed, so it must carry
		// the combined amount the household now needs.
		expect(
			await postCheck(session, {
				itemId: item.id,
				checked: 'true',
				observedVersion: '0',
				mutationId: 'stale-rice',
			}),
		).toMatchObject({
			status: 409,
			body: {
				status: 'conflict',
				item: {
					checked: false,
					quantity: '200',
					display: { quantity: '600', unit: 'g' },
				},
			},
		})
	})

	test('another household cannot check or see the item', async () => {
		const { item } = await setupRice()
		const outsider = await setupUser()

		const { status, body } = await postCheck(outsider, {
			itemId: item.id,
			checked: 'true',
			observedVersion: '0',
			mutationId: 'foreign',
		})
		expect(status).toBe(404)
		expect(body).toMatchObject({ status: 'missing' })
		expect(body).not.toHaveProperty('item')
		expect(await storedCheck(item.id)).toEqual({
			checked: false,
			checkVersion: 0,
		})
	})
})
