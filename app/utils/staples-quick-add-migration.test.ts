import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { beforeEach, expect, test } from 'vitest'

const migrationPath = fileURLToPath(
	new URL(
		'../../prisma/migrations/20260922120000_drop_staples_out_and_legacy_pantry/migration.sql',
		import.meta.url,
	),
)

/**
 * The schema as it stood before #289: a cutover flag, an archived Pantry, and
 * Staples carrying an Out state behind a CHECK constraint.
 */
async function seedLegacySchema() {
	const db = createClient({ url: 'file::memory:' })
	await db.executeMultiple(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE "Household" (
			"id" TEXT NOT NULL PRIMARY KEY,
			"name" TEXT NOT NULL DEFAULT 'My Household',
			"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"updatedAt" DATETIME NOT NULL,
			"staplesCutoverAt" DATETIME
		);
		CREATE TABLE "InventoryItem" (
			"id" TEXT NOT NULL PRIMARY KEY,
			"name" TEXT NOT NULL,
			"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"updatedAt" DATETIME NOT NULL,
			"householdId" TEXT,
			CONSTRAINT "InventoryItem_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE SET NULL ON UPDATE CASCADE
		);
		CREATE TABLE "HouseholdIngredient" (
			"id" TEXT NOT NULL PRIMARY KEY,
			"displayName" TEXT NOT NULL,
			"canonicalKey" TEXT NOT NULL,
			"isStaple" BOOLEAN NOT NULL DEFAULT false,
			"isOut" BOOLEAN NOT NULL DEFAULT false,
			"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"updatedAt" DATETIME NOT NULL,
			"householdId" TEXT NOT NULL,
			CONSTRAINT "HouseholdIngredient_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT "HouseholdIngredient_out_requires_staple" CHECK ("isOut" = false OR "isStaple" = true)
		);
		CREATE UNIQUE INDEX "HouseholdIngredient_householdId_canonicalKey_key" ON "HouseholdIngredient"("householdId", "canonicalKey");
		CREATE INDEX "HouseholdIngredient_householdId_isStaple_isOut_idx" ON "HouseholdIngredient"("householdId", "isStaple", "isOut");

		INSERT INTO "Household" ("id", "name", "updatedAt", "staplesCutoverAt") VALUES
			('legacy', 'Never cut over', '2026-09-22T09:00:00.000Z', NULL),
			('switched', 'Cut over', '2026-09-22T09:00:00.000Z', '2026-09-04T15:44:20.120Z');

		INSERT INTO "InventoryItem" ("id", "name", "createdAt", "updatedAt", "householdId") VALUES
			('pantry-1', 'OLIVE OIL', '2026-09-02T09:00:00.000Z', '2026-09-22T09:00:00.000Z', 'legacy'),
			('pantry-2', '  Olive   oil ', '2026-09-01T09:00:00.000Z', '2026-09-22T09:00:00.000Z', 'legacy'),
			('pantry-3', 'Garlic', '2026-09-01T09:00:00.000Z', '2026-09-22T09:00:00.000Z', 'legacy'),
			('pantry-4', '   ', '2026-09-01T09:00:00.000Z', '2026-09-22T09:00:00.000Z', 'legacy'),
			('pantry-5', 'Orphaned', '2026-09-01T09:00:00.000Z', '2026-09-22T09:00:00.000Z', NULL),
			('pantry-6', 'Archived rice', '2026-09-01T09:00:00.000Z', '2026-09-22T09:00:00.000Z', 'switched');

		INSERT INTO "HouseholdIngredient"
			("id", "displayName", "canonicalKey", "isStaple", "isOut", "createdAt", "updatedAt", "householdId")
		VALUES
			('kept', 'Garlic', 'garlic', 0, 0, '2026-09-01T09:00:00.000Z', '2026-09-01T09:00:00.000Z', 'legacy'),
			('out', 'Brown rice', 'brown rice', 1, 1, '2026-09-01T09:00:00.000Z', '2026-09-01T09:00:00.000Z', 'switched'),
			('available', 'Salt', 'salt', 1, 0, '2026-09-01T09:00:00.000Z', '2026-09-01T09:00:00.000Z', 'switched');
	`)
	return db
}

let db: Awaited<ReturnType<typeof seedLegacySchema>>

beforeEach(async () => {
	db = await seedLegacySchema()
	return () => db.close()
})

async function migrate() {
	await db.executeMultiple(await fs.readFile(migrationPath, 'utf8'))
}

test('a household that never cut over keeps its Pantry as Staples', async () => {
	await migrate()

	const staples = await db.execute(`
		SELECT "displayName", "canonicalKey", "isStaple"
		FROM "HouseholdIngredient"
		WHERE "householdId" = 'legacy'
		ORDER BY "canonicalKey"
	`)
	// Whitespace is collapsed and case folded exactly as
	// householdIngredientKey() does, so the two olive oil rows converge on one
	// Staple, named the way the household first typed it. A blank Pantry name
	// and one orphaned from its household bring nothing across.
	expect(
		staples.rows.map((row) => [row.canonicalKey, row.displayName]),
	).toEqual([
		['garlic', 'Garlic'],
		['olive oil', 'Olive oil'],
	])
	// The identity the household already had keeps its own row and its own
	// classification rather than being overwritten by a Pantry copy.
	expect(
		staples.rows.find((row) => row.canonicalKey === 'garlic'),
	).toMatchObject({ isStaple: 0 })
	expect(
		staples.rows.find((row) => row.canonicalKey === 'olive oil'),
	).toMatchObject({ isStaple: 1 })
})

test('an archived Pantry behind a completed cutover is not resurrected', async () => {
	await migrate()

	const staples = await db.execute(`
		SELECT "canonicalKey" FROM "HouseholdIngredient" WHERE "householdId" = 'switched'
	`)
	expect(staples.rows.map((row) => row.canonicalKey).sort()).toEqual([
		'brown rice',
		'salt',
	])
})

test('Out, the Pantry table and the cutover flag are gone', async () => {
	await migrate()

	const ingredientColumns = await db.execute(
		`PRAGMA table_info("HouseholdIngredient")`,
	)
	expect(ingredientColumns.rows.map((column) => column.name)).not.toContain(
		'isOut',
	)
	const householdColumns = await db.execute(`PRAGMA table_info("Household")`)
	expect(householdColumns.rows.map((column) => column.name)).not.toContain(
		'staplesCutoverAt',
	)
	const tables = await db.execute(
		`SELECT "name" FROM sqlite_master WHERE "type" = 'table'`,
	)
	expect(tables.rows.map((row) => row.name)).not.toContain('InventoryItem')

	const indexes = await db.execute(
		`SELECT "name" FROM sqlite_master WHERE "type" = 'index' AND "tbl_name" = 'HouseholdIngredient'`,
	)
	expect(indexes.rows.map((row) => row.name)).toEqual(
		expect.arrayContaining([
			'HouseholdIngredient_householdId_canonicalKey_key',
			'HouseholdIngredient_householdId_isStaple_idx',
		]),
	)
})

test('household identity stays unique after the rebuild', async () => {
	await migrate()

	await expect(
		db.execute({
			sql: `INSERT INTO "HouseholdIngredient"
				("id", "displayName", "canonicalKey", "isStaple", "createdAt", "updatedAt", "householdId")
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
			args: [
				'duplicate',
				'SALT',
				'salt',
				1,
				'2026-09-22T10:00:00.000Z',
				'2026-09-22T10:00:00.000Z',
				'switched',
			],
		}),
	).rejects.toThrow()
})

test('removing a household still cascades to its Staples', async () => {
	await migrate()

	await db.execute(`DELETE FROM "Household" WHERE "id" = 'switched'`)
	const remaining = await db.execute(
		`SELECT COUNT(*) AS "count" FROM "HouseholdIngredient" WHERE "householdId" = 'switched'`,
	)
	expect(remaining.rows[0]).toMatchObject({ count: 0 })
})
