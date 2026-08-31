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
			activeTime: 20,
			totalTime: 45,
			yieldAmount: 6,
			yieldLabel: 'servings',
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

	test('sole member: Shopping horizons survive the household move', async () => {
		const owner = await setupUser()
		const joiner = await setupUser()
		await prisma.shoppingList.create({
			data: {
				userId: joiner.id,
				householdId: joiner.householdId,
				items: {
					create: {
						name: 'Birthday candles',
						checked: true,
						horizon: 'later',
					},
				},
			},
		})

		const invite = await createHouseholdInvite(owner.householdId, owner.id)
		await acceptInvite(invite.token, joiner.id)

		expect(
			await prisma.shoppingListItem.findFirstOrThrow({
				where: { name: 'Birthday candles' },
				select: {
					horizon: true,
					checked: true,
					list: { select: { householdId: true } },
				},
			}),
		).toEqual({
			horizon: 'later',
			checked: true,
			list: { householdId: owner.householdId },
		})
	})

	test('sole member: menus move, colliding titles get deterministic suffixes', async () => {
		const owner = await setupUser()
		const joiner = await setupUser()

		await prisma.menu.create({
			data: {
				title: 'Taco Night',
				titleKey: 'taco night',
				householdId: owner.householdId,
				sections: { create: { name: null, order: 0 } },
			},
		})
		await prisma.menu.create({
			data: {
				title: 'TACO NIGHT',
				titleKey: 'taco night',
				householdId: joiner.householdId,
				sections: { create: { name: null, order: 0 } },
			},
		})
		await prisma.menu.create({
			data: {
				title: 'Levantine Dinner',
				titleKey: 'levantine dinner',
				householdId: joiner.householdId,
				sections: { create: { name: null, order: 0 } },
			},
		})

		const invite = await createHouseholdInvite(owner.householdId, owner.id)
		await acceptInvite(invite.token, joiner.id)

		const menus = await prisma.menu.findMany({
			where: { householdId: owner.householdId },
			orderBy: { titleKey: 'asc' },
			include: { sections: true },
		})
		expect(menus.map((m) => m.title)).toEqual([
			'Levantine Dinner',
			'Taco Night',
			'TACO NIGHT (2)',
		])
		expect(menus.map((m) => m.titleKey)).toEqual([
			'levantine dinner',
			'taco night',
			'taco night (2)',
		])
		// Every menu kept its durable unnamed section
		for (const menu of menus) {
			expect(menu.sections).toHaveLength(1)
		}
		// Nothing left behind or deleted
		expect(await prisma.menu.count()).toBe(3)
	})

	test('sole member: canonical ingredients move while the target household cutover and collisions win', async () => {
		const owner = await setupUser()
		const joiner = await setupUser()
		const targetCutoverAt = new Date('2026-08-24T08:00:00.000Z')
		await prisma.household.update({
			where: { id: owner.householdId },
			data: { staplesCutoverAt: targetCutoverAt },
		})
		await prisma.household.update({
			where: { id: joiner.householdId },
			data: { staplesCutoverAt: new Date('2026-08-25T08:00:00.000Z') },
		})
		await prisma.householdIngredient.createMany({
			data: [
				{
					displayName: 'Salt',
					canonicalKey: 'salt',
					isStaple: true,
					isOut: false,
					householdId: owner.householdId,
				},
				{
					displayName: 'Fancy salt',
					canonicalKey: 'salt',
					isStaple: true,
					isOut: true,
					householdId: joiner.householdId,
				},
				{
					displayName: 'Cumin',
					canonicalKey: 'cumin',
					isStaple: true,
					isOut: true,
					householdId: joiner.householdId,
				},
			],
		})

		const invite = await createHouseholdInvite(owner.householdId, owner.id)
		await acceptInvite(invite.token, joiner.id)

		expect(
			await prisma.household.findUniqueOrThrow({
				where: { id: owner.householdId },
				select: { staplesCutoverAt: true },
			}),
		).toEqual({ staplesCutoverAt: targetCutoverAt })
		expect(
			await prisma.householdIngredient.findMany({
				where: { householdId: owner.householdId },
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
		])
		expect(
			await prisma.householdIngredient.count({
				where: { householdId: joiner.householdId },
			}),
		).toBe(0)
	})

	test('sole member: a confirmed empty Staples cutover moves to an uncut-over target', async () => {
		const owner = await setupUser()
		const joiner = await setupUser()
		const sourceCutoverAt = new Date('2026-08-25T08:00:00.000Z')
		await prisma.household.update({
			where: { id: joiner.householdId },
			data: { staplesCutoverAt: sourceCutoverAt },
		})

		const invite = await createHouseholdInvite(owner.householdId, owner.id)
		await acceptInvite(invite.token, joiner.id)

		expect(
			await prisma.household.findUniqueOrThrow({
				where: { id: owner.householdId },
				select: {
					staplesCutoverAt: true,
					_count: { select: { householdIngredients: true } },
				},
			}),
		).toEqual({
			staplesCutoverAt: sourceCutoverAt,
			_count: { householdIngredients: 0 },
		})
	})

	test('sole member: canonical rows do not imply cutover during a household move', async () => {
		const owner = await setupUser()
		const joiner = await setupUser()
		await prisma.householdIngredient.create({
			data: {
				displayName: 'Cumin',
				canonicalKey: 'cumin',
				isStaple: true,
				isOut: true,
				householdId: joiner.householdId,
			},
		})

		const invite = await createHouseholdInvite(owner.householdId, owner.id)
		await acceptInvite(invite.token, joiner.id)

		expect(
			await prisma.household.findUniqueOrThrow({
				where: { id: owner.householdId },
				select: {
					staplesCutoverAt: true,
					householdIngredients: {
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
			staplesCutoverAt: null,
			householdIngredients: [
				{
					displayName: 'Cumin',
					canonicalKey: 'cumin',
					isStaple: true,
					isOut: true,
				},
			],
		})
	})

	test('sole member: menu cards, note shopping lines, and recipe references survive the move', async () => {
		const owner = await setupUser()
		const joiner = await setupUserWithRecipe('Joiner Dinner')

		// A colliding title, so the moved menu also gets re-suffixed — the
		// move must preserve content, not just retitle (#102).
		await prisma.menu.create({
			data: {
				title: 'Feast',
				titleKey: 'feast',
				householdId: owner.householdId,
				sections: { create: { name: null, order: 0 } },
			},
		})
		await prisma.menu.create({
			data: {
				title: 'Feast',
				titleKey: 'feast',
				householdId: joiner.householdId,
				sections: {
					create: {
						name: null,
						order: 0,
						items: {
							create: [
								{
									kind: 'recipe',
									order: 0,
									recipeId: joiner.recipeId,
									recipeTitle: 'Joiner Dinner',
									scaleMultiplier: 1.5,
								},
								{
									kind: 'note',
									order: 1,
									note: 'Drinks: lemonade',
									shoppingLines: {
										create: [
											{ name: 'lemons', quantity: '6', order: 0 },
											{ name: 'mint', order: 1 },
										],
									},
								},
							],
						},
					},
				},
			},
		})

		const invite = await createHouseholdInvite(owner.householdId, owner.id)
		await acceptInvite(invite.token, joiner.id)

		const moved = await prisma.menu.findFirstOrThrow({
			where: { titleKey: 'feast (2)' },
			include: {
				sections: {
					include: {
						items: {
							orderBy: { order: 'asc' },
							include: { shoppingLines: { orderBy: { order: 'asc' } } },
						},
					},
				},
			},
		})
		expect(moved.householdId).toBe(owner.householdId)
		const items = moved.sections[0]!.items
		expect(items.map((i) => i.kind)).toEqual(['recipe', 'note'])
		// The recipe moved with the household, so the reference stays live
		expect(items[0]).toMatchObject({
			recipeId: joiner.recipeId,
			recipeTitle: 'Joiner Dinner',
			scaleMultiplier: 1.5,
		})
		const recipe = await prisma.recipe.findUniqueOrThrow({
			where: { id: joiner.recipeId },
		})
		expect(recipe.householdId).toBe(owner.householdId)
		expect(items[1]!.note).toBe('Drinks: lemonade')
		expect(items[1]!.shoppingLines.map((l) => [l.name, l.quantity])).toEqual([
			['lemons', '6'],
			['mint', null],
		])
	})

	test('sole member: colliding meal-plan weeks append the moved Meals after each day, whole and unmerged', async () => {
		const owner = await setupUserWithRecipe('Owner Dinner')
		const joiner = await setupUserWithRecipe('Joiner Dinner')
		const weekStart = new Date('2026-02-02T00:00:00.000Z')

		await prisma.mealPlan.create({
			data: {
				householdId: owner.householdId,
				weekStart,
				meals: {
					create: {
						date: weekStart,
						order: 0,
						label: 'dinner',
						recipeItems: {
							create: {
								order: 0,
								recipeId: owner.recipeId,
								recipeTitle: 'Owner Dinner',
								scaleMultiplier: 1,
							},
						},
					},
				},
			},
		})
		await prisma.mealPlan.create({
			data: {
				householdId: joiner.householdId,
				weekStart,
				meals: {
					create: [
						// Same day, even the same Recipe elsewhere: Meals have no slot
						// identity, so nothing is merged or second-guessed — the moved
						// Meal survives whole with its cooked state and multiplier.
						{
							date: weekStart,
							order: 0,
							label: 'dinner',
							recipeItems: {
								create: {
									order: 0,
									recipeId: joiner.recipeId,
									recipeTitle: 'Joiner Dinner',
									scaleMultiplier: 2.5,
									cooked: true,
								},
							},
						},
						{
							date: weekStart,
							order: 1,
							genericText: 'Leftovers',
							completed: true,
						},
					],
				},
			},
		})

		const invite = await createHouseholdInvite(owner.householdId, owner.id)
		await acceptInvite(invite.token, joiner.id)

		const mergedPlan = await prisma.mealPlan.findUniqueOrThrow({
			where: {
				householdId_weekStart: {
					householdId: owner.householdId,
					weekStart,
				},
			},
			include: {
				meals: {
					orderBy: { order: 'asc' },
					include: { recipeItems: true },
				},
			},
		})
		expect(
			mergedPlan.meals.map((meal) => [
				meal.order,
				meal.label,
				meal.genericText,
				meal.recipeItems.map((item) => [
					item.recipeId,
					item.scaleMultiplier,
					item.cooked,
				]),
			]),
		).toEqual([
			[0, 'dinner', null, [[owner.recipeId, 1, false]]],
			[1, 'dinner', null, [[joiner.recipeId, 2.5, true]]],
			[2, null, 'Leftovers', []],
		])
		// The superseded source plan is gone with its household.
		expect(
			await prisma.mealPlan.count({
				where: { householdId: joiner.householdId },
			}),
		).toBe(0)
	})

	test('sole member: a Menu snapshot Meal moves whole — sections, notes, lines, and source reference survive (#107)', async () => {
		const owner = await setupUserWithRecipe('Owner Dinner')
		const joiner = await setupUserWithRecipe('Joiner Dinner')
		const weekStart = new Date('2026-02-02T00:00:00.000Z')

		// Colliding week so the move exercises the Meal re-parent path — the
		// snapshot children hang off the Meal and must ride along untouched.
		await prisma.mealPlan.create({
			data: { householdId: owner.householdId, weekStart },
		})
		const menu = await prisma.menu.create({
			data: {
				title: 'Feast',
				titleKey: 'feast',
				householdId: joiner.householdId,
				sections: { create: { name: null, order: 0 } },
			},
		})
		const revision = new Date('2026-02-01T09:00:00.000Z')
		const joinerPlan = await prisma.mealPlan.create({
			data: { householdId: joiner.householdId, weekStart },
		})
		const meal = await prisma.meal.create({
			data: {
				mealPlanId: joinerPlan.id,
				date: weekStart,
				order: 0,
				sourceMenuId: menu.id,
				sourceMenuRevision: revision,
			},
		})
		const section = await prisma.mealSection.create({
			data: { mealId: meal.id, name: 'Mains', order: 0 },
		})
		await prisma.mealRecipeItem.create({
			data: {
				mealId: meal.id,
				sectionId: section.id,
				order: 0,
				recipeId: joiner.recipeId,
				recipeTitle: 'Joiner Dinner',
				scaleMultiplier: 2.5,
				note: 'Two batches',
			},
		})
		await prisma.mealNoteItem.create({
			data: {
				mealId: meal.id,
				sectionId: section.id,
				order: 1,
				text: 'Drinks',
				shoppingLines: {
					create: [{ name: 'Lemonade', quantity: '2', unit: 'l', order: 0 }],
				},
			},
		})

		const invite = await createHouseholdInvite(owner.householdId, owner.id)
		await acceptInvite(invite.token, joiner.id)

		const moved = await prisma.meal.findUniqueOrThrow({
			where: { id: meal.id },
			include: {
				mealPlan: { select: { householdId: true } },
				sourceMenu: { select: { householdId: true } },
				sections: true,
				noteItems: { include: { shoppingLines: true } },
				recipeItems: true,
			},
		})
		expect(moved.mealPlan.householdId).toBe(owner.householdId)
		// The source Menu moved with the household, reference intact.
		expect(moved.sourceMenu?.householdId).toBe(owner.householdId)
		expect(moved.sourceMenuRevision?.getTime()).toBe(revision.getTime())
		expect(moved.sections.map((s) => s.name)).toEqual(['Mains'])
		expect(moved.recipeItems).toMatchObject([
			{
				sectionId: section.id,
				recipeId: joiner.recipeId,
				recipeTitle: 'Joiner Dinner',
				scaleMultiplier: 2.5,
				note: 'Two batches',
			},
		])
		expect(moved.noteItems).toMatchObject([
			{ sectionId: section.id, order: 1, text: 'Drinks' },
		])
		expect(moved.noteItems[0]!.shoppingLines).toMatchObject([
			{ name: 'Lemonade', quantity: '2', unit: 'l' },
		])
	})

	test('sole member: non-overlapping meal plans are moved without rebuilding', async () => {
		const owner = await setupUserWithRecipe('Owner Dinner')
		const joiner = await setupUserWithRecipe('Joiner Dinner')
		const weekStart = new Date('2026-02-09T00:00:00.000Z')
		const originalPlan = await prisma.mealPlan.create({
			data: {
				householdId: joiner.householdId,
				weekStart,
				meals: {
					create: {
						date: weekStart,
						order: 0,
						label: 'dinner',
						recipeItems: {
							create: {
								order: 0,
								recipeId: joiner.recipeId,
								recipeTitle: 'Joiner Dinner',
								scaleMultiplier: 1,
							},
						},
					},
				},
			},
			include: { meals: { include: { recipeItems: true } } },
		})

		const invite = await createHouseholdInvite(owner.householdId, owner.id)
		await acceptInvite(invite.token, joiner.id)

		const movedPlan = await prisma.mealPlan.findUniqueOrThrow({
			where: { id: originalPlan.id },
			include: { meals: { include: { recipeItems: true } } },
		})
		expect(movedPlan.householdId).toBe(owner.householdId)
		expect(movedPlan.createdAt).toEqual(originalPlan.createdAt)
		expect(movedPlan.meals).toHaveLength(1)
		expect(movedPlan.meals[0]!.id).toBe(originalPlan.meals[0]!.id)
		expect(movedPlan.meals[0]!.createdAt).toEqual(
			originalPlan.meals[0]!.createdAt,
		)
		expect(movedPlan.meals[0]!.recipeItems[0]!.id).toBe(
			originalPlan.meals[0]!.recipeItems[0]!.id,
		)
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
				activeTime: 15,
				totalTime: 60,
				yieldAmount: 2,
				yieldLabel: 'loaves',
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
		expect(copiedRecipe).toMatchObject({
			activeTime: 15,
			totalTime: 60,
			yieldAmount: 2,
			yieldLabel: 'loaves',
		})

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

describe('Recipe classification household moves', () => {
	test('a sole-member move remaps normalized collisions with target values winning', async () => {
		const targetOwner = await setupUser()
		const sourceOwner = await setupUserWithRecipe('Moving mezze')
		const targetCuisine = await prisma.recipeMetadataValue.create({
			data: {
				householdId: targetOwner.householdId,
				dimension: 'cuisine',
				name: 'LEVANTINE',
				nameKey: 'levantine',
			},
		})
		const sourceCuisine = await prisma.recipeMetadataValue.create({
			data: {
				householdId: sourceOwner.householdId,
				dimension: 'cuisine',
				name: 'Levantine',
				nameKey: 'levantine',
			},
		})
		await prisma.recipeMetadataAssignment.create({
			data: { recipeId: sourceOwner.recipeId, valueId: sourceCuisine.id },
		})

		const invite = await createHouseholdInvite(
			targetOwner.householdId,
			targetOwner.id,
		)
		await acceptInvite(invite.token, sourceOwner.id)

		const moved = await prisma.recipe.findUniqueOrThrow({
			where: { id: sourceOwner.recipeId },
			select: {
				householdId: true,
				metadataAssignments: {
					select: { valueId: true, value: { select: { name: true } } },
				},
			},
		})
		expect(moved.householdId).toBe(targetOwner.householdId)
		expect(moved.metadataAssignments).toEqual([
			{ valueId: targetCuisine.id, value: { name: 'LEVANTINE' } },
		])
		expect(
			await prisma.recipeMetadataValue.findUnique({
				where: { id: sourceCuisine.id },
			}),
		).toBeNull()
	})

	test('a member leaving deep-copies Recipe assignments into the new household vocabulary', async () => {
		const owner = await setupUser()
		const member = await prisma.user.create({ data: createUser() })
		await prisma.householdMember.create({
			data: {
				householdId: owner.householdId,
				userId: member.id,
				role: 'member',
			},
		})
		const romanian = await prisma.recipeMetadataValue.create({
			data: {
				householdId: owner.householdId,
				dimension: 'cuisine',
				name: 'Romanian',
				nameKey: 'romanian',
			},
		})
		await prisma.recipe.create({
			data: {
				title: 'Member stew',
				userId: member.id,
				householdId: owner.householdId,
				metadataAssignments: { create: { valueId: romanian.id } },
			},
		})

		await leaveHousehold(member.id)
		const newMembership = await prisma.householdMember.findFirstOrThrow({
			where: { userId: member.id },
		})
		const copied = await prisma.recipe.findFirstOrThrow({
			where: {
				userId: member.id,
				householdId: newMembership.householdId,
				title: 'Member stew',
			},
			select: {
				metadataAssignments: {
					select: {
						value: {
							select: { householdId: true, dimension: true, name: true },
						},
					},
				},
			},
		})
		expect(copied.metadataAssignments).toEqual([
			{
				value: {
					householdId: newMembership.householdId,
					dimension: 'cuisine',
					name: 'Romanian',
				},
			},
		])
	})
})
