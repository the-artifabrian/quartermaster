import { invariantResponse } from '@epic-web/invariant'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { getWeekStart } from '#app/utils/date.ts'
import { ensureMealPlan } from '#app/utils/meal-plan.server.ts'
import { createMealWithItems } from '#app/utils/meal.server.ts'
import {
	menuToSnapshotSections,
	snapshotHasContent,
} from '#app/utils/menu-snapshot.ts'

/**
 * Plan one household Menu as a stable Meal snapshot.
 *
 * This is the shared write seam for both Menu detail and Plan. It always reads
 * the Menu fresh through the household, copies its current structure by value,
 * finds or creates the target week's Plan, and appends one Meal to the day.
 * Omitting `guestCount` applies the Menu default; passing null deliberately
 * clears it (the Menu-detail form allows that override).
 */
export async function planMenu(
	db: PrismaClient,
	{
		householdId,
		menuId,
		date,
		label = null,
		servingAt = null,
		servingTimeZone = null,
		guestCount,
	}: {
		householdId: string
		menuId: string
		date: Date
		label?: string | null
		servingAt?: Date | null
		servingTimeZone?: string | null
		guestCount?: number | null
	},
): Promise<
	{ created: true; mealId: string } | { created: false; reason: 'empty-menu' }
> {
	const menu = await db.menu.findFirst({
		where: { id: menuId, householdId },
		select: {
			id: true,
			updatedAt: true,
			defaultGuestCount: true,
			sections: {
				orderBy: { order: 'asc' },
				select: {
					name: true,
					items: {
						orderBy: { order: 'asc' },
						select: {
							kind: true,
							recipeTitle: true,
							scaleMultiplier: true,
							note: true,
							recipe: {
								select: { id: true, title: true, householdId: true },
							},
							shoppingLines: {
								orderBy: { order: 'asc' },
								select: { name: true, quantity: true, unit: true },
							},
						},
					},
				},
			},
		},
	})
	invariantResponse(menu, 'Menu not found', { status: 404 })

	const sections = menuToSnapshotSections(menu, householdId)
	if (!snapshotHasContent(sections)) {
		return { created: false, reason: 'empty-menu' }
	}

	const mealPlan = await ensureMealPlan(db, {
		householdId,
		weekStart: getWeekStart(date),
	})
	const mealId = await createMealWithItems(db, {
		mealPlanId: mealPlan.id,
		date,
		label,
		servingAt,
		servingTimeZone: servingAt ? servingTimeZone : null,
		guestCount: guestCount === undefined ? menu.defaultGuestCount : guestCount,
		sourceMenuId: menu.id,
		sourceMenuRevision: menu.updatedAt,
		items: [],
		sections,
	})

	return { created: true, mealId }
}
