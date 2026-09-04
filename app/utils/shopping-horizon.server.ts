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

export type NextShopRestockEffect =
	'added' | 'moved' | 'resurfaced' | 'already-in-next-shop'

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

/**
 * Ensure one preferred matching row is unchecked in Next shop for an explicit
 * restock action. Unlike generated demand, this policy may resurface a checked
 * row because the household has just said the Staple is Out.
 */
export async function resolveNextShopRestockTarget(
	db: ShoppingHorizonDatabase,
	{
		listId,
		name,
		category,
	}: { listId: string; name: string; category: string },
): Promise<NextShopRestockEffect> {
	const canonicalName = demandIdentity(name)
	const items = await db.shoppingListItem.findMany({
		where: { listId },
		orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		select: {
			id: true,
			name: true,
			checked: true,
			horizon: true,
		},
	})
	const existing = selectNextShopDemandTargets(items, [canonicalName]).get(
		canonicalName,
	)

	if (!existing) {
		await db.shoppingListItem.create({
			data: {
				name,
				category,
				source: 'manual',
				horizon: NEXT_SHOP,
				listId,
			},
		})
		return 'added'
	}

	if (!existing.checked && existing.horizon === LATER) {
		await db.shoppingListItem.update({
			where: { id: existing.id },
			data: { horizon: NEXT_SHOP },
		})
		return 'moved'
	}

	if (existing.checked) {
		await db.shoppingListItem.update({
			where: { id: existing.id },
			data: { checked: false, horizon: NEXT_SHOP },
		})
		return 'resurfaced'
	}

	return 'already-in-next-shop'
}
