import { z } from 'zod'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { emitHouseholdEvent } from './household-events.server.ts'
import { combineRowDisplay } from './shopping-demand.server.ts'

const CheckSchema = z.object({
	itemId: z.string().min(1).max(100),
	checked: z.enum(['true', 'false']).transform((value) => value === 'true'),
	observedVersion: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
	mutationId: z.string().min(1).max(100),
})

export async function readShoppingCheck(
	db: PrismaClient,
	householdId: string,
	itemId: string,
) {
	const row = await db.shoppingListItem.findFirst({
		where: { id: itemId, list: { householdId } },
		include: { mealContributions: { select: { quantity: true, unit: true } } },
	})
	if (!row) return null
	const { mealContributions, ...item } = row
	return {
		...item,
		display: combineRowDisplay({ ...item, contributions: mealContributions }),
	}
}

export async function writeShoppingCheck(
	db: PrismaClient,
	{ householdId, userId }: { householdId: string; userId: string },
	form: FormData,
) {
	const parsed = CheckSchema.safeParse(Object.fromEntries(form))
	if (!parsed.success) {
		return {
			status: 'invalid' as const,
			message: 'Reload Shopping before checking this item.',
		}
	}
	const { itemId, checked, observedVersion, mutationId } = parsed.data
	// One conditional write: contribution triggers and checked/content changes
	// participate in the same SQLite transaction as the version increment.
	const result = await db.shoppingListItem.updateMany({
		where: {
			id: itemId,
			list: { householdId },
			checkVersion: observedVersion,
			checked: !checked,
		},
		data: { checked, lastCheckMutationId: mutationId },
	})
	const item = await readShoppingCheck(db, householdId, itemId)
	if (!item)
		return {
			status: 'missing' as const,
			message: 'This item is no longer on your list.',
		}
	const ownCommit =
		item.checkVersion === observedVersion + 1 &&
		item.lastCheckMutationId === mutationId &&
		item.checked === checked
	const unchanged =
		item.checkVersion === observedVersion && item.checked === checked
	if (result.count) {
		void emitHouseholdEvent({
			type: 'shopping_list_item_toggled',
			payload: { name: item.name, checked },
			originClientId: form.get('originClientId'),
			userId,
			householdId,
		})
	}
	return ownCommit || unchanged
		? { status: 'success' as const, item }
		: {
				status: 'conflict' as const,
				item,
				message:
					'This item changed. Check its current amount before checking again.',
			}
}
