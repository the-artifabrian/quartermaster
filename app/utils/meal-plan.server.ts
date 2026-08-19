import { createId } from '@paralleldrive/cuid2'
import { type Prisma } from '#app/generated/prisma/client.ts'

type MealPlanDatabase = Pick<
	Prisma.TransactionClient,
	'$executeRaw' | 'mealPlan'
>

export async function ensureMealPlan(
	db: MealPlanDatabase,
	{
		householdId,
		weekStart,
	}: {
		householdId: string
		weekStart: Date
	},
) {
	// Current-format row first — what the unique index can see.
	const direct = await db.mealPlan.findUnique({
		where: { householdId_weekStart: { householdId, weekStart } },
	})
	if (direct) return direct

	// `weekStart` values span two storage eras (INTEGER epoch-ms and TEXT
	// ISO), and neither the unique index nor a raw comparison can equate the
	// two formats — inserting here for a week stored in the old era would
	// silently create a duplicate plan and hide its Meals (found in #106 via
	// an import round-trip against real data). Prisma reads both formats
	// correctly, so match the semantic instant in JS.
	const semantic = (
		await db.mealPlan.findMany({ where: { householdId } })
	).filter((plan) => plan.weekStart.getTime() === weekStart.getTime())
	if (semantic.length > 0) {
		// Deterministic pick for pre-existing same-week twins: oldest first.
		semantic.sort(
			(a, b) =>
				a.createdAt.getTime() - b.createdAt.getTime() ||
				a.id.localeCompare(b.id),
		)
		return semantic[0]!
	}

	const now = new Date()
	await db.$executeRaw`
		INSERT INTO "MealPlan" (
			"id", "weekStart", "householdId", "createdAt", "updatedAt"
		)
		VALUES (
			${createId()}, ${weekStart}, ${householdId}, ${now}, ${now}
		)
		ON CONFLICT ("householdId", "weekStart") DO NOTHING
	`

	return db.mealPlan.findUniqueOrThrow({
		where: { householdId_weekStart: { householdId, weekStart } },
	})
}
