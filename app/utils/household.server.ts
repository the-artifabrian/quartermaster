import crypto from 'node:crypto'
import { requireUserId } from './auth.server.ts'
import { prisma } from './db.server.ts'
import { menuTitleKey } from './menu-validation.ts'
import {
	ensureRecipeMetadataValues,
	moveRecipeMetadataValues,
} from './recipe-metadata.server.ts'
import { DEFAULT_RECIPE_METADATA_VALUE_CREATE } from './recipe-metadata.ts'

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

		const household = await prisma.household.create({
			data: {
				name: `${user.name ?? user.username}'s Household`,
				recipeMetadataValues: {
					create: DEFAULT_RECIPE_METADATA_VALUE_CREATE,
				},
				members: {
					create: { userId, role: 'owner' },
				},
			},
		})

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

export async function getInviteByToken(token: string) {
	const invite = await prisma.householdInvite.findUnique({
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

export async function acceptInvite(token: string, userId: string) {
	const invite = await getInviteByToken(token)
	if (!invite) throw new Error('Invalid or expired invite')

	// Check if user is already a member of this household
	const existingMember = await prisma.householdMember.findUnique({
		where: {
			householdId_userId: {
				householdId: invite.householdId,
				userId,
			},
		},
	})
	if (existingMember) throw new Error('Already a member of this household')

	// Get user's current household info
	const currentMembership = await prisma.householdMember.findFirst({
		where: { userId },
		select: { householdId: true },
	})

	const currentHouseholdId = currentMembership?.householdId

	// Count members in user's current household
	let currentHouseholdMemberCount = 0
	if (currentHouseholdId) {
		currentHouseholdMemberCount = await prisma.householdMember.count({
			where: { householdId: currentHouseholdId },
		})
	}

	const targetHouseholdId = invite.householdId

	await prisma.$transaction(async (tx) => {
		// Atomically mark invite as used — guards against concurrent accepts
		const updated = await tx.householdInvite.updateMany({
			where: { id: invite.id, usedAt: null },
			data: { usedAt: new Date() },
		})
		if (updated.count === 0) {
			throw new Error('Invite already used')
		}

		if (currentHouseholdId && currentHouseholdMemberCount === 1) {
			// Sole member: move all data to new household
			const sourceCutover = await tx.household.findUniqueOrThrow({
				where: { id: currentHouseholdId },
				select: { staplesCutoverAt: true },
			})
			if (sourceCutover.staplesCutoverAt != null) {
				// A target that already cut over keeps its own timestamp. Otherwise
				// preserve the source household's explicit choice, including a
				// confirmed empty selection; row presence never implies cutover.
				await tx.household.updateMany({
					where: { id: targetHouseholdId, staplesCutoverAt: null },
					data: { staplesCutoverAt: sourceCutover.staplesCutoverAt },
				})
			}
			await moveRecipeMetadataValues(tx, currentHouseholdId, targetHouseholdId)
			await tx.recipe.updateMany({
				where: { householdId: currentHouseholdId },
				data: { householdId: targetHouseholdId },
			})
			await tx.inventoryItem.updateMany({
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
			await tx.shoppingList.updateMany({
				where: { householdId: currentHouseholdId },
				data: { householdId: targetHouseholdId },
			})
			// Menus are household-owned and would be cascade-deleted with the
			// old household. Move them, disambiguating title collisions with
			// deterministic "Title (2)", "Title (3)" suffixes.
			const targetMenus = await tx.menu.findMany({
				where: { householdId: targetHouseholdId },
				select: { titleKey: true },
			})
			const takenTitleKeys = new Set<string>(
				targetMenus.map((m: { titleKey: string }) => m.titleKey),
			)
			const sourceMenus = await tx.menu.findMany({
				where: { householdId: currentHouseholdId },
				select: { id: true, title: true, titleKey: true },
				orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
			})
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
				await tx.menu.update({
					where: { id: menu.id },
					data: { householdId: targetHouseholdId, title, titleKey },
				})
			}
			// Delete old household (cascades HouseholdMember)
			await tx.household.delete({
				where: { id: currentHouseholdId },
			})
		} else if (currentHouseholdId) {
			// Multi-member: deep-copy recipes only
			await deepCopyRecipes(tx, userId, currentHouseholdId, targetHouseholdId)
			// Remove from old household
			await tx.householdMember.delete({
				where: {
					householdId_userId: {
						householdId: currentHouseholdId,
						userId,
					},
				},
			})
		}

		// Create membership in target household
		await tx.householdMember.create({
			data: {
				householdId: targetHouseholdId,
				userId,
				role: 'member',
			},
		})
	})
}

export async function leaveHousehold(userId: string) {
	const membership = await prisma.householdMember.findFirst({
		where: { userId },
		select: { householdId: true, role: true },
	})
	if (!membership) throw new Error('Not a member of any household')

	if (membership.role === 'owner') {
		throw new Error('Owner cannot leave the household')
	}

	const oldHouseholdId = membership.householdId

	// Get user info for naming the new household
	const user = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: { name: true, username: true },
	})

	await prisma.$transaction(async (tx) => {
		// Create new solo household
		const newHousehold = await tx.household.create({
			data: {
				name: `${user.name ?? user.username}'s Household`,
				recipeMetadataValues: {
					create: DEFAULT_RECIPE_METADATA_VALUE_CREATE,
				},
				members: { create: { userId, role: 'owner' } },
			},
		})

		// Deep-copy user's recipes to new household
		await deepCopyRecipes(tx, userId, oldHouseholdId, newHousehold.id)

		// Remove from old household
		await tx.householdMember.delete({
			where: {
				householdId_userId: {
					householdId: oldHouseholdId,
					userId,
				},
			},
		})

		// If old household is now empty, delete it
		const remaining = await tx.householdMember.count({
			where: { householdId: oldHouseholdId },
		})
		if (remaining === 0) {
			await tx.household.delete({ where: { id: oldHouseholdId } })
		}
	})
}

export async function removeMember(
	ownerId: string,
	targetUserId: string,
	householdId: string,
) {
	// Verify the requester is the owner
	const ownerMember = await prisma.householdMember.findUnique({
		where: { householdId_userId: { householdId, userId: ownerId } },
		select: { role: true },
	})
	if (!ownerMember || ownerMember.role !== 'owner') {
		throw new Error('Only the household owner can remove members')
	}

	// Cannot remove yourself via this method
	if (ownerId === targetUserId) {
		throw new Error('Owner cannot remove themselves')
	}

	// Delegate to leaveHousehold for the target user
	await leaveHousehold(targetUserId)
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
				title: recipe.title,
				description: recipe.description,
				activeTime: recipe.activeTime,
				totalTime: recipe.totalTime,
				yieldAmount: recipe.yieldAmount,
				yieldLabel: recipe.yieldLabel,
				isFavorite: recipe.isFavorite,
				isAiGenerated: recipe.isAiGenerated,
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
							name: string
							amount: string | null
							unit: string | null
							notes: string | null
							isHeading: boolean
							order: number
						}) => ({
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
}
