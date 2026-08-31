import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { expect, test } from 'vitest'

const migrationPath = fileURLToPath(
	new URL(
		'../../prisma/migrations/20260831150000_add_shopping_horizons/migration.sql',
		import.meta.url,
	),
)

test('migration backfills existing Shopping rows to Next shop and fixes the allowed horizons', async () => {
	const db = createClient({ url: 'file::memory:' })
	try {
		await db.executeMultiple(`
			CREATE TABLE "ShoppingListItem" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"name" TEXT NOT NULL,
				"checked" BOOLEAN NOT NULL DEFAULT false,
				"listId" TEXT NOT NULL
			);
			INSERT INTO "ShoppingListItem" ("id", "name", "listId")
			VALUES ('item-1', 'Apples', 'list-1');
		`)

		await db.executeMultiple(await fs.readFile(migrationPath, 'utf8'))

		const rows = await db.execute(
			`SELECT "name", "horizon" FROM "ShoppingListItem"`,
		)
		expect(rows.rows).toEqual([{ name: 'Apples', horizon: 'next' }])

		await db.execute(
			`INSERT INTO "ShoppingListItem" ("id", "name", "listId", "horizon")
			 VALUES ('item-2', 'Candles', 'list-1', 'later')`,
		)
		await expect(
			db.execute(
				`INSERT INTO "ShoppingListItem" ("id", "name", "listId", "horizon")
				 VALUES ('item-3', 'Milk', 'list-1', 'someday')`,
			),
		).rejects.toThrow(/CHECK constraint failed/)
	} finally {
		db.close()
	}
})
