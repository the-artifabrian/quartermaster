import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { expect, test } from 'vitest'

const migrationPath = fileURLToPath(
	new URL(
		'../../prisma/migrations/20260830160000_contract_legacy_recipe_metadata/migration.sql',
		import.meta.url,
	),
)

test('migration removes only legacy Recipe metadata and preserves durable quantities', async () => {
	const db = createClient({ url: 'file::memory:' })
	try {
		await db.executeMultiple(`
			PRAGMA foreign_keys=ON;
			CREATE TABLE "User" (
				"id" TEXT NOT NULL PRIMARY KEY
			);
			CREATE TABLE "Household" (
				"id" TEXT NOT NULL PRIMARY KEY
			);
			CREATE TABLE "Recipe" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"title" TEXT NOT NULL,
				"description" TEXT,
				"servings" INTEGER NOT NULL DEFAULT 4,
				"prepTime" INTEGER,
				"cookTime" INTEGER,
				"activeTime" INTEGER,
				"totalTime" INTEGER,
				"yieldAmount" REAL CONSTRAINT "Recipe_yieldAmount_positive"
					CHECK ("yieldAmount" IS NULL OR "yieldAmount" > 0),
				"yieldLabel" TEXT,
				"isFavorite" BOOLEAN NOT NULL DEFAULT false,
				"isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
				"sourceUrl" TEXT,
				"rawText" TEXT,
				"notes" TEXT,
				"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				"updatedAt" DATETIME NOT NULL,
				"userId" TEXT NOT NULL,
				"householdId" TEXT,
				CONSTRAINT "Recipe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
				CONSTRAINT "Recipe_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE SET NULL ON UPDATE CASCADE
			);
			CREATE INDEX "Recipe_userId_idx" ON "Recipe"("userId");
			CREATE INDEX "Recipe_householdId_idx" ON "Recipe"("householdId");
			CREATE INDEX "Recipe_title_idx" ON "Recipe"("title");
			CREATE TABLE "Ingredient" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"name" TEXT NOT NULL,
				"recipeId" TEXT NOT NULL,
				"linkedRecipeId" TEXT,
				CONSTRAINT "Ingredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
				CONSTRAINT "Ingredient_linkedRecipeId_fkey" FOREIGN KEY ("linkedRecipeId") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE
			);
			CREATE TABLE "MenuItem" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"scaleMultiplier" REAL,
				"recipeId" TEXT,
				CONSTRAINT "MenuItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE
			);
			CREATE TABLE "MealRecipeItem" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"scaleMultiplier" REAL NOT NULL DEFAULT 1,
				"recipeId" TEXT,
				CONSTRAINT "MealRecipeItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE
			);
			CREATE TABLE "ShoppingListItem" (
				"id" TEXT NOT NULL PRIMARY KEY,
				"quantity" TEXT,
				"unit" TEXT
			);

			INSERT INTO "User" ("id") VALUES ('user-1');
			INSERT INTO "Household" ("id") VALUES ('household-1');
			INSERT INTO "Recipe" (
				"id", "title", "description", "servings", "prepTime", "cookTime",
				"activeTime", "totalTime", "yieldAmount", "yieldLabel", "isFavorite",
				"isAiGenerated", "sourceUrl", "rawText", "notes", "createdAt",
				"updatedAt", "userId", "householdId"
			) VALUES (
				'loaf', 'Braided loaf', 'For Sunday', 97, 15, 45,
				25, 180, 2.5, 'large braided loaves', true,
				false, 'https://recipes.example/loaf', 'source text', 'Use less salt',
				'2026-08-01T10:00:00.000+00:00', '2026-08-29T11:00:00.000+00:00',
				'user-1', 'household-1'
			);
			INSERT INTO "Ingredient" ("id", "name", "recipeId", "linkedRecipeId")
				VALUES ('ingredient-1', 'flour', 'loaf', 'loaf');
			INSERT INTO "MenuItem" ("id", "scaleMultiplier", "recipeId")
				VALUES ('menu-item-1', 1.23456789, 'loaf');
			INSERT INTO "MealRecipeItem" ("id", "scaleMultiplier", "recipeId")
				VALUES ('meal-item-1', 2.50000001, 'loaf');
			INSERT INTO "ShoppingListItem" ("id", "quantity", "unit")
				VALUES ('shopping-item-1', '3 1/2', 'kg');
		`)

		await db.executeMultiple(await fs.readFile(migrationPath, 'utf8'))

		const columns = await db.execute(`PRAGMA table_info("Recipe")`)
		expect(columns.rows.map((column) => column.name)).not.toEqual(
			expect.arrayContaining(['servings', 'prepTime', 'cookTime']),
		)
		expect(columns.rows.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				'activeTime',
				'totalTime',
				'yieldAmount',
				'yieldLabel',
			]),
		)

		const recipes = await db.execute(`
			SELECT "id", "title", "description", "activeTime", "totalTime",
				"yieldAmount", "yieldLabel", "isFavorite", "isAiGenerated",
				"sourceUrl", "rawText", "notes", "createdAt", "updatedAt",
				"userId", "householdId"
			FROM "Recipe"
		`)
		expect(recipes.rows).toEqual([
			{
				id: 'loaf',
				title: 'Braided loaf',
				description: 'For Sunday',
				activeTime: 25,
				totalTime: 180,
				yieldAmount: 2.5,
				yieldLabel: 'large braided loaves',
				isFavorite: 1,
				isAiGenerated: 0,
				sourceUrl: 'https://recipes.example/loaf',
				rawText: 'source text',
				notes: 'Use less salt',
				createdAt: '2026-08-01T10:00:00.000+00:00',
				updatedAt: '2026-08-29T11:00:00.000+00:00',
				userId: 'user-1',
				householdId: 'household-1',
			},
		])

		const durableQuantities = await db.execute(`
			SELECT
				(SELECT "scaleMultiplier" FROM "MenuItem" WHERE "id" = 'menu-item-1') AS "menuMultiplier",
				(SELECT "scaleMultiplier" FROM "MealRecipeItem" WHERE "id" = 'meal-item-1') AS "mealMultiplier",
				(SELECT "quantity" FROM "ShoppingListItem" WHERE "id" = 'shopping-item-1') AS "shoppingQuantity",
				(SELECT "unit" FROM "ShoppingListItem" WHERE "id" = 'shopping-item-1') AS "shoppingUnit"
		`)
		expect(durableQuantities.rows).toEqual([
			{
				menuMultiplier: 1.23456789,
				mealMultiplier: 2.50000001,
				shoppingQuantity: '3 1/2',
				shoppingUnit: 'kg',
			},
		])
		await expect(
			db.execute({
				sql: `INSERT INTO "Recipe" (
					"id", "title", "yieldAmount", "updatedAt", "userId"
				) VALUES (?, ?, ?, ?, ?)`,
				args: ['partial-yield', 'Partial yield', 4, '2026-08-30', 'user-1'],
			}),
		).rejects.toThrow()
		expect(
			(await db.execute(`SELECT count(*) AS count FROM "Ingredient"`)).rows,
		).toEqual([{ count: 1 }])
		expect((await db.execute(`PRAGMA foreign_key_check`)).rows).toEqual([])
		expect((await db.execute(`PRAGMA integrity_check`)).rows).toEqual([
			{ integrity_check: 'ok' },
		])
	} finally {
		db.close()
	}
})
