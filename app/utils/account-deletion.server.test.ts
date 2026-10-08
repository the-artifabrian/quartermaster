import fs from 'node:fs/promises'
import path from 'node:path'
import { http, HttpResponse } from 'msw'
import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { loader as exportRecipesLoader } from '#app/routes/resources/export-recipes.tsx'
import { action as householdAction } from '#app/routes/settings/profile/household.tsx'
import { loader as shareLoader } from '#app/routes/share.$recipeId.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { server } from '#tests/setup/mocks-setup.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import {
	deleteAccount,
	getAccountDeletionOutcome,
} from './account-deletion.server.ts'
import '#tests/setup/db-setup.ts'

const UPLOADS_DIR = path.join(process.cwd(), 'tests/fixtures/uploaded')

const ROUTE_ARGS = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/',
	url: new URL(BASE_URL),
}

async function insertUser(name?: string) {
	return prisma.user.create({
		data: { ...createUser(), ...(name ? { name } : {}) },
	})
}

async function cookieFor(userId: string) {
	const session = await prisma.session.create({
		data: { expirationDate: getSessionExpirationDate(), userId },
		select: { id: true },
	})
	return getSessionCookieHeader(session)
}

/** A Household whose members joined in the given order, one minute apart. */
async function householdWith(
	members: Array<{ userId: string; role: 'owner' | 'member' }>,
) {
	const start = Date.now() - 60 * 60_000
	return prisma.household.create({
		data: {
			name: 'Home',
			members: {
				create: members.map((member, index) => ({
					...member,
					createdAt: new Date(start + index * 60_000),
				})),
			},
		},
	})
}

async function recipeIn(householdId: string, userId: string, title: string) {
	return prisma.recipe.create({
		data: { title, userId, householdId },
	})
}

/** A file in the mock bucket that cleans up its user folder on dispose. */
async function storedObject(ownerId: string, name: string) {
	const objectKey = `users/${ownerId}/recipes/r/images/${name}.png`
	const filePath = path.join(UPLOADS_DIR, objectKey)
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, 'png bytes')
	return {
		objectKey,
		filePath,
		async [Symbol.asyncDispose]() {
			await fs.rm(path.join(UPLOADS_DIR, 'users', ownerId), {
				recursive: true,
				force: true,
			})
		},
	}
}

const exists = (filePath: string) =>
	fs.access(filePath).then(
		() => true,
		() => false,
	)

describe('deleteAccount with another member remaining', () => {
	test('a member deleting leaves Recipes and Shopping with the Household and the owner unchanged', async () => {
		const owner = await insertUser()
		const member = await insertUser()
		const household = await householdWith([
			{ userId: owner.id, role: 'owner' },
			{ userId: member.id, role: 'member' },
		])
		const imported = await recipeIn(household.id, member.id, 'Member stew')
		const ownersOwn = await recipeIn(household.id, owner.id, 'Owner soup')
		const list = await prisma.shoppingList.create({
			data: {
				userId: member.id,
				householdId: household.id,
				items: { create: { name: 'Milk' } },
			},
		})

		await deleteAccount(member.id)

		expect(await prisma.user.findUnique({ where: { id: member.id } })).toBe(
			null,
		)
		const recipes = await prisma.recipe.findMany({
			where: { householdId: household.id },
			select: { id: true, userId: true },
			orderBy: { title: 'asc' },
		})
		expect(recipes).toEqual([
			{ id: imported.id, userId: owner.id },
			{ id: ownersOwn.id, userId: owner.id },
		])
		expect(
			await prisma.shoppingList.findUnique({
				where: { id: list.id },
				select: { userId: true, householdId: true, items: true },
			}),
		).toEqual({
			userId: owner.id,
			householdId: household.id,
			items: [expect.objectContaining({ name: 'Milk' })],
		})
		expect(
			await prisma.householdMember.findMany({
				where: { householdId: household.id },
				select: { userId: true, role: true },
			}),
		).toEqual([{ userId: owner.id, role: 'owner' }])
	})

	test('an owner deleting hands ownership to the remaining member, who can invite', async () => {
		const owner = await insertUser()
		const member = await insertUser()
		const household = await householdWith([
			{ userId: owner.id, role: 'owner' },
			{ userId: member.id, role: 'member' },
		])
		const pending = await prisma.householdInvite.create({
			data: {
				token: 'pending-token',
				expiresAt: new Date(Date.now() + 86_400_000),
				householdId: household.id,
				createdById: owner.id,
			},
		})

		await deleteAccount(owner.id)

		expect(
			await prisma.householdMember.findMany({
				where: { householdId: household.id },
				select: { userId: true, role: true },
			}),
		).toEqual([{ userId: member.id, role: 'owner' }])
		// The invite the owner already sent still works for the Household.
		expect(
			await prisma.householdInvite.findUnique({
				where: { id: pending.id },
				select: { createdById: true },
			}),
		).toEqual({ createdById: member.id })

		const response = await householdAction({
			...ROUTE_ARGS,
			request: new Request(`${BASE_URL}/settings/profile/household`, {
				method: 'POST',
				headers: {
					cookie: await cookieFor(member.id),
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({ intent: 'create-invite' }),
			}),
		})
		expect(response).toEqual(
			expect.objectContaining({ inviteToken: expect.any(String) }),
		)
	})

	test('with several remaining, an existing owner inherits ahead of an earlier member', async () => {
		const earlyMember = await insertUser()
		const owner = await insertUser()
		const leaver = await insertUser()
		const household = await householdWith([
			{ userId: earlyMember.id, role: 'member' },
			{ userId: owner.id, role: 'owner' },
			{ userId: leaver.id, role: 'member' },
		])
		const recipe = await recipeIn(household.id, leaver.id, 'Leaver pie')

		await deleteAccount(leaver.id)

		expect(
			await prisma.recipe.findUnique({
				where: { id: recipe.id },
				select: { userId: true },
			}),
		).toEqual({ userId: owner.id })
	})

	test('with no owner remaining, the longest-standing member inherits and becomes owner', async () => {
		const owner = await insertUser()
		const first = await insertUser()
		const second = await insertUser()
		const household = await householdWith([
			{ userId: owner.id, role: 'owner' },
			{ userId: first.id, role: 'member' },
			{ userId: second.id, role: 'member' },
		])
		const recipe = await recipeIn(household.id, owner.id, 'Owner roast')

		await deleteAccount(owner.id)

		expect(
			await prisma.householdMember.findMany({
				where: { householdId: household.id },
				select: { userId: true, role: true },
				orderBy: { createdAt: 'asc' },
			}),
		).toEqual([
			{ userId: first.id, role: 'owner' },
			{ userId: second.id, role: 'member' },
		])
		expect(
			await prisma.recipe.findUnique({
				where: { id: recipe.id },
				select: { userId: true },
			}),
		).toEqual({ userId: first.id })
	})

	test('an owner-less Household gets its heir as owner when a member deletes', async () => {
		// The old bare user delete could leave a Household with no owner.
		const first = await insertUser()
		const leaver = await insertUser()
		const household = await householdWith([
			{ userId: first.id, role: 'member' },
			{ userId: leaver.id, role: 'member' },
		])

		await deleteAccount(leaver.id)

		expect(
			await prisma.householdMember.findMany({
				where: { householdId: household.id },
				select: { userId: true, role: true },
			}),
		).toEqual([{ userId: first.id, role: 'owner' }])
	})

	test('Recipes left behind in a former Household stay there', async () => {
		// leaveHousehold copies a member's Recipes and leaves the originals,
		// still pointing at the leaver, in the Household they left.
		const formerPartner = await insertUser()
		const leaver = await insertUser()
		const former = await householdWith([
			{ userId: formerPartner.id, role: 'owner' },
		])
		await householdWith([{ userId: leaver.id, role: 'owner' }])
		const leftBehind = await recipeIn(former.id, leaver.id, 'Left behind')

		await deleteAccount(leaver.id)

		expect(
			await prisma.recipe.findUnique({
				where: { id: leftBehind.id },
				select: { userId: true, householdId: true },
			}),
		).toEqual({ userId: formerPartner.id, householdId: former.id })
	})

	test("export after a partner's deletion still contains the partner's Recipes", async () => {
		const owner = await insertUser()
		const partner = await insertUser()
		const household = await householdWith([
			{ userId: owner.id, role: 'owner' },
			{ userId: partner.id, role: 'member' },
		])
		await recipeIn(household.id, partner.id, 'Partner curry')

		await deleteAccount(partner.id)

		const response = await exportRecipesLoader({
			...ROUTE_ARGS,
			request: new Request(`${BASE_URL}/resources/export-recipes`, {
				headers: { cookie: await cookieFor(owner.id) },
			}),
		})
		const exported = (await response.json()) as {
			recipes: Array<{ title: string }>
		}
		expect(exported.recipes.map((recipe) => recipe.title)).toEqual([
			'Partner curry',
		])
	})
})

describe('deleteAccount as the sole member', () => {
	test('deletes the Household and everything in it, including stored photos', async () => {
		const user = await insertUser()
		// A partner who left earlier: their original Recipe stays here.
		const departed = await insertUser()
		const household = await householdWith([{ userId: user.id, role: 'owner' }])
		await using photo = await storedObject(user.id, 'photo')
		await using departedPhoto = await storedObject(departed.id, 'departed')
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Mine',
				userId: user.id,
				householdId: household.id,
				image: { create: { objectKey: photo.objectKey } },
			},
		})
		const departedRecipe = await prisma.recipe.create({
			data: {
				title: 'Theirs',
				userId: departed.id,
				householdId: household.id,
				image: { create: { objectKey: departedPhoto.objectKey } },
			},
		})
		await prisma.menu.create({
			data: { title: 'Sunday', titleKey: 'sunday', householdId: household.id },
		})
		await prisma.mealPlan.create({
			data: {
				householdId: household.id,
				weekStart: new Date('2026-10-05T00:00:00.000Z'),
				meals: {
					create: {
						date: new Date('2026-10-05T00:00:00.000Z'),
						order: 0,
						label: 'dinner',
					},
				},
			},
		})
		await prisma.householdIngredient.create({
			data: {
				displayName: 'Rice',
				canonicalKey: 'rice',
				isStaple: true,
				householdId: household.id,
			},
		})
		const list = await prisma.shoppingList.create({
			data: {
				userId: departed.id,
				householdId: household.id,
				items: { create: { name: 'Eggs' } },
			},
		})
		await prisma.householdInvite.create({
			data: {
				token: 'sole-token',
				expiresAt: new Date(Date.now() + 86_400_000),
				householdId: household.id,
				createdById: user.id,
			},
		})
		await prisma.householdEvent.create({
			data: {
				type: 'household_member_joined',
				payload: '{}',
				householdId: household.id,
				userId: user.id,
			},
		})

		await deleteAccount(user.id)

		const where = { householdId: household.id }
		expect(await prisma.household.count({ where: { id: household.id } })).toBe(
			0,
		)
		expect(
			await prisma.recipe.count({
				where: { id: { in: [recipe.id, departedRecipe.id] } },
			}),
		).toBe(0)
		expect(await prisma.menu.count({ where })).toBe(0)
		expect(await prisma.mealPlan.count({ where })).toBe(0)
		expect(await prisma.meal.count()).toBe(0)
		expect(await prisma.householdIngredient.count({ where })).toBe(0)
		expect(await prisma.shoppingList.count({ where: { id: list.id } })).toBe(0)
		expect(await prisma.shoppingListItem.count()).toBe(0)
		expect(await prisma.householdInvite.count({ where })).toBe(0)
		expect(await prisma.householdEvent.count({ where })).toBe(0)
		expect(await prisma.recipeImage.count()).toBe(0)
		expect(await exists(photo.filePath)).toBe(false)
		expect(await exists(departedPhoto.filePath)).toBe(false)
		// The departed partner's account is theirs to delete.
		expect(await prisma.user.count({ where: { id: departed.id } })).toBe(1)

		const shared = await shareLoader({
			...ROUTE_ARGS,
			params: { recipeId: recipe.id },
			request: new Request(`${BASE_URL}/share/${recipe.id}`),
		}).catch((error: unknown) => error)
		expect(shared).toBeInstanceOf(Response)
		expect((shared as Response).status).toBe(404)
	})

	test('keeps a stored photo that a Recipe in another Household still shows', async () => {
		const user = await insertUser()
		const other = await insertUser()
		const household = await householdWith([{ userId: user.id, role: 'owner' }])
		const otherHousehold = await householdWith([
			{ userId: other.id, role: 'owner' },
		])
		await using photo = await storedObject(user.id, 'shared')
		for (const [householdId, userId] of [
			[household.id, user.id],
			[otherHousehold.id, other.id],
		] as const) {
			await prisma.recipe.create({
				data: {
					title: 'Copied',
					userId,
					householdId,
					image: { create: { objectKey: photo.objectKey } },
				},
			})
		}

		await deleteAccount(user.id)

		expect(await exists(photo.filePath)).toBe(true)
		expect(
			await prisma.recipeImage.count({
				where: { objectKey: photo.objectKey },
			}),
		).toBe(1)
	})

	test('a failing storage delete keeps the account deleted and is logged', async () => {
		const user = await insertUser()
		const household = await householdWith([{ userId: user.id, role: 'owner' }])
		await using photo = await storedObject(user.id, 'stuck')
		await prisma.recipe.create({
			data: {
				title: 'Pictured',
				userId: user.id,
				householdId: household.id,
				image: { create: { objectKey: photo.objectKey } },
			},
		})
		server.use(
			http.delete(
				`${process.env.AWS_ENDPOINT_URL_S3}/${process.env.BUCKET_NAME}/*`,
				() => new HttpResponse('Boom', { status: 500 }),
			),
		)
		consoleError.mockImplementation(() => {})

		await deleteAccount(user.id)

		expect(await prisma.user.count({ where: { id: user.id } })).toBe(0)
		expect(await prisma.household.count({ where: { id: household.id } })).toBe(
			0,
		)
		expect(await exists(photo.filePath)).toBe(true)
		expect(consoleError).toHaveBeenCalledWith(
			expect.stringContaining(photo.objectKey),
			expect.anything(),
		)
	})
})

describe('getAccountDeletionOutcome', () => {
	test('names the member who keeps the Household', async () => {
		const owner = await insertUser('Sam')
		const member = await insertUser()
		await householdWith([
			{ userId: owner.id, role: 'owner' },
			{ userId: member.id, role: 'member' },
		])

		expect(await getAccountDeletionOutcome(member.id)).toEqual({
			kind: 'household-stays',
			heirName: 'Sam',
		})
	})

	test('says the Household goes for a sole member', async () => {
		const user = await insertUser()
		await householdWith([{ userId: user.id, role: 'owner' }])

		expect(await getAccountDeletionOutcome(user.id)).toEqual({
			kind: 'household-deleted',
		})
	})
})
