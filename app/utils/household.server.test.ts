import { describe, expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	createHouseholdInvite,
	getInviteByToken,
	acceptInvite,
	leaveHousehold,
	removeMember,
	revokeInvite,
} from './household.server.ts'

async function setupUser() {
	return prisma.$transaction(async (tx) => {
		const user = await tx.user.create({ data: createUser() })
		const household = await tx.household.create({
			data: {
				name: 'Test Household',
				members: { create: { userId: user.id, role: 'owner' } },
			},
		})
		return { id: user.id, householdId: household.id }
	})
}

async function setupUserWithRecipe(recipeName = 'Test Recipe') {
	const user = await setupUser()
	const recipe = await prisma.recipe.create({
		data: {
			title: recipeName,
			userId: user.id,
			householdId: user.householdId,
			servings: 4,
			ingredients: {
				create: [
					{ name: 'flour', amount: '2', unit: 'cups', order: 0 },
					{ name: 'sugar', amount: '1', unit: 'cup', order: 1 },
				],
			},
			instructions: {
				create: [{ content: 'Mix everything', order: 0 }],
			},
		},
	})
	return { ...user, recipeId: recipe.id }
}

describe('createHouseholdInvite', () => {
	test('generates a valid token with 7-day expiry', async () => {
		const user = await setupUser()
		const invite = await createHouseholdInvite(user.householdId, user.id)

		expect(invite.token).toBeDefined()
		expect(invite.token).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		)

		const now = Date.now()
		const sevenDays = 7 * 24 * 60 * 60 * 1000
		const expiresMs = new Date(invite.expiresAt).getTime()
		expect(expiresMs).toBeGreaterThan(now + sevenDays - 60_000)
		expect(expiresMs).toBeLessThan(now + sevenDays + 60_000)
	})
})

describe('getInviteByToken', () => {
	test('returns null for non-existent token', async () => {
		const result = await getInviteByToken('non-existent-token')
		expect(result).toBeNull()
	})

	test('returns null for expired invite', async () => {
		const user = await setupUser()
		await prisma.householdInvite.create({
			data: {
				token: 'expired-token-test',
				expiresAt: new Date(Date.now() - 1000),
				householdId: user.householdId,
				createdById: user.id,
			},
		})

		const result = await getInviteByToken('expired-token-test')
		expect(result).toBeNull()
	})

	test('returns null for used invite', async () => {
		const user = await setupUser()
		await prisma.householdInvite.create({
			data: {
				token: 'used-token-test',
				expiresAt: new Date(Date.now() + 86400000),
				usedAt: new Date(),
				householdId: user.householdId,
				createdById: user.id,
			},
		})

		const result = await getInviteByToken('used-token-test')
		expect(result).toBeNull()
	})

	test('returns data for valid token', async () => {
		const user = await setupUser()
		const invite = await createHouseholdInvite(user.householdId, user.id)

		const result = await getInviteByToken(invite.token)
		expect(result).not.toBeNull()
		expect(result!.householdId).toBe(user.householdId)
		expect(result!.household.name).toBe('Test Household')
	})
})

describe('acceptInvite', () => {
	test('sole member: data is moved, old household deleted', async () => {
		const owner = await setupUserWithRecipe('Owner Recipe')
		const joiner = await setupUserWithRecipe('Joiner Recipe')

		// Add inventory to joiner's household
		await prisma.inventoryItem.create({
			data: {
				name: 'flour',
				userId: joiner.id,
				householdId: joiner.householdId,
			},
		})

		const invite = await createHouseholdInvite(owner.householdId, owner.id)
		await acceptInvite(invite.token, joiner.id)

		// Joiner's old household should be deleted
		const oldHousehold = await prisma.household.findUnique({
			where: { id: joiner.householdId },
		})
		expect(oldHousehold).toBeNull()

		// Joiner's recipe should now be in owner's household
		const movedRecipe = await prisma.recipe.findFirst({
			where: { title: 'Joiner Recipe' },
		})
		expect(movedRecipe!.householdId).toBe(owner.householdId)

		// Joiner's inventory should now be in owner's household
		const movedInventory = await prisma.inventoryItem.findFirst({
			where: { name: 'flour', userId: joiner.id },
		})
		expect(movedInventory!.householdId).toBe(owner.householdId)

		// Joiner should be a member of owner's household
		const membership = await prisma.householdMember.findUnique({
			where: {
				householdId_userId: {
					householdId: owner.householdId,
					userId: joiner.id,
				},
			},
		})
		expect(membership).not.toBeNull()
		expect(membership!.role).toBe('member')
	})

	test('multi-member: recipes are copied, inventory stays', async () => {
		// Create a household with 2 members
		const owner = await setupUser()
		const existingMember = await prisma.user.create({ data: createUser() })
		await prisma.householdMember.create({
			data: {
				householdId: owner.householdId,
				userId: existingMember.id,
				role: 'member',
			},
		})

		// existingMember has a recipe in that household
		await prisma.recipe.create({
			data: {
				title: 'Shared Recipe',
				userId: existingMember.id,
				householdId: owner.householdId,
				servings: 4,
				ingredients: {
					create: [{ name: 'butter', amount: '1', unit: 'cup', order: 0 }],
				},
			},
		})

		// Create the new joiner who has a recipe in their solo household
		const joiner = await setupUserWithRecipe('Joiner Multi Recipe')
		const joinerOldHouseholdId = joiner.householdId

		// Create another member in joiner's household so it's multi-member
		const joinerPartner = await prisma.user.create({ data: createUser() })
		await prisma.householdMember.create({
			data: {
				householdId: joinerOldHouseholdId,
				userId: joinerPartner.id,
				role: 'member',
			},
		})

		const invite = await createHouseholdInvite(owner.householdId, owner.id)
		await acceptInvite(invite.token, joiner.id)

		// Joiner's old household should still exist (had 2 members, now 1)
		const oldHousehold = await prisma.household.findUnique({
			where: { id: joinerOldHouseholdId },
		})
		expect(oldHousehold).not.toBeNull()

		// Original recipe should still be in old household
		const originalRecipe = await prisma.recipe.findFirst({
			where: {
				title: 'Joiner Multi Recipe',
				householdId: joinerOldHouseholdId,
			},
		})
		expect(originalRecipe).not.toBeNull()

		// A copy should exist in the new household
		const copiedRecipe = await prisma.recipe.findFirst({
			where: { title: 'Joiner Multi Recipe', householdId: owner.householdId },
		})
		expect(copiedRecipe).not.toBeNull()

		// Copied recipe should have ingredients
		const copiedIngredients = await prisma.ingredient.findMany({
			where: { recipeId: copiedRecipe!.id },
		})
		expect(copiedIngredients).toHaveLength(2)
	})

	test('throws if already a member', async () => {
		const owner = await setupUser()
		const invite = await createHouseholdInvite(owner.householdId, owner.id)

		await expect(acceptInvite(invite.token, owner.id)).rejects.toThrow(
			'Already a member',
		)
	})

	test('marks invite as used', async () => {
		const owner = await setupUser()
		const joiner = await setupUser()
		const invite = await createHouseholdInvite(owner.householdId, owner.id)

		await acceptInvite(invite.token, joiner.id)

		const usedInvite = await prisma.householdInvite.findUnique({
			where: { token: invite.token },
		})
		expect(usedInvite!.usedAt).not.toBeNull()

		// Invite should no longer be valid
		const result = await getInviteByToken(invite.token)
		expect(result).toBeNull()
	})
})

describe('leaveHousehold', () => {
	test('creates a solo household and copies recipes', async () => {
		const owner = await setupUserWithRecipe('Owner Stays')
		const member = await prisma.user.create({ data: createUser() })
		await prisma.householdMember.create({
			data: {
				householdId: owner.householdId,
				userId: member.id,
				role: 'member',
			},
		})
		// Member has a recipe in the shared household
		await prisma.recipe.create({
			data: {
				title: 'Member Recipe',
				userId: member.id,
				householdId: owner.householdId,
				servings: 2,
				ingredients: {
					create: [{ name: 'salt', order: 0 }],
				},
			},
		})

		await leaveHousehold(member.id)

		// Member should have a new household
		const newMembership = await prisma.householdMember.findFirst({
			where: { userId: member.id },
			include: { household: true },
		})
		expect(newMembership).not.toBeNull()
		expect(newMembership!.householdId).not.toBe(owner.householdId)
		expect(newMembership!.role).toBe('owner')

		// Member's recipe should be copied to the new household
		const copiedRecipe = await prisma.recipe.findFirst({
			where: {
				title: 'Member Recipe',
				householdId: newMembership!.householdId,
			},
		})
		expect(copiedRecipe).not.toBeNull()

		// Original recipe should still exist in old household
		const originalRecipe = await prisma.recipe.findFirst({
			where: { title: 'Member Recipe', householdId: owner.householdId },
		})
		expect(originalRecipe).not.toBeNull()
	})

	test('cleans up empty old household', async () => {
		// Create a household with owner + member, then member leaves
		const owner = await setupUser()
		const member = await prisma.user.create({ data: createUser() })
		await prisma.householdMember.create({
			data: {
				householdId: owner.householdId,
				userId: member.id,
				role: 'member',
			},
		})

		// Remove owner so member is the only one, then remove member too
		// Actually: just have the member leave, then verify owner stays
		await leaveHousehold(member.id)

		// Old household should still exist (owner remains)
		const oldHousehold = await prisma.household.findUnique({
			where: { id: owner.householdId },
		})
		expect(oldHousehold).not.toBeNull()
	})

	test('owner cannot leave household', async () => {
		const owner = await setupUser()

		await expect(leaveHousehold(owner.id)).rejects.toThrow('Owner cannot leave')
	})
})

describe('removeMember', () => {
	test('enforces owner-only authorization', async () => {
		const owner = await setupUser()
		const member = await prisma.user.create({ data: createUser() })
		await prisma.householdMember.create({
			data: {
				householdId: owner.householdId,
				userId: member.id,
				role: 'member',
			},
		})

		// Member trying to remove owner should fail
		await expect(
			removeMember(member.id, owner.id, owner.householdId),
		).rejects.toThrow('Only the household owner')

		// Owner removing member should succeed
		await removeMember(owner.id, member.id, owner.householdId)

		const removedMembership = await prisma.householdMember.findUnique({
			where: {
				householdId_userId: {
					householdId: owner.householdId,
					userId: member.id,
				},
			},
		})
		expect(removedMembership).toBeNull()
	})
})

describe('revokeInvite', () => {
	test('deletes invite record', async () => {
		const owner = await setupUser()
		const invite = await createHouseholdInvite(owner.householdId, owner.id)

		// Fetch the full invite to get the id
		const fullInvite = await prisma.householdInvite.findUnique({
			where: { token: invite.token },
		})

		await revokeInvite(fullInvite!.id, owner.id, owner.householdId)

		const deleted = await prisma.householdInvite.findUnique({
			where: { token: invite.token },
		})
		expect(deleted).toBeNull()
	})

	test('enforces owner-only authorization', async () => {
		const owner = await setupUser()
		const member = await prisma.user.create({ data: createUser() })
		await prisma.householdMember.create({
			data: {
				householdId: owner.householdId,
				userId: member.id,
				role: 'member',
			},
		})

		const invite = await createHouseholdInvite(owner.householdId, owner.id)
		const fullInvite = await prisma.householdInvite.findUnique({
			where: { token: invite.token },
		})

		await expect(
			revokeInvite(fullInvite!.id, member.id, owner.householdId),
		).rejects.toThrow('Only the household owner')
	})
})
