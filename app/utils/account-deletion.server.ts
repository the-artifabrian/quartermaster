import { prisma } from './db.server.ts'
import {
	deleteDissolvedPhotos,
	findHeir,
	removeMembership,
} from './household-membership.server.ts'
import { cancelSubscriptionOfDeletedAccount } from './stripe.server.ts'
import { writeTransaction } from './write-transaction.server.ts'

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
 * becomes owner when the Household would otherwise have none (the user was
 * owner, or something earlier already left it without one). A sole member
 * takes the Household and everything in it with them (see
 * `removeMembership`).
 *
 * Row changes happen in one transaction. A Pro subscription is cancelled
 * with Stripe only after it commits, by the id the transaction read before
 * the Subscription row went with the user. A deletion that fails then leaves
 * Pro running, never cancelled under an account that still exists. If Stripe
 * fails, the account stays deleted and the failure is logged and captured.
 * Stored photos are removed last, and only when no remaining Recipe shows
 * them; a failed storage delete is logged and does not undo the account
 * deletion.
 */
export async function deleteAccount(userId: string) {
	const deleted = await writeTransaction(prisma, async (tx) => {
		const subscription = await tx.subscription.findUnique({
			where: { userId },
			select: { stripeSubscriptionId: true },
		})
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

		for (const householdId of householdIds) {
			const heir = await findHeir(tx, householdId, userId)
			if (!heir) continue
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
		}

		// The heir becomes owner if the Household would have none, and a
		// Household with nobody else in it dissolves.
		const left = membership
			? await removeMembership(tx, membership.householdId, userId)
			: null
		// Any of the user's Recipes nobody inherited go with the user.
		const leftover = await tx.recipeImage.findMany({
			where: { recipe: { userId } },
			select: { objectKey: true },
			distinct: ['objectKey'],
		})
		await tx.user.delete({ where: { id: userId } })

		return {
			objectKeys: [
				...(left?.objectKeys ?? []),
				...leftover.map((image) => image.objectKey),
			],
			stripeSubscriptionId: subscription?.stripeSubscriptionId ?? null,
		}
	})

	if (deleted.stripeSubscriptionId) {
		await cancelSubscriptionOfDeletedAccount(deleted.stripeSubscriptionId)
	}

	await deleteDissolvedPhotos(deleted.objectKeys)
}
