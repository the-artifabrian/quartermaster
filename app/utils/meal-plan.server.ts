import { createId } from '@paralleldrive/cuid2'
import { type Prisma } from '#app/generated/prisma/client.ts'

type MealPlanDatabase = Pick<
	Prisma.TransactionClient,
	'$executeRaw' | 'mealPlan'
>

type MealPlanEntryDatabase = Pick<Prisma.TransactionClient, '$executeRaw'>

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

export async function ensureMealPlanEntry(
	db: MealPlanEntryDatabase,
	{
		mealPlanId,
		date,
		mealType,
		recipeId,
		servings = null,
		cooked = false,
	}: {
		mealPlanId: string
		date: Date
		mealType: string
		recipeId: string
		servings?: number | null
		cooked?: boolean
	},
) {
	const inserted = await db.$executeRaw`
		INSERT INTO "MealPlanEntry" (
			"id", "date", "mealType", "servings", "cooked",
			"mealPlanId", "recipeId", "createdAt"
		)
		VALUES (
			${createId()}, ${date}, ${mealType}, ${servings}, ${cooked},
			${mealPlanId}, ${recipeId}, ${new Date()}
		)
		ON CONFLICT (
			"mealPlanId", "date", "mealType", "recipeId"
		) DO NOTHING
	`

	return { created: inserted > 0 }
}
