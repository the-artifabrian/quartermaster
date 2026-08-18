import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'

/**
 * Executes the shipped #105 delta migration (and, to set the stage, the #104
 * backfill inserts) against seeded legacy rows, so the SQL that reconciles
 * real Plan data is what gets asserted — not a reimplementation. The delta
 * runs at the deploy that switches the planner onto Meals and must absorb
 * every legacy write made since the backfill deploy: new entries, cooked and
 * serving-override changes, deletions, and Meals cascade-dropped by
 * sole-member household moves — without touching Meals restored by import.
 */
const BACKFILL_PATH = path.join(
	process.cwd(),
	'prisma/migrations/20260818085429_add_meal_parents/migration.sql',
)
const DELTA_PATH = path.join(
	process.cwd(),
	'prisma/migrations/20260818141000_meal_backfill_delta/migration.sql',
)

async function readStatements(migrationPath: string) {
	const raw = await fs.readFile(migrationPath, 'utf8')
	// Strip comment lines before splitting on ';' — comments may contain
	// semicolons, the statements themselves do not.
	return raw
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('--'))
		.join('\n')
		.split(';')
		.map((statement) => statement.trim())
		.filter(Boolean)
}

async function runBackfill() {
	const statements = (await readStatements(BACKFILL_PATH)).filter((statement) =>
		statement.includes('INSERT INTO "Meal'),
	)
	expect(statements).toHaveLength(2)
	for (const statement of statements) {
		await prisma.$executeRawUnsafe(statement)
	}
}

async function runDelta() {
	const statements = await readStatements(DELTA_PATH)
	expect(statements).toHaveLength(5)
	for (const statement of statements) {
		await prisma.$executeRawUnsafe(statement)
	}
}

async function seedHousehold() {
	const user = await prisma.user.create({ data: createUser() })
	const household = await prisma.household.create({
		data: {
			name: 'Delta Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const stew = await prisma.recipe.create({
		data: {
			title: 'Stew',
			servings: 4,
			userId: user.id,
			householdId: household.id,
		},
	})
	const bread = await prisma.recipe.create({
		data: {
			title: 'Bread',
			servings: 8,
			userId: user.id,
			householdId: household.id,
		},
	})
	const salad = await prisma.recipe.create({
		data: {
			title: 'Salad',
			servings: 2,
			userId: user.id,
			householdId: household.id,
		},
	})
	const plan = await prisma.mealPlan.create({
		data: { householdId: household.id, weekStart: new Date('2026-08-17') },
	})
	return { user, household, stew, bread, salad, plan }
}

async function createEntry(entry: {
	id: string
	date: Date
	mealType: string
	servings?: number
	cooked?: boolean
	mealPlanId: string
	recipeId: string
	createdAt: Date
}) {
	await prisma.mealPlanEntry.create({ data: entry })
}

function snapshot() {
	return Promise.all([
		prisma.meal.findMany({ orderBy: { id: 'asc' } }),
		prisma.mealRecipeItem.findMany({ orderBy: { id: 'asc' } }),
	])
}

test('the delta reconciles every kind of post-backfill legacy change and is idempotent', async () => {
	const { stew, bread, salad, plan } = await seedHousehold()
	const wed = new Date('2026-08-19')
	const thu = new Date('2026-08-20')

	// Backfilled world: a two-entry dinner and a one-entry lunch.
	await createEntry({
		id: 'd-first',
		date: wed,
		mealType: 'dinner',
		mealPlanId: plan.id,
		recipeId: stew.id,
		createdAt: new Date(1000),
	})
	await createEntry({
		id: 'd-second',
		date: wed,
		mealType: 'dinner',
		servings: 2,
		mealPlanId: plan.id,
		recipeId: bread.id,
		createdAt: new Date(2000),
	})
	await createEntry({
		id: 'l-only',
		date: wed,
		mealType: 'lunch',
		mealPlanId: plan.id,
		recipeId: stew.id,
		createdAt: new Date(3000),
	})
	await runBackfill()

	// Legacy activity after the backfill deploy:
	// 1. a new entry joins the existing dinner group,
	await createEntry({
		id: 'd-third',
		date: wed,
		mealType: 'dinner',
		servings: 6,
		mealPlanId: plan.id,
		recipeId: salad.id,
		createdAt: new Date(9000),
	})
	// 2. a brand-new Thursday breakfast group appears, mixing an old
	//    INTEGER-era row (earlier createdAt, lowest id → meal id anchor) with a
	//    TEXT-era row,
	await prisma.$executeRawUnsafe(
		`INSERT INTO "MealPlanEntry" ("id", "date", "mealType", "servings", "cooked", "mealPlanId", "recipeId", "createdAt")
		 VALUES ('b-int-era', ${thu.getTime() + 3600_000}, 'breakfast', 2, 0, '${plan.id}', '${stew.id}', 4000)`,
	)
	await createEntry({
		id: 'b-text-era',
		date: thu,
		mealType: 'breakfast',
		cooked: true,
		mealPlanId: plan.id,
		recipeId: bread.id,
		createdAt: new Date(5000),
	})
	// 3. cooked and serving overrides change on backfilled entries,
	await prisma.mealPlanEntry.update({
		where: { id: 'd-second' },
		data: { cooked: true, servings: 4 },
	})
	// 4. the dinner group's FIRST entry is deleted (the group's MIN(id) meal
	//    anchor is lost; the meal must survive by key, not id),
	await prisma.mealPlanEntry.delete({ where: { id: 'd-first' } })
	// 5. a sole-member household move cascade-dropped the lunch Meal while its
	//    entry survived (PR #150's caveat),
	await prisma.meal.delete({ where: { id: 'meal-bf-l-only' } })
	// 6. the surviving lunch entry moves to Thursday, founding a new group
	//    there (its deterministic Meal id is free again after 5),
	await prisma.mealPlanEntry.update({
		where: { id: 'l-only' },
		data: { date: thu },
	})
	// 7. and d-second moves to Thursday dinner while its deterministic Meal id
	//    is already taken by a surviving Meal — as when the moved entry was
	//    its old group's id anchor — forcing the 'meal-bf2-' fallback. The
	//    rename makes the Wednesday dinner Meal that anchor.
	await prisma.$executeRawUnsafe(
		`UPDATE "Meal" SET "id" = 'meal-bf-d-second' WHERE "id" = 'meal-bf-d-first'`,
	)
	await prisma.mealPlanEntry.update({
		where: { id: 'd-second' },
		data: { date: thu },
	})

	await runDelta()

	const meals = await prisma.meal.findMany({
		where: { mealPlanId: plan.id },
		orderBy: [{ date: 'asc' }, { order: 'asc' }],
		include: { recipeItems: { orderBy: { order: 'asc' } } },
	})

	expect(
		meals.map((meal) => [
			meal.id,
			meal.date.toISOString().slice(0, 10),
			meal.order,
			meal.label,
			meal.recipeItems.map((item) => [
				item.id,
				item.order,
				item.scaleMultiplier,
				item.cooked,
			]),
		]),
	).toEqual([
		// Wednesday: only the dinner survives (lunch moved away after its Meal
		// was cascade-dropped), holding d-third alone — 6 / 2 servings = 3×.
		[
			'meal-bf-d-second',
			'2026-08-19',
			0,
			'dinner',
			[['mri-bf-d-third', 0, 3, false]],
		],
		// Thursday in migrated slot order: breakfast, lunch, dinner. The
		// breakfast merges both storage eras and orders items by createdAt.
		[
			'meal-bf-b-int-era',
			'2026-08-20',
			0,
			'breakfast',
			[
				['mri-bf-b-int-era', 0, 0.5, false],
				['mri-bf-b-text-era', 1, 1, true],
			],
		],
		// The cascade-dropped lunch Meal is recreated at the entry's new day.
		['meal-bf-l-only', '2026-08-20', 1, 'lunch', [['mri-bf-l-only', 0, 1, false]]],
		// d-second moved here; its deterministic id was taken by the Wednesday
		// meal, so the delta fell back to the 'meal-bf2-' prefix. Its changed
		// cooked state and override (4 / 8 servings = 0.5×) reconciled too.
		[
			'meal-bf2-d-second',
			'2026-08-20',
			2,
			'dinner',
			[['mri-bf-d-second', 0, 0.5, true]],
		],
	])

	// Deleted entry's item is gone with its entry.
	expect(
		await prisma.mealRecipeItem.findUnique({ where: { id: 'mri-bf-d-first' } }),
	).toBeNull()

	// Running the delta again changes nothing.
	const before = await snapshot()
	await runDelta()
	expect(await snapshot()).toEqual(before)
})

test('the delta never touches imported Meals beyond keeping them after backfilled ones in day order', async () => {
	const { stew, plan } = await seedHousehold()
	const fri = new Date('2026-08-21')
	const sat = new Date('2026-08-22')

	// Meals restored by JSON import carry ordinary cuids: a text-only Meal
	// (no items — the empty-Meal cleanup must not eat it) and a Recipe Meal.
	const importedText = await prisma.meal.create({
		data: {
			date: fri,
			order: 0,
			genericText: 'Leftovers',
			completed: true,
			mealPlanId: plan.id,
		},
	})
	const importedRecipe = await prisma.meal.create({
		data: {
			date: fri,
			order: 1,
			label: 'dinner',
			guestCount: 6,
			mealPlanId: plan.id,
			recipeItems: {
				create: [
					{ order: 0, recipeTitle: 'Stew', scaleMultiplier: 2, recipeId: stew.id },
				],
			},
		},
	})
	// An imported Meal on a day with no backfill activity keeps its exact order.
	const importedElsewhere = await prisma.meal.create({
		data: { date: sat, order: 5, genericText: 'Out', mealPlanId: plan.id },
	})

	// A legacy entry written since the backfill lands on the imported Meals' day.
	await createEntry({
		id: 'f-dinner',
		date: fri,
		mealType: 'dinner',
		mealPlanId: plan.id,
		recipeId: stew.id,
		createdAt: new Date(1000),
	})

	await runDelta()

	const meals = await prisma.meal.findMany({
		where: { mealPlanId: plan.id, date: fri },
		orderBy: { order: 'asc' },
		include: { recipeItems: true },
	})
	// The reconciled backfill Meal comes first; imported Meals follow in their
	// existing relative order, contents untouched. The imported dinner is NOT
	// merged with the legacy dinner group — import created a separate Meal.
	expect(
		meals.map((meal) => [meal.id, meal.order, meal.genericText, meal.completed]),
	).toEqual([
		['meal-bf-f-dinner', 0, null, false],
		[importedText.id, 1, 'Leftovers', true],
		[importedRecipe.id, 2, null, false],
	])
	expect(meals[2]!.guestCount).toBe(6)
	expect(meals[2]!.recipeItems).toHaveLength(1)
	expect(meals[2]!.recipeItems[0]!.scaleMultiplier).toBe(2)

	const untouched = await prisma.meal.findUniqueOrThrow({
		where: { id: importedElsewhere.id },
	})
	expect(untouched.order).toBe(5)
	expect(untouched.genericText).toBe('Out')
})
