import fs from 'node:fs/promises'
import path from 'node:path'
import { createId } from '@paralleldrive/cuid2'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'

/**
 * Executes the statements from the shipped #106 contraction migration, so the
 * SQL that retires the legacy table on the real database is what gets
 * asserted — not a reimplementation.
 *
 * The test database is created from the full migration history, which now
 * ends after the contraction — MealPlanEntry no longer exists there. Each
 * test therefore recreates the legacy table exactly as the pre-#106 schema
 * defined it, seeds the dual-write states the migration can meet, runs the
 * shipped statements, and drops any leftovers. That mirrors the deploy
 * moment: the migration runs against a database whose previous migration
 * state still holds the table.
 */
const MIGRATION_PATH = path.join(
	process.cwd(),
	'prisma/migrations/20260819100000_contract_legacy_meal_plan_entries/migration.sql',
)

const LEGACY_TABLE_DDL = `
CREATE TABLE "MealPlanEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "mealType" TEXT NOT NULL,
    "servings" INTEGER,
    "cooked" BOOLEAN NOT NULL DEFAULT false,
    "mealPlanId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MealPlanEntry_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealPlanEntry_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`

async function loadMigrationStatements() {
	const raw = await fs.readFile(MIGRATION_PATH, 'utf8')
	// Strip comment lines before splitting on ';' — comments may contain
	// semicolons, the statements themselves do not.
	const sql = raw
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('--'))
		.join('\n')
	const statements = sql
		.split(';')
		.map((statement) => statement.trim())
		.filter(Boolean)
	// Two sweep INSERTs, the renumber UPDATE, and the DROP.
	expect(statements).toHaveLength(4)
	expect(statements[3]).toContain('DROP TABLE "MealPlanEntry"')
	return statements
}

async function withLegacyTable(run: () => Promise<void>) {
	await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "MealPlanEntry"')
	await prisma.$executeRawUnsafe(LEGACY_TABLE_DDL)
	try {
		await run()
	} finally {
		await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "MealPlanEntry"')
	}
}

async function seedHousehold() {
	const user = await prisma.user.create({ data: createUser() })
	const household = await prisma.household.create({
		data: {
			name: 'Contraction Household',
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
	const plan = await prisma.mealPlan.create({
		data: { householdId: household.id, weekStart: new Date('2026-08-17') },
	})
	return { user, household, kofta, salad, plan }
}

function insertLegacyEntry(entry: {
	id: string
	date: string | number
	mealType: string
	servings?: number | null
	cooked?: boolean
	mealPlanId: string
	recipeId: string
	createdAt: string | number
}) {
	// Values are inlined, not bound: an epoch-ms number must land as SQLite
	// INTEGER for the typeof() dispatch under test, and parameter binding may
	// store JS numbers as REAL. All values here are test-controlled.
	const sqlValue = (value: string | number | null | boolean) =>
		typeof value === 'string'
			? `'${value}'`
			: typeof value === 'boolean'
				? value
					? 1
					: 0
				: (value ?? 'NULL')
	return prisma.$executeRawUnsafe(
		`INSERT INTO "MealPlanEntry" ("id", "date", "mealType", "servings", "cooked", "mealPlanId", "recipeId", "createdAt")
		 VALUES (${sqlValue(entry.id)}, ${sqlValue(entry.date)}, ${sqlValue(entry.mealType)}, ${sqlValue(entry.servings ?? null)}, ${sqlValue(entry.cooked ?? false)}, ${sqlValue(entry.mealPlanId)}, ${sqlValue(entry.recipeId)}, ${sqlValue(entry.createdAt)})`,
	)
}

test('in-sync dual-write state passes through untouched and the table drops', async () => {
	await withLegacyTable(async () => {
		const { kofta, plan } = await seedHousehold()

		// One Meal whose item is dual-write linked, one imported Meal (no link),
		// one text-only Meal — the three shapes production holds.
		const entryId = createId()
		await insertLegacyEntry({
			id: entryId,
			date: '2026-08-19T00:00:00.000+00:00',
			mealType: 'meal-linked',
			mealPlanId: plan.id,
			recipeId: kofta.id,
			createdAt: '2026-08-18T10:00:00.000+00:00',
		})
		await prisma.meal.create({
			data: {
				id: 'meal-linked',
				mealPlanId: plan.id,
				date: new Date('2026-08-19T00:00:00.000Z'),
				order: 0,
				label: 'dinner',
				recipeItems: {
					create: {
						id: `mri-bf-${entryId}`,
						order: 0,
						recipeId: kofta.id,
						recipeTitle: 'Kofta',
						scaleMultiplier: 1.5,
						cooked: true,
					},
				},
			},
		})
		await prisma.meal.create({
			data: {
				mealPlanId: plan.id,
				date: new Date('2026-08-19T00:00:00.000Z'),
				order: 1,
				genericText: 'Leftovers',
				completed: true,
			},
		})

		const before = await prisma.meal.findMany({
			where: { mealPlanId: plan.id },
			orderBy: { order: 'asc' },
			include: { recipeItems: { orderBy: { order: 'asc' } } },
		})

		for (const statement of await loadMigrationStatements()) {
			await prisma.$executeRawUnsafe(statement)
		}

		// Byte-for-byte no-op on the Meal side.
		const after = await prisma.meal.findMany({
			where: { mealPlanId: plan.id },
			orderBy: { order: 'asc' },
			include: { recipeItems: { orderBy: { order: 'asc' } } },
		})
		expect(after).toEqual(before)

		const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'MealPlanEntry'`,
		)
		expect(tables).toEqual([])
	})
})

test('orphaned entries from a cascade-dropped Meal are recreated, appended after the day, across storage eras', async () => {
	await withLegacyTable(async () => {
		const { kofta, salad, plan } = await seedHousehold()

		// The day already has one surviving, user-ordered Meal.
		await prisma.meal.create({
			data: {
				id: 'meal-existing',
				mealPlanId: plan.id,
				date: new Date('2026-08-19T00:00:00.000Z'),
				order: 0,
				genericText: 'Already here',
			},
		})

		// A dead post-#105 Meal's mirrors: mealType carries the dropped parent's
		// opaque id, which must group the composition but never become a label.
		// One row per storage era (TEXT ISO vs INTEGER epoch-ms), with a serving
		// override and cooked state to carry over. INTEGER date is midday to
		// prove UTC-day normalization.
		await insertLegacyEntry({
			id: 'orphan-b',
			date: '2026-08-19T00:00:00.000+00:00',
			mealType: 'cldeadmealcuid000000000000',
			servings: 8, // 8 / 4 recipe servings = 2×
			cooked: true,
			mealPlanId: plan.id,
			recipeId: kofta.id,
			createdAt: '2026-08-18T10:00:00.000+00:00',
		})
		await insertLegacyEntry({
			id: 'orphan-a',
			date: Date.UTC(2026, 7, 19, 13, 30),
			mealType: 'cldeadmealcuid000000000000',
			mealPlanId: plan.id,
			recipeId: salad.id,
			createdAt: Date.UTC(2026, 7, 18, 9, 0), // earlier than orphan-b
		})
		// A dead pre-#105-era Meal's mirror keeps its slot name as the label.
		await insertLegacyEntry({
			id: 'orphan-c',
			date: '2026-08-19T00:00:00.000+00:00',
			mealType: 'breakfast',
			servings: 3, // 3 / 6 recipe servings = 0.5×
			mealPlanId: plan.id,
			recipeId: salad.id,
			createdAt: '2026-08-18T11:00:00.000+00:00',
		})

		const statements = await loadMigrationStatements()
		// Run the sweep twice before dropping — it must be re-runnable.
		for (const statement of statements.slice(0, 3)) {
			await prisma.$executeRawUnsafe(statement)
		}
		for (const statement of statements) {
			await prisma.$executeRawUnsafe(statement)
		}

		const meals = await prisma.meal.findMany({
			where: { mealPlanId: plan.id },
			orderBy: { order: 'asc' },
			include: { recipeItems: { orderBy: { order: 'asc' } } },
		})
		expect(
			meals.map((meal) => [
				meal.order,
				meal.id === 'meal-existing' ? 'meal-existing' : meal.id.slice(0, 8),
				meal.label,
				meal.genericText,
			]),
		).toEqual([
			// The surviving Meal keeps its place; recreated Meals append in slot
			// order (breakfast before the unlabeled group).
			[0, 'meal-existing', null, 'Already here'],
			[1, 'meal-ct-', 'breakfast', null],
			[2, 'meal-ct-', null, null],
		])

		const breakfast = meals[1]!
		expect(breakfast.date).toEqual(new Date('2026-08-19T00:00:00.000Z'))
		expect(
			breakfast.recipeItems.map((item) => [
				item.id,
				item.recipeTitle,
				item.scaleMultiplier,
				item.cooked,
			]),
		).toEqual([['mri-bf-orphan-c', 'Salad', 0.5, false]])

		const recreated = meals[2]!
		expect(recreated.date).toEqual(new Date('2026-08-19T00:00:00.000Z'))
		expect(
			recreated.recipeItems.map((item) => [
				item.id,
				item.order,
				item.recipeTitle,
				item.scaleMultiplier,
				item.cooked,
			]),
		).toEqual([
			// Item order by createdAt then id: the INTEGER-era row is older.
			['mri-bf-orphan-a', 0, 'Salad', 1, false],
			['mri-bf-orphan-b', 1, 'Kofta', 2, true],
		])
	})
})
