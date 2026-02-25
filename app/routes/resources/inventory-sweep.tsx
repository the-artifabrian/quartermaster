import { z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/inventory-sweep.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireProTier(request)

	const items = await prisma.inventoryItem.findMany({
		where: { householdId },
		orderBy: [{ name: 'asc' }],
		select: {
			id: true,
			name: true,
			location: true,
			lowStock: true,
			updatedAt: true,
		},
	})

	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

	const mapped = items.map((item) => {
		// Priority: perishables (fridge/freezer), already low-stock, or stale (not updated in 7+ days)
		const isPerishable = item.location === 'fridge' || item.location === 'freezer'
		const isStale = new Date(item.updatedAt) < sevenDaysAgo
		const priority = isPerishable || item.lowStock || isStale

		return {
			id: item.id,
			name: item.name,
			location: item.location,
			lowStock: item.lowStock,
			priority,
		}
	})

	return { items: mapped }
}

const SweepChangeSchema = z.object({
	changes: z.array(
		z.object({
			itemId: z.string(),
			action: z.enum(['low-stock', 'used-up']),
		}),
	),
})

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)

	const body = await request.json()
	const parsed = SweepChangeSchema.safeParse(body)
	if (!parsed.success) {
		return Response.json({ status: 'error', message: 'Invalid data' }, { status: 400 })
	}

	const { changes } = parsed.data
	if (changes.length === 0) {
		return Response.json({ status: 'success', deleted: 0, markedLow: 0 })
	}

	// Verify all items belong to this household
	const itemIds = changes.map((c) => c.itemId)
	const items = await prisma.inventoryItem.findMany({
		where: { id: { in: itemIds }, householdId },
		select: { id: true },
	})
	const validIds = new Set(items.map((i) => i.id))
	const validChanges = changes.filter((c) => validIds.has(c.itemId))

	const toDelete = validChanges
		.filter((c) => c.action === 'used-up')
		.map((c) => c.itemId)
	const toMarkLow = validChanges
		.filter((c) => c.action === 'low-stock')
		.map((c) => c.itemId)

	await prisma.$transaction([
		...(toDelete.length > 0
			? [
					prisma.inventoryItem.deleteMany({
						where: { id: { in: toDelete } },
					}),
				]
			: []),
		...toMarkLow.map((id) =>
			prisma.inventoryItem.update({
				where: { id },
				data: { lowStock: true },
			}),
		),
	])

	void emitHouseholdEvent({
		type: 'inventory_sweep_completed',
		payload: { deleted: toDelete.length, markedLow: toMarkLow.length },
		userId,
		householdId,
	})

	return Response.json({
		status: 'success',
		deleted: toDelete.length,
		markedLow: toMarkLow.length,
	})
}
