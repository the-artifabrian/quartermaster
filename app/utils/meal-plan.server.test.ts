import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { ensureMealPlan } from '#app/utils/meal-plan.server.ts'
import { createUser } from '#tests/db-utils.ts'

async function setupHousehold() {
	const user = await prisma.user.create({ data: createUser() })
	const household = await prisma.household.create({
		data: {
			name: 'Plan Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	return household
}

test('ensureMealPlan returns the existing current-format plan', async () => {
	const household = await setupHousehold()
	const weekStart = new Date('2026-02-02T00:00:00.000Z')
	const existing = await prisma.mealPlan.create({
		data: { householdId: household.id, weekStart },
	})

	const ensured = await ensureMealPlan(prisma, {
		householdId: household.id,
		weekStart,
	})
	expect(ensured.id).toBe(existing.id)
	expect(
		await prisma.mealPlan.count({ where: { householdId: household.id } }),
	).toBe(1)
})

test('ensureMealPlan finds an INTEGER-era week instead of creating a duplicate plan', async () => {
	const household = await setupHousehold()
	const weekStart = new Date('2026-02-02T00:00:00.000Z')
	const legacyEra = await prisma.mealPlan.create({
		data: { householdId: household.id, weekStart },
	})
	// Rewrite the stored value into the old Prisma client's INTEGER epoch-ms
	// format — the mix real long-lived databases hold. Inlined literal, not a
	// bound parameter, so it lands as SQLite INTEGER.
	await prisma.$executeRawUnsafe(
		`UPDATE "MealPlan" SET "weekStart" = ${weekStart.getTime()} WHERE "id" = '${legacyEra.id}'`,
	)

	const ensured = await ensureMealPlan(prisma, {
		householdId: household.id,
		weekStart,
	})
	expect(ensured.id).toBe(legacyEra.id)
	expect(ensured.weekStart.getTime()).toBe(weekStart.getTime())
	expect(
		await prisma.mealPlan.count({ where: { householdId: household.id } }),
	).toBe(1)
})

test('ensureMealPlan creates the plan when the week has none in either era', async () => {
	const household = await setupHousehold()
	const weekStart = new Date('2026-02-09T00:00:00.000Z')

	const ensured = await ensureMealPlan(prisma, {
		householdId: household.id,
		weekStart,
	})
	expect(ensured.weekStart.getTime()).toBe(weekStart.getTime())
	expect(
		await prisma.mealPlan.count({ where: { householdId: household.id } }),
	).toBe(1)
})
