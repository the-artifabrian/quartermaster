import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { expect, test } from 'vitest'

const migrationPath = fileURLToPath(
	new URL(
		'../../prisma/migrations/20260729210000_unique_shopping_list_per_household/migration.sql',
		import.meta.url,
	),
)

test('migration merges duplicate household lists without losing their items', async () => {
	const db = createClient({ url: 'file::memory:' })
	try {
		await db.executeMultiple(`
			CREATE TABLE "ShoppingList" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"householdId" TEXT,
				"createdAt" DATETIME NOT NULL,
				"updatedAt" DATETIME NOT NULL
			);
			CREATE TABLE "ShoppingListItem" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"name" TEXT NOT NULL,
				"listId" TEXT NOT NULL
			);
			CREATE INDEX "ShoppingList_householdId_idx"
				ON "ShoppingList"("householdId");

			INSERT INTO "ShoppingList" VALUES
				('oldest', 'household-1', '2026-01-01', '2026-01-02'),
				('newer', 'household-1', '2026-01-03', '2026-01-04'),
				('other', 'household-2', '2026-01-01', '2026-01-01'),
				('orphan-1', NULL, '2026-01-01', '2026-01-01'),
				('orphan-2', NULL, '2026-01-02', '2026-01-02');
			INSERT INTO "ShoppingListItem" VALUES
				('item-1', 'Apples', 'oldest'),
				('item-2', 'Bananas', 'newer');
		`)

		await db.executeMultiple(await fs.readFile(migrationPath, 'utf8'))

		const householdLists = await db.execute(
			`SELECT "id", "updatedAt" FROM "ShoppingList"
			 WHERE "householdId" = 'household-1'`,
		)
		const mergedItems = await db.execute(
			`SELECT "name", "listId" FROM "ShoppingListItem" ORDER BY "name"`,
		)
		const orphanLists = await db.execute(
			`SELECT COUNT(*) AS "count" FROM "ShoppingList"
			 WHERE "householdId" IS NULL`,
		)

		expect({
			householdLists: householdLists.rows.map((row) => ({
				id: row.id,
				updatedAt: row.updatedAt,
			})),
			mergedItems: mergedItems.rows.map((row) => ({
				name: row.name,
				listId: row.listId,
			})),
			orphanCount: orphanLists.rows[0]?.count,
		}).toEqual({
			householdLists: [{ id: 'oldest', updatedAt: '2026-01-04' }],
			mergedItems: [
				{ name: 'Apples', listId: 'oldest' },
				{ name: 'Bananas', listId: 'oldest' },
			],
			orphanCount: 2,
		})

		await expect(
			db.execute({
				sql: `INSERT INTO "ShoppingList"
					("id", "householdId", "createdAt", "updatedAt")
					VALUES (?, ?, ?, ?)`,
				args: ['duplicate', 'household-1', '2026-01-05', '2026-01-05'],
			}),
		).rejects.toThrow(/UNIQUE constraint failed/)
	} finally {
		db.close()
	}
})
