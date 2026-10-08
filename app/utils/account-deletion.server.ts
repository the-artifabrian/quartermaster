import { type Prisma } from '#app/generated/prisma/client.ts'
import { prisma } from './db.server.ts'
import { deleteRecipeImageUnlessShared } from './recipe-image.server.ts'

/**
 * The member who takes over a Household's data when `userId` leaves it: an
 * existing owner first, else the longest-standing member. Null when nobody
 * else is in the Household.
 */
async function findHeir(
	db: Pick<Prisma.TransactionClient, 'householdMember'>,
	householdId: string,
	userId: string,
) {
	const others = await db.householdMember.findMany({
		where: { householdId, userId: { not: userId } },
		select: {
			userId: true,
			role: true,
			user: { select: { name: true, username: true } },
		},
		orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
	})
	return others.find((member) => member.role === 'owner') ?? others[0] ?? null
}

export type AccountDeletionOutcome =
	{ kind: 'household-stays'; heirName: string } | { kind: 'household-deleted' }

/** What "Delete my account" will do to the user's Household. */
export async function getAccountDeletionOutcome(
	userId: string,
): Promise<AccountDeletionOutcome> {
	const membership = await prisma.householdMember.findFirst({
		where: { userId },
		select: { householdId: true },
	})
	const heir = membership
		? await findHeir(prisma, membership.householdId, userId)
		: null
	return heir
		? {
				kind: 'household-stays',
				heirName: heir.user.name ?? heir.user.username,
			}
		: { kind: 'household-deleted' }
}

/**
 * Delete a user and keep Household data with the Household.
 *
 * Recipes, the Shopping list and pending invites point at the user who made
 * them, and those foreign keys cascade on user delete. While anyone else is
 * in the Household, those rows move to its heir (see `findHeir`), who also
 * becomes owner if the user was. A sole member takes the Household and
 * everything in it with them.
 *
 * Row changes happen in one transaction. Stored photos are removed after it
 * commits, and only when no remaining Recipe shows them; a failed storage
 * delete is logged and does not undo the account deletion.
 */
export async function deleteAccount(userId: string) {
	const objectKeys = await prisma.$transaction(async (tx) => {
		// Every Household the user still has rows in: their own, plus any they
		// left, where leaveHousehold kept the original Recipes under their id.
		const [recipeHouseholds, listHouseholds, inviteHouseholds, membership] =
			await Promise.all([
				tx.recipe.findMany({
					where: { userId, householdId: { not: null } },
					select: { householdId: true },
					distinct: ['householdId'],
				}),
				tx.shoppingList.findMany({
					where: { userId, householdId: { not: null } },
					select: { householdId: true },
				}),
				tx.householdInvite.findMany({
					where: { createdById: userId },
					select: { householdId: true },
					distinct: ['householdId'],
				}),
				tx.householdMember.findFirst({
					where: { userId },
					select: { householdId: true, role: true },
				}),
			])
		const householdIds = new Set(
			[...recipeHouseholds, ...listHouseholds, ...inviteHouseholds]
				.map((row) => row.householdId)
				.filter((id): id is string => id !== null),
		)
		if (membership) householdIds.add(membership.householdId)

		let soleHouseholdId: string | null = null
		for (const householdId of householdIds) {
			const heir = await findHeir(tx, householdId, userId)
			if (!heir) {
				if (householdId === membership?.householdId) {
					soleHouseholdId = householdId
				}
				continue
			}
			await tx.recipe.updateMany({
				where: { userId, householdId },
				data: { userId: heir.userId },
			})
			await tx.shoppingList.updateMany({
				where: { userId, householdId },
				data: { userId: heir.userId },
			})
			await tx.householdInvite.updateMany({
				where: { createdById: userId, householdId },
				data: { createdById: heir.userId },
			})
			if (
				householdId === membership?.householdId &&
				membership.role === 'owner' &&
				heir.role !== 'owner'
			) {
				await tx.householdMember.update({
					where: { householdId_userId: { householdId, userId: heir.userId } },
					data: { role: 'owner' },
				})
			}
		}

		// What goes now: the sole Household's Recipes, whoever made them, and
		// any of the user's Recipes nobody inherited.
		const doomedRecipes: Prisma.RecipeWhereInput = soleHouseholdId
			? { OR: [{ householdId: soleHouseholdId }, { userId }] }
			: { userId }
		const images = await tx.recipeImage.findMany({
			where: { recipe: doomedRecipes },
			select: { objectKey: true },
			distinct: ['objectKey'],
		})

		if (soleHouseholdId) {
			// Recipes and the Shopping list only null their Household on its
			// delete, so they are removed explicitly.
			await tx.recipe.deleteMany({ where: { householdId: soleHouseholdId } })
			await tx.shoppingList.deleteMany({
				where: { householdId: soleHouseholdId },
			})
			await tx.household.delete({ where: { id: soleHouseholdId } })
		}
		await tx.user.delete({ where: { id: userId } })

		return images.map((image) => image.objectKey)
	})

	for (const objectKey of objectKeys) {
		try {
			await deleteRecipeImageUnlessShared(objectKey)
		} catch (error) {
			console.error(
				`Account deletion left stored photo ${objectKey} behind`,
				error,
			)
		}
	}
}
