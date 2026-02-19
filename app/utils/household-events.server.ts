import { EventEmitter } from 'node:events'
import { remember } from '@epic-web/remember'
import { prisma } from './db.server.ts'

export type HouseholdEventType =
	| 'recipe_created'
	| 'recipe_updated'
	| 'recipe_deleted'
	| 'recipe_imported'
	| 'recipe_favorited'
	| 'cook_logged'
	| 'inventory_item_added'
	| 'inventory_items_bulk_added'
	| 'inventory_item_updated'
	| 'inventory_item_deleted'
	| 'meal_plan_assigned'
	| 'meal_plan_removed'
	| 'meal_plan_cooked'
	| 'meal_plan_week_copied'
	| 'shopping_list_generated'
	| 'shopping_list_item_added'
	| 'shopping_list_cleared'
	| 'shopping_list_to_inventory'
	| 'recipes_bulk_imported'
	| 'data_imported'
	| 'household_member_joined'
	| 'household_member_left'
	| 'meal_plan_template_saved'
	| 'meal_plan_template_applied'
	| 'shopping_list_item_toggled'
	| 'shopping_list_item_edited'
	| 'shopping_list_item_deleted'
	| 'inventory_item_low_stock_toggled'

export interface HouseholdEventData {
	id: string
	type: HouseholdEventType
	payload: Record<string, unknown>
	userId: string
	username: string
	householdId: string
	createdAt: string
}

export const householdEventBus = remember(
	'householdEventBus',
	() => new EventEmitter(),
)

export async function emitHouseholdEvent({
	type,
	payload,
	userId,
	householdId,
}: {
	type: HouseholdEventType
	payload: Record<string, unknown>
	userId: string
	householdId: string
}) {
	try {
		const user = await prisma.user.findUnique({
			where: { id: userId },
			select: { name: true, username: true },
		})
		const username = user?.name ?? user?.username ?? 'Someone'

		const event = await prisma.householdEvent.create({
			data: {
				type,
				payload: JSON.stringify(payload),
				householdId,
				userId,
			},
			select: { id: true, createdAt: true },
		})

		const eventData: HouseholdEventData = {
			id: event.id,
			type,
			payload,
			userId,
			username,
			householdId,
			createdAt: event.createdAt.toISOString(),
		}

		householdEventBus.emit(`household:${householdId}`, eventData)
	} catch {
		// Silently ignore — event emission is fire-and-forget
		// and should never break the main request flow
	}
}

let lastPruneTime = 0
const PRUNE_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

export async function pruneOldEvents() {
	const now = Date.now()
	if (now - lastPruneTime < PRUNE_INTERVAL_MS) return
	lastPruneTime = now

	const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)
	await prisma.householdEvent.deleteMany({
		where: { createdAt: { lt: thirtyDaysAgo } },
	})
}
