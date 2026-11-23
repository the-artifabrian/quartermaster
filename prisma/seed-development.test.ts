/**
 * `prisma db seed` gives a fresh clone two people to log in as: the owner of
 * the sample Household, and a second user with an empty Household of their
 * own for trying invites and joins.
 *
 * Failure list:
 * - A seeded user can't log in with the password the README gives.
 * - The README names a username or password the seed doesn't use.
 * - The owner is missing the admin role or Pro.
 * - A second seed adds another user, another Household or another
 *   membership, or a second copy of the sample Recipes.
 * - The second user lands in the sample Household, or theirs isn't empty.
 * - The seed runs against production (on Fly, or with NODE_ENV=production)
 *   and creates an admin whose password the public README gives.
 * - Once the owner has also joined another Household, a second seed fills
 *   that one, because it picked the owner's oldest membership instead of
 *   the Household they own.
 */
import fs from 'node:fs/promises'
import { expect, test, vi } from 'vitest'
import { verifyUserPassword } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { SAMPLE_HOUSEHOLD } from '#app/utils/sample-household-data.ts'
import { getUserTier } from '#app/utils/subscription.server.ts'
import { seedInfrastructure } from './seed-infrastructure.ts'
import {
	SAMPLE_PASSWORD,
	SAMPLE_OWNER,
	SECOND_USER,
	seedDevelopment,
} from './seed-development.ts'
import '#tests/setup/db-setup.ts'

const TODAY = '2026-11-26'

async function seed() {
	await seedInfrastructure()
	await seedDevelopment(prisma, { today: TODAY })
}

async function membership(username: string) {
	const user = await prisma.user.findUniqueOrThrow({
		where: { username },
		select: {
			roles: { select: { name: true }, orderBy: { name: 'asc' } },
			householdMembers: {
				select: {
					role: true,
					household: { select: { id: true, _count: true } },
				},
			},
		},
	})
	return user
}

test('the README’s logins work, and the owner is an admin on Pro', async () => {
	await seed()
	const readme = await fs.readFile('README.md', 'utf8')

	for (const person of [SAMPLE_OWNER, SECOND_USER]) {
		expect(readme).toContain(`\`${person.username}\``)
		expect(
			await verifyUserPassword({ username: person.username }, SAMPLE_PASSWORD),
		).not.toBeNull()
	}
	expect(readme).toContain(`\`${SAMPLE_PASSWORD}\``)

	const owner = await membership(SAMPLE_OWNER.username)
	expect(owner.roles.map((role) => role.name)).toEqual(['admin', 'user'])
	const ownerRow = await prisma.user.findUniqueOrThrow({
		where: { username: SAMPLE_OWNER.username },
	})
	expect((await getUserTier(ownerRow.id)).tier).toBe('pro')
	expect(owner.householdMembers).toHaveLength(1)
	expect(owner.householdMembers[0]!.role).toBe('owner')
	expect(owner.householdMembers[0]!.household._count.recipes).toBe(
		SAMPLE_HOUSEHOLD.recipes.length,
	)

	const second = await membership(SECOND_USER.username)
	expect(second.roles.map((role) => role.name)).toEqual(['user'])
	expect(second.householdMembers).toHaveLength(1)
	expect(second.householdMembers[0]!.role).toBe('owner')
	expect(second.householdMembers[0]!.household.id).not.toBe(
		owner.householdMembers[0]!.household.id,
	)
	expect(second.householdMembers[0]!.household._count).toMatchObject({
		recipes: 0,
		mealPlans: 0,
		shoppingLists: 0,
		householdIngredients: 0,
	})
})

test('seeding twice keeps one of each user, Household and Recipe', async () => {
	await seed()
	await seed()

	expect(await prisma.user.count()).toBe(2)
	expect(await prisma.household.count()).toBe(2)
	expect(await prisma.householdMember.count()).toBe(2)
	expect(await prisma.subscription.count()).toBe(2)
	expect(await prisma.recipe.count()).toBe(SAMPLE_HOUSEHOLD.recipes.length)
	expect(await prisma.meal.count()).toBe(SAMPLE_HOUSEHOLD.plan.length)
})

test('it refuses to run in production or on Fly, and writes nothing', async () => {
	await seedInfrastructure()
	for (const [name, value] of [
		['NODE_ENV', 'production'],
		['FLY', 'true'],
	] as const) {
		vi.stubEnv(name, value)
		try {
			await expect(seedDevelopment(prisma, { today: TODAY })).rejects.toThrow(
				/local database/,
			)
		} finally {
			vi.unstubAllEnvs()
		}
	}
	expect(await prisma.user.count()).toBe(0)
	expect(await prisma.household.count()).toBe(0)
})

test('a second seed fills the Household the owner owns, not one they joined', async () => {
	await seed()
	const robin = await membership(SECOND_USER.username)
	const robinsHousehold = robin.householdMembers[0]!.household.id
	const sam = await prisma.user.findUniqueOrThrow({
		where: { username: SAMPLE_OWNER.username },
	})
	// Joined before Sam's own membership, so it is Sam's oldest.
	await prisma.householdMember.create({
		data: {
			userId: sam.id,
			householdId: robinsHousehold,
			role: 'member',
			createdAt: new Date('2020-01-01'),
		},
	})

	await seed()

	const counts = await prisma.household.findUniqueOrThrow({
		where: { id: robinsHousehold },
		select: { _count: true },
	})
	expect(counts._count).toMatchObject({
		recipes: 0,
		mealPlans: 0,
		householdIngredients: 0,
	})
	expect(await prisma.recipe.count()).toBe(SAMPLE_HOUSEHOLD.recipes.length)
})
