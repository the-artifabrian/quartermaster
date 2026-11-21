import crypto from 'node:crypto'
import { createId } from '@paralleldrive/cuid2'
import { type Prisma, type PrismaClient } from '#app/generated/prisma/client.ts'
import { createOwnHousehold, requireUserId } from './auth.server.ts'
import { prisma } from './db.server.ts'
import {
	deleteDissolvedPhotos,
	removeMembership,
} from './household-membership.server.ts'
import { menuTitleKey } from './menu-validation.ts'
import {
	ensureRecipeMetadataValues,
	moveRecipeMetadataValues,
} from './recipe-metadata.server.ts'
import { writeTransaction } from './write-transaction.server.ts'

/**
 * Returns the current user's household info.
 * Safety-net: if no household exists (edge case), auto-creates one.
 */
export async function requireUserWithHousehold(request: Request) {
	const userId = await requireUserId(request)

	const member = await prisma.householdMember.findFirst({
		where: { userId },
		select: { householdId: true, role: true },
	})

	if (member) {
		return { userId, householdId: member.householdId, role: member.role }
	}

	// Safety-net: create a household for users that don't have one.
	// Wrapped in try/catch to handle concurrent requests racing to create.
	try {
		const user = await prisma.user.findUniqueOrThrow({
			where: { id: userId },
			select: { name: true, username: true },
		})

		const household = await createOwnHousehold(prisma, { id: userId, ...user })

		return { userId, householdId: household.id, role: 'owner' }
	} catch {
		// Another concurrent request likely created the household — re-query
		const retryMember = await prisma.householdMember.findFirstOrThrow({
			where: { userId },
			select: { householdId: true, role: true },
		})
		return {
			userId,
			householdId: retryMember.householdId,
			role: retryMember.role,
		}
	}
}

/**
 * Why a leave or a removal was refused. The page that asked may be out of
 * date: the member may have become owner, or left, since it loaded.
 *
 * - `owner`: the person leaving, or being removed, is an owner.
 * - `not-owner`: the person removing someone isn't the owner.
 * - `not-in-household`: the person isn't in that Household.
 * - `removing-self`: the owner tried to remove themselves.
 */
export class MembershipRefused extends Error {
	constructor(
		readonly reason:
			'owner' | 'not-owner' | 'not-in-household' | 'removing-self',
		message: string,
	) {
		super(message)
		this.name = 'MembershipRefused'
	}
}

const INVITE_EXPIRY_DAYS = 7

export async function createHouseholdInvite(
	householdId: string,
	createdById: string,
) {
	const token = crypto.randomUUID()
	const expiresAt = new Date(
		Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
	)

	return prisma.householdInvite.create({
		data: { token, expiresAt, householdId, createdById },
		select: { id: true, token: true, expiresAt: true },
	})
}

export async function getInviteByToken(
	token: string,
	db: Pick<Prisma.TransactionClient, 'householdInvite'> = prisma,
) {
	const invite = await db.householdInvite.findUnique({
		where: { token },
		select: {
			id: true,
			token: true,
			expiresAt: true,
			usedAt: true,
			householdId: true,
			household: { select: { id: true, name: true } },
		},
	})

	if (!invite) return null
	if (invite.usedAt) return null
	if (invite.expiresAt < new Date()) return null

	return invite
}

/**
 * Move `userId` into the invite's Household.
 *
 * A sole member brings everything along and their old Household goes. One
 * who shares a Household takes copies of their own Recipes and leaves the
 * rest; an owner leaving that way hands ownership on (see `removeMembership`).
 * Every read that decides the move happens inside one write transaction, so a
 * join or leave by someone else can't change the picture halfway.
 *
 * Returns the joined Household, and the old one when it is still there.
 */
export async function acceptInvite(
	token: string,
	userId: string,
	db: PrismaClient = prisma,
) {
	const { objectKeys, ...result } = await writeTransaction(db, async (tx) => {
		const invite = await getInviteByToken(token, tx)
		if (!invite) throw new Error('Invalid or expired invite')
		const targetHouseholdId = invite.householdId

		const existingMember = await tx.householdMember.findUnique({
			where: {
				householdId_userId: { householdId: targetHouseholdId, userId },
			},
		})
		if (existingMember) throw new Error('Already a member of this household')

		// Mark the invite used. The write lock was taken before the read
		// above, so no other accept can have used it in between.
		await tx.householdInvite.update({
			where: { id: invite.id },
			data: { usedAt: new Date() },
		})

		// Read the current household inside the transaction: whether the user
		// is its sole member decides between moving everything and copying
		// Recipes, and a partner joining or leaving in between must not flip it.
		const currentMembership = await tx.householdMember.findFirst({
			where: { userId },
			select: { householdId: true },
		})
		const currentHouseholdId = currentMembership?.householdId
		const currentHouseholdMemberCount = currentHouseholdId
			? await tx.householdMember.count({
					where: { householdId: currentHouseholdId },
				})
			: 0

		if (currentHouseholdId && currentHouseholdMemberCount === 1) {
			// Sole member: move all data to new household
			await moveRecipeMetadataValues(tx, currentHouseholdId, targetHouseholdId)
			// Both households may have saved the same shared Recipe. Keep both
			// copies; repeat Save keeps opening the target's, as with Menus.
			const targetRecipeSources = await tx.recipe.findMany({
				where: {
					householdId: targetHouseholdId,
					copiedFromRecipeId: { not: null },
				},
				select: { copiedFromRecipeId: true },
			})
			await tx.recipe.updateMany({
				where: {
					householdId: currentHouseholdId,
					copiedFromRecipeId: {
						in: targetRecipeSources.map((recipe) => recipe.copiedFromRecipeId!),
					},
				},
				data: { copiedFromRecipeId: null },
			})
			await tx.recipe.updateMany({
				where: { householdId: currentHouseholdId },
				data: { householdId: targetHouseholdId },
			})
			// Canonical ingredients are household-owned like Menus. The target
			// household's reviewed choice wins on a canonical-key collision.
			// Non-colliding stable rows move intact before the source household is
			// deleted.
			const targetIngredientKeys = new Set(
				(
					await tx.householdIngredient.findMany({
						where: { householdId: targetHouseholdId },
						select: { canonicalKey: true },
					})
				).map((ingredient) => ingredient.canonicalKey),
			)
			const sourceIngredients = await tx.householdIngredient.findMany({
				where: { householdId: currentHouseholdId },
				select: { id: true, canonicalKey: true },
				orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
			})
			for (const ingredient of sourceIngredients) {
				if (targetIngredientKeys.has(ingredient.canonicalKey)) {
					await tx.householdIngredient.delete({ where: { id: ingredient.id } })
					continue
				}
				await tx.householdIngredient.update({
					where: { id: ingredient.id },
					data: { householdId: targetHouseholdId },
				})
				targetIngredientKeys.add(ingredient.canonicalKey)
			}
			// Week plans move whole (#106): a non-colliding week just changes
			// household; a colliding week re-parents its Meals into the target
			// plan, appended after each day's existing Meals — like import does —
			// so nothing is merged away and no cooked state or multiplier is
			// second-guessed. Week matching happens in JS because raw SQL equality
			// on `weekStart` is unsound across the column's two storage eras
			// (INTEGER epoch-ms vs TEXT ISO); Prisma reads both correctly.
			const [sourcePlans, targetPlans] = await Promise.all([
				tx.mealPlan.findMany({
					where: { householdId: currentHouseholdId },
					select: { id: true, weekStart: true },
				}),
				tx.mealPlan.findMany({
					where: { householdId: targetHouseholdId },
					select: { id: true, weekStart: true },
					// Deterministic fallback order when the household holds same-week
					// twins from the two storage eras: oldest first.
					orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
				}),
			])
			for (const sourcePlan of sourcePlans) {
				// Same precedence as ensureMealPlan, so Meals merge into the plan
				// the planner will actually resolve: the current-format row when
				// one exists, otherwise the oldest same-instant plan.
				const directTarget = await tx.mealPlan.findUnique({
					where: {
						householdId_weekStart: {
							householdId: targetHouseholdId,
							weekStart: sourcePlan.weekStart,
						},
					},
					select: { id: true },
				})
				const targetPlanId =
					directTarget?.id ??
					targetPlans.find(
						(plan) =>
							plan.weekStart.getTime() === sourcePlan.weekStart.getTime(),
					)?.id
				if (!targetPlanId) {
					await tx.mealPlan.update({
						where: { id: sourcePlan.id },
						data: { householdId: targetHouseholdId },
					})
					continue
				}
				const [sourceMeals, targetMeals] = await Promise.all([
					tx.meal.findMany({
						where: { mealPlanId: sourcePlan.id },
						orderBy: [{ date: 'asc' }, { order: 'asc' }, { id: 'asc' }],
						select: { id: true, date: true },
					}),
					tx.meal.findMany({
						where: { mealPlanId: targetPlanId },
						select: { date: true, order: true },
					}),
				])
				const nextOrderByDay = new Map<number, number>()
				for (const meal of targetMeals) {
					const day = meal.date.getTime()
					nextOrderByDay.set(
						day,
						Math.max(nextOrderByDay.get(day) ?? 0, meal.order + 1),
					)
				}
				for (const meal of sourceMeals) {
					const day = meal.date.getTime()
					const order = nextOrderByDay.get(day) ?? 0
					nextOrderByDay.set(day, order + 1)
					await tx.meal.update({
						where: { id: meal.id },
						data: { mealPlanId: targetPlanId, order },
					})
				}
				await tx.mealPlan.delete({ where: { id: sourcePlan.id } })
			}
			// A Household holds one Shopping list (`householdId` is unique), and
			// each list is created lazily on the first Shopping visit, so two
			// people who both used the app before joining each bring one. The
			// source rows join the target list whole and unmerged, like Meals
			// above; with no target list the source list just changes household.
			// The emptied source list goes too, before the old Household
			// dissolves.
			const [sourceList, targetList] = await Promise.all([
				tx.shoppingList.findUnique({
					where: { householdId: currentHouseholdId },
					select: { id: true },
				}),
				tx.shoppingList.findUnique({
					where: { householdId: targetHouseholdId },
					select: { id: true },
				}),
			])
			if (sourceList && targetList) {
				await tx.shoppingListItem.updateMany({
					where: { listId: sourceList.id },
					data: { listId: targetList.id },
				})
				await tx.shoppingList.delete({ where: { id: sourceList.id } })
			} else if (sourceList) {
				await tx.shoppingList.update({
					where: { id: sourceList.id },
					data: { householdId: targetHouseholdId },
				})
			}
			// Menus are household-owned and would be cascade-deleted with the
			// old household. Move them, disambiguating title collisions with
			// deterministic "Title (2)", "Title (3)" suffixes.
			const targetMenus = await tx.menu.findMany({
				where: { householdId: targetHouseholdId },
				select: { titleKey: true, copiedFromMenuId: true },
			})
			const takenTitleKeys = new Set<string>(
				targetMenus.map((m: { titleKey: string }) => m.titleKey),
			)
			const sourceMenus = await tx.menu.findMany({
				where: { householdId: currentHouseholdId },
				select: {
					id: true,
					title: true,
					titleKey: true,
					copiedFromMenuId: true,
				},
				orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
			})
			const savedSources = new Set(
				targetMenus.map((menu) => menu.copiedFromMenuId),
			)
			for (const menu of sourceMenus) {
				let { title, titleKey } = menu
				if (takenTitleKeys.has(titleKey)) {
					let suffix = 2
					while (
						takenTitleKeys.has(menuTitleKey(`${menu.title} (${suffix})`))
					) {
						suffix++
					}
					title = `${menu.title} (${suffix})`
					titleKey = menuTitleKey(title)
				}
				takenTitleKeys.add(titleKey)
				// Keep both independently edited Menus on a household move. If
				// both saved the same link, repeat Save opens the target's copy.
				const copiedFromMenuId = savedSources.has(menu.copiedFromMenuId)
					? null
					: menu.copiedFromMenuId
				savedSources.add(copiedFromMenuId)
				await tx.menu.update({
					where: { id: menu.id },
					data: {
						householdId: targetHouseholdId,
						title,
						titleKey,
						copiedFromMenuId,
					},
				})
			}
		} else if (currentHouseholdId) {
			// Multi-member: deep-copy recipes only
			await deepCopyRecipes(tx, userId, currentHouseholdId, targetHouseholdId)
		}

		// A sole member's Household is empty now and dissolves. Otherwise an
		// owner leaving hands ownership on.
		const left = currentHouseholdId
			? await removeMembership(tx, currentHouseholdId, userId)
			: null

		await tx.householdMember.create({
			data: {
				householdId: targetHouseholdId,
				userId,
				role: 'member',
			},
		})

		return {
			householdId: targetHouseholdId,
			leftHouseholdId: left && !left.dissolved ? currentHouseholdId! : null,
			objectKeys: left?.objectKeys ?? [],
		}
	})
	await deleteDissolvedPhotos(objectKeys)
	return result
}

/**
 * Move a member who isn't the owner into a new Household of their own, with
 * copies of their Recipes. The originals stay behind.
 */
export async function leaveHousehold(
	userId: string,
	db: PrismaClient = prisma,
) {
	const { objectKeys } = await writeTransaction(db, (tx) =>
		leaveInTransaction(tx, userId),
	)
	await deleteDissolvedPhotos(objectKeys)
}

/**
 * The checks run in the same transaction as the leave, so an owner who has
 * just left can't remove anyone, and a member who has just become owner
 * isn't removed.
 */
export async function removeMember(
	ownerId: string,
	targetUserId: string,
	householdId: string,
	db: PrismaClient = prisma,
) {
	const { objectKeys } = await writeTransaction(db, async (tx) => {
		const ownerMember = await tx.householdMember.findUnique({
			where: { householdId_userId: { householdId, userId: ownerId } },
			select: { role: true },
		})
		if (!ownerMember || ownerMember.role !== 'owner') {
			throw new MembershipRefused(
				'not-owner',
				'Only the household owner can remove members',
			)
		}

		if (ownerId === targetUserId) {
			throw new MembershipRefused(
				'removing-self',
				'Owner cannot remove themselves',
			)
		}

		// A leave acts on whatever household the target is in, so the target
		// must be checked against the owner's household first.
		const targetMember = await tx.householdMember.findUnique({
			where: { householdId_userId: { householdId, userId: targetUserId } },
			select: { userId: true },
		})
		if (!targetMember) {
			throw new MembershipRefused(
				'not-in-household',
				'That user is not a member of this household',
			)
		}

		return leaveInTransaction(tx, targetUserId)
	})
	await deleteDissolvedPhotos(objectKeys)
}

async function leaveInTransaction(
	tx: Prisma.TransactionClient,
	userId: string,
) {
	const membership = await tx.householdMember.findFirst({
		where: { userId },
		select: { householdId: true, role: true },
	})
	if (!membership) {
		throw new MembershipRefused(
			'not-in-household',
			'Not a member of any household',
		)
	}
	if (membership.role === 'owner') {
		throw new MembershipRefused('owner', 'Owner cannot leave the household')
	}
	const user = await tx.user.findUniqueOrThrow({
		where: { id: userId },
		select: { name: true, username: true },
	})

	const newHousehold = await createOwnHousehold(tx, { id: userId, ...user })
	await deepCopyRecipes(tx, userId, membership.householdId, newHousehold.id)
	// Only a Household already without an owner can be left empty here. It
	// dissolves; otherwise its heir becomes owner if it has none.
	return removeMembership(tx, membership.householdId, userId)
}

export async function revokeInvite(
	inviteId: string,
	userId: string,
	householdId: string,
) {
	// Verify the requester is the owner
	const ownerMember = await prisma.householdMember.findUnique({
		where: { householdId_userId: { householdId, userId } },
		select: { role: true },
	})
	if (!ownerMember || ownerMember.role !== 'owner') {
		throw new Error('Only the household owner can revoke invites')
	}

	await prisma.householdInvite.delete({
		where: { id: inviteId, householdId },
	})
}

async function deepCopyRecipes(
	tx: any,
	userId: string,
	fromHouseholdId: string,
	toHouseholdId: string,
) {
	const recipes = await tx.recipe.findMany({
		where: { userId, householdId: fromHouseholdId },
		include: {
			ingredients: true,
			instructions: true,
			image: true,
			metadataAssignments: { include: { value: true } },
		},
	})
	// Copies get their ids up front so each sub-Recipe link can point at the
	// copy of its target once every copy exists.
	const recipeIds = new Map<string, string>(
		recipes.map((recipe: { id: string }) => [recipe.id, createId()]),
	)
	const ingredientIds = new Map<string, string>(
		recipes.flatMap((recipe: { ingredients: Array<{ id: string }> }) =>
			recipe.ingredients.map((ing) => [ing.id, createId()] as const),
		),
	)

	for (const recipe of recipes) {
		const metadataValueIds = await ensureRecipeMetadataValues(
			tx,
			toHouseholdId,
			recipe.metadataAssignments.map(
				(assignment: {
					value: {
						dimension: string
						name: string
						nameKey: string
						sortOrder: number
					}
				}) => assignment.value,
			),
		)
		await tx.recipe.create({
			data: {
				id: recipeIds.get(recipe.id)!,
				title: recipe.title,
				description: recipe.description,
				activeTime: recipe.activeTime,
				totalTime: recipe.totalTime,
				yieldAmount: recipe.yieldAmount,
				yieldLabel: recipe.yieldLabel,
				isFavorite: recipe.isFavorite,
				sourceUrl: recipe.sourceUrl,
				rawText: recipe.rawText,
				notes: recipe.notes,
				userId,
				householdId: toHouseholdId,
				metadataAssignments: {
					create: metadataValueIds.map((valueId) => ({ valueId })),
				},
				ingredients: {
					create: recipe.ingredients.map(
						(ing: {
							id: string
							name: string
							amount: string | null
							unit: string | null
							notes: string | null
							isHeading: boolean
							order: number
						}) => ({
							id: ingredientIds.get(ing.id)!,
							name: ing.name,
							amount: ing.amount,
							unit: ing.unit,
							notes: ing.notes,
							isHeading: ing.isHeading,
							order: ing.order,
						}),
					),
				},
				instructions: {
					create: recipe.instructions.map(
						(inst: { content: string; order: number }) => ({
							content: inst.content,
							order: inst.order,
						}),
					),
				},
				// The copy shares the source's bytes: copying them means a fetch
				// inside this write transaction. Image deletes count references
				// first, so either side may drop its picture without blanking the
				// other's.
				...(recipe.image
					? {
							image: {
								create: {
									altText: recipe.image.altText,
									objectKey: recipe.image.objectKey,
								},
							},
						}
					: {}),
			},
		})
	}
	// A link survives only when its target was copied too. One to a Recipe
	// left behind in the old household becomes a plain ingredient.
	for (const recipe of recipes) {
		for (const ing of recipe.ingredients as Array<{
			id: string
			linkedRecipeId: string | null
		}>) {
			const linkedRecipeId =
				ing.linkedRecipeId && recipeIds.get(ing.linkedRecipeId)
			if (linkedRecipeId)
				await tx.ingredient.update({
					where: { id: ingredientIds.get(ing.id)! },
					data: { linkedRecipeId },
				})
		}
	}
}
