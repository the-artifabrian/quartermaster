-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Ingredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "amount" TEXT,
    "unit" TEXT,
    "notes" TEXT,
    "isHeading" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "recipeId" TEXT NOT NULL,
    "linkedRecipeId" TEXT,
    CONSTRAINT "Ingredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Ingredient_linkedRecipeId_fkey" FOREIGN KEY ("linkedRecipeId") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Ingredient" ("amount", "id", "isHeading", "name", "notes", "order", "recipeId", "unit") SELECT "amount", "id", "isHeading", "name", "notes", "order", "recipeId", "unit" FROM "Ingredient";
DROP TABLE "Ingredient";
ALTER TABLE "new_Ingredient" RENAME TO "Ingredient";
CREATE INDEX "Ingredient_recipeId_idx" ON "Ingredient"("recipeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
