import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'

/**
 * Executes the backfill statements from the shipped #104 migration against
 * legacy MealPlanEntry rows seeded into the test database, so the SQL that
 * migrates real Plan data is what gets asserted — not a reimplementation.
 * The test database is created from the full migration history, so the Meal
 * tables already exist and start empty, exactly like the moment the deployed
 * backfill runs.
 */
const MIGRATION_PATH = path.join(
	process.cwd(),
	'prisma/migrations/20260818085429_add_meal_parents/migration.sql',
)

async function runBackfill() {
	const raw = await fs.readFile(MIGRATION_PATH, 'utf8')
	// Strip comment lines before splitting on ';' — comments may contain
	// semicolons, the statements themselves do not.
	const sql = raw
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('--'))
		.join('\n')
	const inserts = sql
		.split(';')
		.map((statement) => statement.trim())
		.filter((statement) => statement.startsWith('INSERT INTO "Meal'))
	expect(inserts).toHaveLength(2)
	for (const statement of inserts) {
		await prisma.$executeRawUnsafe(statement)
	}
}

async function seedLegacyPlan() {
	const user = await prisma.user.create({ data: createUser() })
	const household = await prisma.household.create({
		data: {
			name: 'Backfill Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const kofta = await prisma.recipe.create({
		data: {
			title: 'Kofta',
			servings: 4,
			userId: user.id,
			householdId: household.id,
		},
	})
	const salad = await prisma.recipe.create({
		data: {
			title: 'Salad',
			servings: 6,
			userId: user.id,
			householdId: household.id,
		},
	})
	const cake = await prisma.recipe.create({
		data: {
			title: 'Orange Cake',
			servings: 8,
			userId: user.id,
			householdId: household.id,
		},
	})
	const plan = await prisma.mealPlan.create({
		data: { householdId: household.id, weekStart: new Date('2026-08-17') },
	})
	const day = new Date('2026-08-19')

	// One multi-Recipe dinner (with a createdAt tie broken by id), a cooked
	// breakfast with a serving override, a plain lunch, a snack, and two
	// unexpected labels that must sort lexically after the familiar four.
	const entries: Array<{
		id: string
		mealType: string
		servings?: number
		cooked?: boolean
		recipeId: string
		createdAt: Date
	}> = [
		// dinner: created later than the tied pair below
		{
			id: 'e-din-late',
			mealType: 'dinner',
			servings: 8, // 8 / 4 servings = 2×
			recipeId: kofta.id,
			createdAt: new Date(3000),
		},
		{
			id: 'e-din-tie-b',
			mealType: 'dinner',
			recipeId: salad.id,
			cooked: true,
			createdAt: new Date(1000),
		},
		{
			id: 'e-din-tie-a',
			mealType: 'dinner',
			servings: 2, // 2 / 8 servings = 0.25×
			recipeId: cake.id,
			createdAt: new Date(1000),
		},
		{
			id: 'e-breakfast',
			mealType: 'breakfast',
			servings: 3, // 3 / 6 servings = 0.5×
			cooked: true,
			recipeId: salad.id,
			createdAt: new Date(2000),
		},
		{
			id: 'e-lunch',
			mealType: 'lunch',
			recipeId: kofta.id,
			createdAt: new Date(4000),
		},
		{
			id: 'e-snack',
			mealType: 'snack',
			recipeId: cake.id,
			createdAt: new Date(5000),
		},
		{
			id: 'e-brunch',
			mealType: 'brunch',
			recipeId: salad.id,
			createdAt: new Date(6000),
		},
		{
			id: 'e-tea',
			mealType: 'afternoon-tea',
			recipeId: kofta.id,
			createdAt: new Date(7000),
		},
	]
	for (const entry of entries) {
		await prisma.mealPlanEntry.create({
			data: { ...entry, date: day, mealPlanId: plan.id },
		})
	}
	return { plan, day, kofta, salad, cake }
}

test('the backfill groups legacy entries into ordered Meals and preserves every field', async () => {
	const { plan, day, kofta, salad, cake } = await seedLegacyPlan()

	await runBackfill()

	const meals = await prisma.meal.findMany({
		where: { mealPlanId: plan.id },
		orderBy: { order: 'asc' },
		include: { recipeItems: { orderBy: { order: 'asc' } } },
	})

	// Migrated Meal order: breakfast, lunch, dinner, snack, then unexpected
	// labels lexically (#98 readiness corrections).
	expect(meals.map((meal) => [meal.order, meal.label])).toEqual([
		[0, 'breakfast'],
		[1, 'lunch'],
		[2, 'dinner'],
		[3, 'snack'],
		[4, 'afternoon-tea'],
		[5, 'brunch'],
	])

	// Backfilled Meals carry only what legacy rows knew: date and label. No
	// generic text, serving time, guest count, Menu source, or completion.
	for (const meal of meals) {
		expect(meal.date).toEqual(day)
		expect(meal).toMatchObject({
			genericText: null,
			completed: false,
			servingAt: null,
			servingTimeZone: null,
			guestCount: null,
			sourceMenuId: null,
			sourceMenuRevision: null,
		})
	}

	// Items within a migrated Meal order by createdAt then id; the serving
	// override migrates as override / Recipe.servings, absent override as 1×;
	// cooked state and the Recipe link/frozen title carry over per item.
	const dinner = meals[2]!
	expect(
		dinner.recipeItems.map((item) => [
			item.order,
			item.recipeId,
			item.recipeTitle,
			item.scaleMultiplier,
			item.cooked,
		]),
	).toEqual([
		[0, cake.id, 'Orange Cake', 0.25, false],
		[1, salad.id, 'Salad', 1, true],
		[2, kofta.id, 'Kofta', 2, false],
	])
	const breakfast = meals[0]!
	expect(
		breakfast.recipeItems.map((item) => [
			item.recipeTitle,
			item.scaleMultiplier,
			item.cooked,
		]),
	).toEqual([['Salad', 0.5, true]])
	expect(meals.flatMap((meal) => meal.recipeItems)).toHaveLength(8)

	// Legacy rows stay untouched — the current planner keeps reading them.
	const legacyEntries = await prisma.mealPlanEntry.findMany({
		where: { mealPlanId: plan.id },
	})
	expect(legacyEntries).toHaveLength(8)
	expect(
		legacyEntries.find((entry) => entry.id === 'e-din-late'),
	).toMatchObject({ mealType: 'dinner', servings: 8, cooked: false })
})

test('the backfill keeps plans separate: same date and meal type in two week plans become two Meals', async () => {
	const { plan, day, kofta } = await seedLegacyPlan()
	const otherPlan = await prisma.mealPlan.create({
		data: {
			householdId: (
				await prisma.mealPlan.findUniqueOrThrow({
					where: { id: plan.id },
					select: { householdId: true },
				})
			).householdId,
			weekStart: new Date('2026-08-24'),
		},
	})
	await prisma.mealPlanEntry.create({
		data: {
			id: 'e-other-plan',
			date: day,
			mealType: 'dinner',
			mealPlanId: otherPlan.id,
			recipeId: kofta.id,
			createdAt: new Date(9000),
		},
	})

	await runBackfill()

	const dinners = await prisma.meal.findMany({
		where: { label: 'dinner', date: day },
		select: { mealPlanId: true, recipeItems: { select: { id: true } } },
	})
	expect(dinners).toHaveLength(2)
	expect(new Set(dinners.map((meal) => meal.mealPlanId))).toEqual(
		new Set([plan.id, otherPlan.id]),
	)
	expect(
		dinners.find((meal) => meal.mealPlanId === otherPlan.id)?.recipeItems,
	).toHaveLength(1)
})
