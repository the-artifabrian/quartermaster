import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { expect, test } from 'vitest'

const migrationPath = fileURLToPath(
	new URL(
		'../../prisma/migrations/20260831110000_add_recipe_classification/migration.sql',
		import.meta.url,
	),
)

test('migration seeds the constrained household vocabulary without changing Recipes', async () => {
	const db = createClient({ url: 'file::memory:' })
	try {
		await db.executeMultiple(`
			PRAGMA foreign_keys=ON;
			CREATE TABLE "Household" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"name" TEXT NOT NULL
			);
			CREATE TABLE "Recipe" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"title" TEXT NOT NULL,
				"householdId" TEXT,
				CONSTRAINT "Recipe_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE SET NULL ON UPDATE CASCADE
			);
			INSERT INTO "Household" ("id", "name") VALUES
				('household-1', 'One'),
				('household-2', 'Two');
			INSERT INTO "Recipe" ("id", "title", "householdId") VALUES
				('recipe-1', 'Soup', 'household-1'),
				('recipe-2', 'Cake', 'household-2');
		`)

		const recipesBefore = await db.execute(
			`SELECT * FROM "Recipe" ORDER BY "id"`,
		)
		await db.executeMultiple(await fs.readFile(migrationPath, 'utf8'))

		const seeded = await db.execute(`
			SELECT "householdId", "dimension", "name", "nameKey", "sortOrder"
			FROM "RecipeMetadataValue"
			ORDER BY "householdId", "dimension", "sortOrder"
		`)
		expect(seeded.rows).toHaveLength(18)
		expect(
			seeded.rows.filter((value) => value.householdId === 'household-1'),
		).toEqual([
			{
				householdId: 'household-1',
				dimension: 'course',
				name: 'Breakfast',
				nameKey: 'breakfast',
				sortOrder: 0,
			},
			{
				householdId: 'household-1',
				dimension: 'course',
				name: 'Main',
				nameKey: 'main',
				sortOrder: 10,
			},
			{
				householdId: 'household-1',
				dimension: 'course',
				name: 'Side',
				nameKey: 'side',
				sortOrder: 20,
			},
			{
				householdId: 'household-1',
				dimension: 'course',
				name: 'Dessert',
				nameKey: 'dessert',
				sortOrder: 30,
			},
			{
				householdId: 'household-1',
				dimension: 'season',
				name: 'Year-round',
				nameKey: 'year-round',
				sortOrder: 0,
			},
			{
				householdId: 'household-1',
				dimension: 'season',
				name: 'Spring',
				nameKey: 'spring',
				sortOrder: 10,
			},
			{
				householdId: 'household-1',
				dimension: 'season',
				name: 'Summer',
				nameKey: 'summer',
				sortOrder: 20,
			},
			{
				householdId: 'household-1',
				dimension: 'season',
				name: 'Autumn',
				nameKey: 'autumn',
				sortOrder: 30,
			},
			{
				householdId: 'household-1',
				dimension: 'season',
				name: 'Winter',
				nameKey: 'winter',
				sortOrder: 40,
			},
		])
		expect(await db.execute(`SELECT * FROM "Recipe" ORDER BY "id"`)).toEqual(
			expect.objectContaining({ rows: recipesBefore.rows }),
		)
		expect((await db.execute(`PRAGMA foreign_key_check`)).rows).toEqual([])
	} finally {
		db.close()
	}
})

test('migration enforces dimension, household identity, and assignment integrity', async () => {
	const db = createClient({ url: 'file::memory:' })
	try {
		await db.executeMultiple(`
			PRAGMA foreign_keys=ON;
			CREATE TABLE "Household" ("id" TEXT NOT NULL PRIMARY KEY);
			CREATE TABLE "Recipe" ("id" TEXT NOT NULL PRIMARY KEY);
			INSERT INTO "Household" ("id") VALUES ('household-1');
			INSERT INTO "Recipe" ("id") VALUES ('recipe-1');
		`)
		await db.executeMultiple(await fs.readFile(migrationPath, 'utf8'))

		await db.execute(`
			INSERT INTO "RecipeMetadataValue"
				("id", "dimension", "name", "nameKey", "updatedAt", "householdId")
			VALUES ('cuisine-1', 'cuisine', 'Levantine', 'levantine', CURRENT_TIMESTAMP, 'household-1')
		`)
		await expect(
			db.execute(`
				INSERT INTO "RecipeMetadataValue"
					("id", "dimension", "name", "nameKey", "updatedAt", "householdId")
				VALUES ('cuisine-2', 'cuisine', 'LEVANTINE', 'levantine', CURRENT_TIMESTAMP, 'household-1')
			`),
		).rejects.toThrow(/UNIQUE constraint failed/)
		await expect(
			db.execute(`
				INSERT INTO "RecipeMetadataValue"
					("id", "dimension", "name", "nameKey", "updatedAt", "householdId")
				VALUES ('tag-1', 'tag', 'Fast', 'fast', CURRENT_TIMESTAMP, 'household-1')
			`),
		).rejects.toThrow(/CHECK constraint failed/)

		await db.execute(`
			INSERT INTO "RecipeMetadataAssignment" ("recipeId", "valueId")
			VALUES ('recipe-1', 'cuisine-1')
		`)
		await db.execute(`DELETE FROM "Recipe" WHERE "id" = 'recipe-1'`)
		expect(
			(
				await db.execute(
					`SELECT count(*) AS "count" FROM "RecipeMetadataAssignment"`,
				)
			).rows,
		).toEqual([{ count: 0 }])
	} finally {
		db.close()
	}
})
