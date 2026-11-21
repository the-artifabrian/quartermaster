import { type Prisma } from '#app/generated/prisma/client.ts'
import { deleteRecipeImageUnlessShared } from './recipe-image.server.ts'

/**
 * The member who takes over when `userId` leaves `householdId`: an existing
 * owner first, else the member who joined longest ago, with the row id
 * breaking a tie. Null when nobody else is in the Household.
 *
 * Every way out of a Household uses this rule, removal by the owner and
 * account deletion included.
 */
export async function findHeir(
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

/**
 * Take `userId` out of `householdId`. When others stay and none of them is an
 * owner, the heir (see `findHeir`) becomes owner. When nobody stays, the
 * Household is dissolved.
 *
 * Run it in the same `writeTransaction` as the reads that decided on the
 * move, so a join or leave from someone else can't land in between and leave
 * the Household without an owner, or empty but still there.
 *
 * Returns the photo keys of any Recipes it deleted. Pass them to
 * `deleteDissolvedPhotos` once the transaction has committed.
 */
export async function removeMembership(
	tx: Prisma.TransactionClient,
	householdId: string,
	userId: string,
) {
	const heir = await findHeir(tx, householdId, userId)
	if (!heir) {
		const { objectKeys } = await dissolveHousehold(tx, householdId)
		return { dissolved: true, objectKeys }
	}
	await tx.householdMember.delete({
		where: { householdId_userId: { householdId, userId } },
	})
	if (heir.role !== 'owner') {
		await tx.householdMember.update({
			where: { householdId_userId: { householdId, userId: heir.userId } },
			data: { role: 'owner' },
		})
	}
	return { dissolved: false, objectKeys: [] as string[] }
}

/**
 * Delete a Household and everything in it.
 *
 * Recipes and the Shopping list only lose their Household when it is deleted
 * (their relation is SetNull), so they are deleted here first. Left alone they
 * would outlive it with their photos, still open by share link. Everything
 * else that belongs to a Household cascades with it.
 *
 * Returns the distinct photo keys the deleted Recipes showed. The files go
 * after the transaction commits, through `deleteDissolvedPhotos`, which keeps
 * any file another Recipe still shows.
 */
export async function dissolveHousehold(
	tx: Prisma.TransactionClient,
	householdId: string,
) {
	const images = await tx.recipeImage.findMany({
		where: { recipe: { householdId } },
		select: { objectKey: true },
		distinct: ['objectKey'],
	})
	await tx.recipe.deleteMany({ where: { householdId } })
	await tx.shoppingList.deleteMany({ where: { householdId } })
	await tx.household.delete({ where: { id: householdId } })
	return { objectKeys: images.map((image) => image.objectKey) }
}

/**
 * Remove stored photos of deleted Recipes, unless another Recipe still shows
 * them. Call it after the delete commits. A failed storage delete is logged
 * and leaves the file behind; the rows are already gone.
 */
export async function deleteDissolvedPhotos(objectKeys: Iterable<string>) {
	for (const objectKey of new Set(objectKeys)) {
		try {
			await deleteRecipeImageUnlessShared(objectKey)
		} catch (error) {
			console.error(`Left stored photo ${objectKey} behind`, error)
		}
	}
}
