import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { demandIdentity } from './shopping-demand.server.ts'
import { LATER, NEXT_SHOP } from './shopping-horizon.ts'

type ShoppingHorizonDatabase = Pick<PrismaClient, 'shoppingListItem'>

type DemandTargetCandidate = {
	id: string
	name: string
	checked: boolean
	horizon: string
}

/** Unchecked rows win; within each checked state, Next shop wins over Later. */
export function selectNextShopDemandTargets<T extends DemandTargetCandidate>(
	items: T[],
	canonicalNames: Iterable<string>,
): Map<string, T> {
	const requested = new Set(canonicalNames)
	const candidates = new Map<string, T[]>()
	for (const item of items) {
		const canonicalName = demandIdentity(item.name)
		if (!requested.has(canonicalName)) continue
		const group = candidates.get(canonicalName) ?? []
		group.push(item)
		candidates.set(canonicalName, group)
	}

	const rank = (item: DemandTargetCandidate) =>
		Number(item.checked) * 2 + Number(item.horizon === LATER)
	const targets = new Map<string, T>()
	for (const [canonicalName, group] of candidates) {
		group.sort((a, b) => rank(a) - rank(b))
		targets.set(canonicalName, group[0]!)
	}
	return targets
}

/**
 * Resolve existing rows for generated demand and promote unchecked Later
 * matches to Next shop. Checked matches remain exactly where and as they are.
 */
export async function resolveNextShopDemandTargets(
	db: ShoppingHorizonDatabase,
	{
		listId,
		canonicalNames,
	}: { listId: string; canonicalNames: Iterable<string> },
) {
	const requested = [...new Set(canonicalNames)]
	const items = await db.shoppingListItem.findMany({
		where: { listId },
		orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		select: {
			id: true,
			name: true,
			quantity: true,
			unit: true,
			checked: true,
			horizon: true,
		},
	})
	const targets = selectNextShopDemandTargets(items, requested)
	const promotedIds = [...targets.values()]
		.filter((item) => !item.checked && item.horizon === LATER)
		.map((item) => item.id)

	if (promotedIds.length > 0) {
		await db.shoppingListItem.updateMany({
			where: { id: { in: promotedIds }, checked: false, horizon: LATER },
			data: { horizon: NEXT_SHOP },
		})
	}

	return { targets, promotedIds }
}
