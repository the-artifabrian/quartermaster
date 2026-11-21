/**
 * Failure list for leaving a Household, by joining another or by leaving:
 *
 * 1. The owner of a two-member Household joins another. The member left
 *    behind must become owner, or the Household has nobody who can invite,
 *    rename or remove.
 * 2. The owner of a three-member Household joins another. The longest-standing
 *    remaining member becomes owner, by join time and not by row id, and the
 *    other stays a member.
 * 3. A member who isn't the owner joins another Household. Nobody's role
 *    changes.
 * 4. A sole owner joins another Household. Their Recipes, Shopping and Plan
 *    move with them, and the old Household goes with nothing left behind on a
 *    missing Household. A moved Recipe's photo, also shown by a copy in a third
 *    Household, keeps its file and both image rows.
 * 5. The last member of a Household leaves (one left without an owner by an
 *    earlier join). The Household dissolves: its Recipes, including a departed
 *    member's, its Shopping list, Plan and Menus are deleted, not left behind
 *    without a Household. A photo only a deleted Recipe showed is removed from
 *    storage; one the leaver's copy still shows stays.
 * 6. A member leaves a Household that already has no owner, with others still
 *    in it. The longest-standing remaining member becomes owner.
 * 7. A share link to a Recipe of a dissolved Household answers 404.
 * 8. A member starts leaving while the owner joins another Household. Whichever
 *    commits first, no Household is left without an owner or without members,
 *    nothing is left without a Household, and no Recipe is lost. The leave is
 *    refused when the member has become owner by then, so it can't act on the
 *    role it read before the join.
 * 9. Both members of a two-member Household join other Households at once.
 *    The old Household goes, and nothing is left without a Household.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { loader as shareLoader } from '#app/routes/share.$recipeId.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import '#tests/setup/mocks-setup.ts'
import { createWalDatabase, settlesWithin } from '#tests/sqlite-concurrency.ts'
import { BASE_URL } from '#tests/utils.ts'
import { acceptInvite, leaveHousehold } from './household.server.ts'
import '#tests/setup/db-setup.ts'

const UPLOADS_DIR = path.join(process.cwd(), 'tests/fixtures/uploaded')

async function insertUser(db: PrismaClient = prisma) {
	return db.user.create({ data: createUser(), select: { id: true } })
}

type Member = {
	userId: string
	role: 'owner' | 'member'
	joinedMinutesAgo: number
}

async function householdWith(members: Member[], db: PrismaClient = prisma) {
	return db.household.create({
		data: {
			name: 'Home',
			members: {
				create: members.map(({ userId, role, joinedMinutesAgo }) => ({
					userId,
					role,
					createdAt: new Date(Date.now() - joinedMinutesAgo * 60_000),
				})),
			},
		},
		select: { id: true },
	})
}

async function inviteTo(
	householdId: string,
	createdById: string,
	db: PrismaClient = prisma,
) {
	const invite = await db.householdInvite.create({
		data: {
			token: crypto.randomUUID(),
			expiresAt: new Date(Date.now() + 86_400_000),
			householdId,
			createdById,
		},
		select: { token: true },
	})
	return invite.token
}

function rolesIn(householdId: string, db: PrismaClient = prisma) {
	return db.householdMember.findMany({
		where: { householdId },
		select: { userId: true, role: true },
		orderBy: { createdAt: 'asc' },
	})
}

function membershipsOf(userId: string, db: PrismaClient = prisma) {
	return db.householdMember.findMany({
		where: { userId },
		select: { householdId: true, role: true },
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

/**
 * Every Household has members and an owner, and no Recipe or Shopping list
 * is left without a Household.
 */
async function expectNothingLeftBehind(db: PrismaClient = prisma) {
	const households = await db.household.findMany({
		select: { id: true, members: { select: { role: true } } },
	})
	// A Household with no members has no owner either.
	const withoutOwner = households
		.filter((household) => !household.members.some((m) => m.role === 'owner'))
		.map((household) => household.id)
	expect(withoutOwner).toEqual([])
	expect(await db.recipe.count({ where: { householdId: null } })).toBe(0)
	expect(await db.shoppingList.count({ where: { householdId: null } })).toBe(0)
}

/**
 * `db`, but the first membership read waits for `during` before it returns,
 * whether it runs inside a transaction or not.
 */
function pauseAfterFirstMembershipRead(
	db: PrismaClient,
	during: () => Promise<unknown>,
) {
	let paused = false
	const bind = (target: object, key: string | symbol) => {
		const value: unknown = Reflect.get(target, key, target)
		return typeof value === 'function' ? value.bind(target) : value
	}
	const members = (delegate: object) =>
		new Proxy(delegate, {
			get(target, method) {
				if (method !== 'findFirst' && method !== 'findUnique') {
					return bind(target, method)
				}
				const read = bind(target, method) as (args: unknown) => unknown
				return async (args: unknown) => {
					const found = await read(args)
					if (!paused) {
						paused = true
						await during()
					}
					return found
				}
			},
		})
	const wrap = <T extends object>(client: T): T =>
		new Proxy(client, {
			get(target, key) {
				if (key === 'householdMember') {
					return members(Reflect.get(target, key, target) as object)
				}
				if (key === '$transaction') {
					const transaction = bind(target, key) as (
						work: (tx: object) => Promise<unknown>,
					) => Promise<unknown>
					return (work: (tx: object) => Promise<unknown>) =>
						transaction((tx) => work(wrap(tx)))
				}
				return bind(target, key)
			},
		})
	return wrap(db)
}

describe('an owner joining another Household', () => {
	test('from a two-member Household, the member left behind becomes owner', async () => {
		const owner = await insertUser()
		const member = await insertUser()
		const host = await insertUser()
		const home = await householdWith([
			{ userId: owner.id, role: 'owner', joinedMinutesAgo: 60 },
			{ userId: member.id, role: 'member', joinedMinutesAgo: 30 },
		])
		const elsewhere = await householdWith([
			{ userId: host.id, role: 'owner', joinedMinutesAgo: 60 },
		])

		await acceptInvite(await inviteTo(elsewhere.id, host.id), owner.id)

		expect(await rolesIn(home.id)).toEqual([
			{ userId: member.id, role: 'owner' },
		])
		expect(await membershipsOf(owner.id)).toEqual([
			{ householdId: elsewhere.id, role: 'member' },
		])
		await expectNothingLeftBehind()
	})

	test('from a three-member Household, the longest-standing member becomes owner', async () => {
		const owner = await insertUser()
		const newer = await insertUser()
		const older = await insertUser()
		const host = await insertUser()
		// The newer member's row goes in first, so row order and join order
		// disagree.
		const home = await householdWith([
			{ userId: owner.id, role: 'owner', joinedMinutesAgo: 60 },
			{ userId: newer.id, role: 'member', joinedMinutesAgo: 10 },
			{ userId: older.id, role: 'member', joinedMinutesAgo: 30 },
		])
		const elsewhere = await householdWith([
			{ userId: host.id, role: 'owner', joinedMinutesAgo: 60 },
		])

		await acceptInvite(await inviteTo(elsewhere.id, host.id), owner.id)

		expect(await rolesIn(home.id)).toEqual([
			{ userId: older.id, role: 'owner' },
			{ userId: newer.id, role: 'member' },
		])
		await expectNothingLeftBehind()
	})

	test('a sole owner takes everything along and leaves nothing behind', async () => {
		const owner = await insertUser()
		const host = await insertUser()
		const other = await insertUser()
		const home = await householdWith([
			{ userId: owner.id, role: 'owner', joinedMinutesAgo: 60 },
		])
		const elsewhere = await householdWith([
			{ userId: host.id, role: 'owner', joinedMinutesAgo: 60 },
		])
		const third = await householdWith([
			{ userId: other.id, role: 'owner', joinedMinutesAgo: 60 },
		])
		await using photo = await storedObject(owner.id, 'moved')
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Bean stew',
				userId: owner.id,
				householdId: home.id,
				image: { create: { objectKey: photo.objectKey } },
			},
		})
		// A copy saved before share links copied bytes shows the same file.
		await prisma.recipe.create({
			data: {
				title: 'Bean stew',
				userId: other.id,
				householdId: third.id,
				image: { create: { objectKey: photo.objectKey } },
			},
		})
		const list = await prisma.shoppingList.create({
			data: {
				userId: owner.id,
				householdId: home.id,
				items: { create: { name: 'Beans' } },
			},
		})
		const plan = await prisma.mealPlan.create({
			data: {
				householdId: home.id,
				weekStart: new Date('2026-11-16T00:00:00.000Z'),
			},
		})

		await acceptInvite(await inviteTo(elsewhere.id, host.id), owner.id)

		expect(await prisma.household.count({ where: { id: home.id } })).toBe(0)
		expect(
			await prisma.recipe.findUniqueOrThrow({
				where: { id: recipe.id },
				select: { householdId: true },
			}),
		).toEqual({ householdId: elsewhere.id })
		expect(
			await prisma.shoppingList.findUniqueOrThrow({
				where: { id: list.id },
				select: { householdId: true },
			}),
		).toEqual({ householdId: elsewhere.id })
		expect(
			await prisma.mealPlan.findUniqueOrThrow({
				where: { id: plan.id },
				select: { householdId: true },
			}),
		).toEqual({ householdId: elsewhere.id })
		expect(await exists(photo.filePath)).toBe(true)
		expect(
			await prisma.recipeImage.count({ where: { objectKey: photo.objectKey } }),
		).toBe(2)
		await expectNothingLeftBehind()
	})
})

describe('a member joining another Household', () => {
	test('changes nobody’s role', async () => {
		const owner = await insertUser()
		const leaving = await insertUser()
		const staying = await insertUser()
		const host = await insertUser()
		const home = await householdWith([
			{ userId: owner.id, role: 'owner', joinedMinutesAgo: 60 },
			{ userId: leaving.id, role: 'member', joinedMinutesAgo: 30 },
			{ userId: staying.id, role: 'member', joinedMinutesAgo: 10 },
		])
		const elsewhere = await householdWith([
			{ userId: host.id, role: 'owner', joinedMinutesAgo: 60 },
		])

		await acceptInvite(await inviteTo(elsewhere.id, host.id), leaving.id)

		expect(await rolesIn(home.id)).toEqual([
			{ userId: owner.id, role: 'owner' },
			{ userId: staying.id, role: 'member' },
		])
		expect(await rolesIn(elsewhere.id)).toEqual([
			{ userId: host.id, role: 'owner' },
			{ userId: leaving.id, role: 'member' },
		])
		await expectNothingLeftBehind()
	})
})

describe('leaving a Household', () => {
	test('the last member leaving dissolves it, Recipes, photos and Shopping included', async () => {
		const last = await insertUser()
		const departed = await insertUser()
		// An earlier join left this Household without an owner.
		const home = await householdWith([
			{ userId: last.id, role: 'member', joinedMinutesAgo: 30 },
		])
		await using ownPhoto = await storedObject(last.id, 'own')
		await using departedPhoto = await storedObject(departed.id, 'departed')
		const own = await prisma.recipe.create({
			data: {
				title: 'Mine',
				userId: last.id,
				householdId: home.id,
				image: { create: { objectKey: ownPhoto.objectKey } },
			},
		})
		const theirs = await prisma.recipe.create({
			data: {
				title: 'Theirs',
				userId: departed.id,
				householdId: home.id,
				image: { create: { objectKey: departedPhoto.objectKey } },
			},
		})
		const list = await prisma.shoppingList.create({
			data: {
				userId: departed.id,
				householdId: home.id,
				items: { create: { name: 'Eggs' } },
			},
		})
		await prisma.mealPlan.create({
			data: {
				householdId: home.id,
				weekStart: new Date('2026-11-16T00:00:00.000Z'),
			},
		})
		await prisma.menu.create({
			data: { title: 'Sunday', titleKey: 'sunday', householdId: home.id },
		})

		await leaveHousehold(last.id)

		const where = { householdId: home.id }
		expect(await prisma.household.count({ where: { id: home.id } })).toBe(0)
		expect(
			await prisma.recipe.count({ where: { id: { in: [own.id, theirs.id] } } }),
		).toBe(0)
		expect(await prisma.shoppingList.count({ where: { id: list.id } })).toBe(0)
		expect(await prisma.mealPlan.count({ where })).toBe(0)
		expect(await prisma.menu.count({ where })).toBe(0)
		// The leaver's copy still shows their photo; nothing shows the other.
		const [newHome] = await membershipsOf(last.id)
		expect(
			await prisma.recipe.findFirstOrThrow({
				where: { householdId: newHome!.householdId },
				select: { title: true, image: { select: { objectKey: true } } },
			}),
		).toEqual({ title: 'Mine', image: { objectKey: ownPhoto.objectKey } })
		expect(await exists(ownPhoto.filePath)).toBe(true)
		expect(await exists(departedPhoto.filePath)).toBe(false)
		expect(
			await prisma.recipeImage.count({
				where: {
					objectKey: { in: [ownPhoto.objectKey, departedPhoto.objectKey] },
				},
			}),
		).toBe(1)
		await expectNothingLeftBehind()
	})

	test('leaving a Household with no owner makes the longest-standing member owner', async () => {
		const leaving = await insertUser()
		const newer = await insertUser()
		const older = await insertUser()
		const home = await householdWith([
			{ userId: leaving.id, role: 'member', joinedMinutesAgo: 60 },
			{ userId: newer.id, role: 'member', joinedMinutesAgo: 10 },
			{ userId: older.id, role: 'member', joinedMinutesAgo: 30 },
		])

		await leaveHousehold(leaving.id)

		expect(await rolesIn(home.id)).toEqual([
			{ userId: older.id, role: 'owner' },
			{ userId: newer.id, role: 'member' },
		])
		await expectNothingLeftBehind()
	})

	test('a share link to a Recipe of a dissolved Household is a 404', async () => {
		const last = await insertUser()
		const departed = await insertUser()
		const home = await householdWith([
			{ userId: last.id, role: 'member', joinedMinutesAgo: 30 },
		])
		const recipe = await prisma.recipe.create({
			data: { title: 'Theirs', userId: departed.id, householdId: home.id },
		})

		await leaveHousehold(last.id)

		const shared = await shareLoader({
			params: { recipeId: recipe.id },
			context: new RouterContextProvider(),
			pattern: '/share/:recipeId',
			url: new URL(`${BASE_URL}/share/${recipe.id}`),
			request: new Request(`${BASE_URL}/share/${recipe.id}`),
		}).catch((error: unknown) => error)
		expect(shared).toBeInstanceOf(Response)
		expect((shared as Response).status).toBe(404)
	})
})

describe('two people leaving at once', () => {
	test('a member leaving while the owner joins elsewhere leaves an owner, or nothing', async () => {
		await using database = await createWalDatabase()
		const { db } = database
		const owner = await insertUser(db)
		const member = await insertUser(db)
		const host = await insertUser(db)
		const home = await householdWith(
			[
				{ userId: owner.id, role: 'owner', joinedMinutesAgo: 60 },
				{ userId: member.id, role: 'member', joinedMinutesAgo: 30 },
			],
			db,
		)
		const elsewhere = await householdWith(
			[{ userId: host.id, role: 'owner', joinedMinutesAgo: 60 }],
			db,
		)
		const soup = await db.recipe.create({
			data: { title: 'Soup', userId: owner.id, householdId: home.id },
		})
		await db.shoppingList.create({
			data: { userId: owner.id, householdId: home.id },
		})
		const token = await inviteTo(elsewhere.id, host.id, db)

		// The owner's join starts once the leave has read the member's role.
		// It gets 300 ms to finish before the leave carries on.
		let joining: Promise<unknown> = Promise.resolve()
		const paused = pauseAfterFirstMembershipRead(db, async () => {
			joining = acceptInvite(token, owner.id, db)
			await settlesWithin(joining, 300)
		})
		const left = await leaveHousehold(member.id, paused).then(
			() => true,
			(error: Error) => error.message,
		)
		await joining

		// The leave may be refused if the member became owner first.
		expect([true, 'Owner cannot leave the household']).toContain(left)
		await expectNothingLeftBehind(db)
		for (const user of [owner, member, host]) {
			expect(await membershipsOf(user.id, db)).toHaveLength(1)
		}
		expect(await membershipsOf(owner.id, db)).toEqual([
			{ householdId: elsewhere.id, role: 'member' },
		])
		// In either order the original Recipe survives: it moves with a sole
		// owner, or stays with the member who became owner. Deleting it means
		// the leave acted on a role it read before the join.
		expect(await db.recipe.count({ where: { id: soup.id } })).toBe(1)
	})

	test('both members of a two-member Household joining elsewhere at once leave nothing behind', async () => {
		await using database = await createWalDatabase()
		const { db } = database
		const owner = await insertUser(db)
		const member = await insertUser(db)
		const firstHost = await insertUser(db)
		const secondHost = await insertUser(db)
		const home = await householdWith(
			[
				{ userId: owner.id, role: 'owner', joinedMinutesAgo: 60 },
				{ userId: member.id, role: 'member', joinedMinutesAgo: 30 },
			],
			db,
		)
		const [first, second] = await Promise.all(
			[firstHost, secondHost].map((host) =>
				householdWith(
					[{ userId: host.id, role: 'owner', joinedMinutesAgo: 60 }],
					db,
				),
			),
		)
		await db.recipe.create({
			data: { title: 'Soup', userId: owner.id, householdId: home.id },
		})
		await db.shoppingList.create({
			data: { userId: member.id, householdId: home.id },
		})
		const ownerToken = await inviteTo(first!.id, firstHost.id, db)
		const memberToken = await inviteTo(second!.id, secondHost.id, db)

		let memberJoining: Promise<unknown> = Promise.resolve()
		const paused = pauseAfterFirstMembershipRead(db, async () => {
			memberJoining = acceptInvite(memberToken, member.id, db)
			await settlesWithin(memberJoining, 300)
		})
		await acceptInvite(ownerToken, owner.id, paused)
		await memberJoining

		expect(await db.household.count({ where: { id: home.id } })).toBe(0)
		expect(await membershipsOf(owner.id, db)).toEqual([
			{ householdId: first!.id, role: 'member' },
		])
		expect(await membershipsOf(member.id, db)).toEqual([
			{ householdId: second!.id, role: 'member' },
		])
		await expectNothingLeftBehind(db)
	})
})
