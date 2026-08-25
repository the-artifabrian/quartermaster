import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { expect, test } from 'vitest'

const migrationPath = fileURLToPath(
	new URL(
		'../../prisma/migrations/20260825120000_add_household_staples_cutover/migration.sql',
		import.meta.url,
	),
)

test('migration adds recoverable household Staples without changing legacy Pantry data', async () => {
	const db = createClient({ url: 'file::memory:' })
	try {
		await db.executeMultiple(`
			PRAGMA foreign_keys = ON;
			CREATE TABLE "Household" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"name" TEXT NOT NULL DEFAULT 'My Household',
				"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				"updatedAt" DATETIME NOT NULL
			);
			CREATE TABLE "InventoryItem" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"name" TEXT NOT NULL,
				"householdId" TEXT,
				"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				"updatedAt" DATETIME NOT NULL
			);
			INSERT INTO "Household" ("id", "name", "updatedAt") VALUES
				('household-1', 'Home', '2026-08-25T09:00:00.000Z'),
				('household-2', 'Other', '2026-08-25T09:00:00.000Z');
			INSERT INTO "InventoryItem" ("id", "name", "householdId", "updatedAt") VALUES
				('pantry-1', 'Olive oil', 'household-1', '2026-08-25T09:00:00.000Z'),
				('pantry-2', 'Garlic', 'household-1', '2026-08-25T09:00:00.000Z');
		`)

		await db.executeMultiple(await fs.readFile(migrationPath, 'utf8'))

		const householdColumns = await db.execute(`PRAGMA table_info("Household")`)
		expect(
			householdColumns.rows.map((column) => [column.name, column.notnull]),
		).toContainEqual(['staplesCutoverAt', 0])

		const baseline = await db.execute(`
			SELECT
				(SELECT COUNT(*) FROM "Household") AS "households",
				(SELECT COUNT(*) FROM "InventoryItem") AS "inventoryItems",
				(SELECT COUNT(*) FROM "HouseholdIngredient") AS "ingredients",
				(SELECT COUNT(*) FROM "Household" WHERE "staplesCutoverAt" IS NOT NULL) AS "cutovers"
		`)
		expect(baseline.rows[0]).toMatchObject({
			households: 2,
			inventoryItems: 2,
			ingredients: 0,
			cutovers: 0,
		})

		await db.execute({
			sql: `INSERT INTO "HouseholdIngredient"
				("id", "displayName", "canonicalKey", "isStaple", "isOut", "createdAt", "updatedAt", "householdId")
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				'staple-1',
				'Olive oil',
				'olive oil',
				1,
				0,
				'2026-08-25T10:00:00.000Z',
				'2026-08-25T10:00:00.000Z',
				'household-1',
			],
		})

		await expect(
			db.execute({
				sql: `INSERT INTO "HouseholdIngredient"
					("id", "displayName", "canonicalKey", "isStaple", "isOut", "createdAt", "updatedAt", "householdId")
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [
					'staple-duplicate',
					'OLIVE OIL',
					'olive oil',
					1,
					0,
					'2026-08-25T10:00:00.000Z',
					'2026-08-25T10:00:00.000Z',
					'household-1',
				],
			}),
		).rejects.toThrow(/UNIQUE constraint failed/)

		await expect(
			db.execute({
				sql: `INSERT INTO "HouseholdIngredient"
					("id", "displayName", "canonicalKey", "isStaple", "isOut", "createdAt", "updatedAt", "householdId")
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [
					'not-a-staple',
					'Lemons',
					'lemons',
					0,
					1,
					'2026-08-25T10:00:00.000Z',
					'2026-08-25T10:00:00.000Z',
					'household-1',
				],
			}),
		).rejects.toThrow(/CHECK constraint failed/)

		await db.execute(`DELETE FROM "Household" WHERE "id" = 'household-1'`)
		const afterHouseholdDelete = await db.execute(
			`SELECT COUNT(*) AS "count" FROM "HouseholdIngredient"`,
		)
		expect(afterHouseholdDelete.rows[0]?.count).toBe(0)
		const archivedPantry = await db.execute(
			`SELECT "name" FROM "InventoryItem" ORDER BY "name"`,
		)
		expect(archivedPantry.rows.map((row) => row.name)).toEqual([
			'Garlic',
			'Olive oil',
		])
	} finally {
		db.close()
	}
})
