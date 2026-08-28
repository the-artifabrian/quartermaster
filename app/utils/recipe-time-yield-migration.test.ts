import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { expect, test } from 'vitest'

const migrationPath = fileURLToPath(
	new URL(
		'../../prisma/migrations/20260828120000_add_recipe_time_yield/migration.sql',
		import.meta.url,
	),
)

test('migration adds honest Recipe time and yield without changing legacy quantities', async () => {
	const db = createClient({ url: 'file::memory:' })
	try {
		await db.executeMultiple(`
			CREATE TABLE "Recipe" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"title" TEXT NOT NULL,
				"servings" INTEGER NOT NULL DEFAULT 4,
				"prepTime" INTEGER,
				"cookTime" INTEGER
			);
			CREATE TABLE "MenuItem" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"scaleMultiplier" REAL,
				"recipeId" TEXT
			);
			CREATE TABLE "MealRecipeItem" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"scaleMultiplier" REAL NOT NULL DEFAULT 1,
				"recipeId" TEXT
			);

			INSERT INTO "Recipe" ("id", "title", "servings", "prepTime", "cookTime") VALUES
				('cake', 'Cake', 4, 15, 30),
				('loaf', 'Loaf', 2, NULL, 40),
				('batch', 'Batch', 8, 0, 25),
				('unknown', 'Unknown', 4, NULL, NULL),
				('zero', 'Zero', 4, 0, 0);
			INSERT INTO "MenuItem" ("id", "scaleMultiplier", "recipeId")
				VALUES ('menu-item', 1.25, 'cake');
			INSERT INTO "MealRecipeItem" ("id", "scaleMultiplier", "recipeId")
				VALUES ('meal-item', 2.5, 'cake');
		`)

		const recipesBefore = await db.execute(`
			SELECT "id", "title", "servings", "prepTime", "cookTime"
			FROM "Recipe" ORDER BY "id"
		`)
		const menuMultiplierBefore = await db.execute(
			`SELECT "scaleMultiplier" FROM "MenuItem" WHERE "id" = 'menu-item'`,
		)
		const mealMultiplierBefore = await db.execute(
			`SELECT "scaleMultiplier" FROM "MealRecipeItem" WHERE "id" = 'meal-item'`,
		)

		await db.executeMultiple(await fs.readFile(migrationPath, 'utf8'))

		const columns = await db.execute(`PRAGMA table_info("Recipe")`)
		expect(
			columns.rows
				.filter((column) =>
					['activeTime', 'totalTime', 'yieldAmount', 'yieldLabel'].includes(
						String(column.name),
					),
				)
				.map((column) => [column.name, column.type, column.notnull]),
		).toEqual([
			['activeTime', 'INTEGER', 0],
			['totalTime', 'INTEGER', 0],
			['yieldAmount', 'REAL', 0],
			['yieldLabel', 'TEXT', 0],
		])

		const recipesAfter = await db.execute(`
			SELECT "id", "title", "servings", "prepTime", "cookTime",
				"activeTime", "totalTime", "yieldAmount", "yieldLabel"
			FROM "Recipe" ORDER BY "id"
		`)
		expect(recipesAfter.rows).toEqual([
			{
				id: 'batch',
				title: 'Batch',
				servings: 8,
				prepTime: 0,
				cookTime: 25,
				activeTime: null,
				totalTime: 25,
				yieldAmount: null,
				yieldLabel: null,
			},
			{
				id: 'cake',
				title: 'Cake',
				servings: 4,
				prepTime: 15,
				cookTime: 30,
				activeTime: null,
				totalTime: 45,
				yieldAmount: null,
				yieldLabel: null,
			},
			{
				id: 'loaf',
				title: 'Loaf',
				servings: 2,
				prepTime: null,
				cookTime: 40,
				activeTime: null,
				totalTime: null,
				yieldAmount: null,
				yieldLabel: null,
			},
			{
				id: 'unknown',
				title: 'Unknown',
				servings: 4,
				prepTime: null,
				cookTime: null,
				activeTime: null,
				totalTime: null,
				yieldAmount: null,
				yieldLabel: null,
			},
			{
				id: 'zero',
				title: 'Zero',
				servings: 4,
				prepTime: 0,
				cookTime: 0,
				activeTime: null,
				totalTime: null,
				yieldAmount: null,
				yieldLabel: null,
			},
		])
		expect(
			recipesAfter.rows.map(
				({ activeTime, totalTime, yieldAmount, yieldLabel, ...legacy }) =>
					legacy,
			),
		).toEqual(recipesBefore.rows)

		const menuMultiplierAfter = await db.execute(
			`SELECT "scaleMultiplier" FROM "MenuItem" WHERE "id" = 'menu-item'`,
		)
		const mealMultiplierAfter = await db.execute(
			`SELECT "scaleMultiplier" FROM "MealRecipeItem" WHERE "id" = 'meal-item'`,
		)
		expect(menuMultiplierAfter.rows).toEqual(menuMultiplierBefore.rows)
		expect(mealMultiplierAfter.rows).toEqual(mealMultiplierBefore.rows)
	} finally {
		db.close()
	}
})

test('migration accepts fractional custom yields and rejects non-positive amounts', async () => {
	const db = createClient({ url: 'file::memory:' })
	try {
		await db.executeMultiple(`
			CREATE TABLE "Recipe" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"title" TEXT NOT NULL,
				"servings" INTEGER NOT NULL DEFAULT 4,
				"prepTime" INTEGER,
				"cookTime" INTEGER
			);
		`)
		await db.executeMultiple(await fs.readFile(migrationPath, 'utf8'))

		await db.execute({
			sql: `INSERT INTO "Recipe"
				("id", "title", "yieldAmount", "yieldLabel")
				VALUES (?, ?, ?, ?)`,
			args: ['braided-loaf', 'Braided loaf', 2.5, 'large braided loaves'],
		})
		const customYield = await db.execute(`
			SELECT "yieldAmount", "yieldLabel" FROM "Recipe"
			WHERE "id" = 'braided-loaf'
		`)
		expect(customYield.rows).toEqual([
			{ yieldAmount: 2.5, yieldLabel: 'large braided loaves' },
		])

		for (const amount of [0, -1]) {
			await expect(
				db.execute({
					sql: `INSERT INTO "Recipe"
						("id", "title", "yieldAmount", "yieldLabel")
						VALUES (?, ?, ?, ?)`,
					args: [`invalid-${amount}`, 'Invalid yield', amount, 'jars'],
				}),
			).rejects.toThrow(/CHECK constraint failed/)
		}
	} finally {
		db.close()
	}
})
