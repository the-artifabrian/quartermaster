-- #107: additive Meal snapshot children. Planning a Menu freezes its
-- structure into one Meal: MealSection (frozen section names/order),
-- MealNoteItem (note cards, sharing their section's order sequence with
-- MealRecipeItem like MenuItem's two kinds), and MealShoppingLine (a note's
-- ordinary Shopping lines). MealRecipeItem gains nullable sectionId + note.
-- No data is rewritten: the MealRecipeItem redefine copies every existing
-- column verbatim (new columns stay NULL), so planner-created Meals are
-- untouched and DateTime storage formats pass through unchanged.

-- CreateTable
CREATE TABLE "MealSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "order" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mealId" TEXT NOT NULL,
    CONSTRAINT "MealSection_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "Meal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MealNoteItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mealId" TEXT NOT NULL,
    "sectionId" TEXT,
    CONSTRAINT "MealNoteItem_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "Meal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealNoteItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "MealSection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MealShoppingLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "quantity" TEXT,
    "unit" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "noteItemId" TEXT NOT NULL,
    CONSTRAINT "MealShoppingLine_noteItemId_fkey" FOREIGN KEY ("noteItemId") REFERENCES "MealNoteItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MealRecipeItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order" INTEGER NOT NULL,
    "recipeTitle" TEXT NOT NULL,
    "scaleMultiplier" REAL NOT NULL DEFAULT 1,
    "cooked" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "recipeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mealId" TEXT NOT NULL,
    "sectionId" TEXT,
    CONSTRAINT "MealRecipeItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MealRecipeItem_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "Meal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealRecipeItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "MealSection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MealRecipeItem" ("cooked", "createdAt", "id", "mealId", "order", "recipeId", "recipeTitle", "scaleMultiplier", "updatedAt") SELECT "cooked", "createdAt", "id", "mealId", "order", "recipeId", "recipeTitle", "scaleMultiplier", "updatedAt" FROM "MealRecipeItem";
DROP TABLE "MealRecipeItem";
ALTER TABLE "new_MealRecipeItem" RENAME TO "MealRecipeItem";
CREATE INDEX "MealRecipeItem_mealId_order_idx" ON "MealRecipeItem"("mealId", "order");
CREATE INDEX "MealRecipeItem_recipeId_idx" ON "MealRecipeItem"("recipeId");
CREATE INDEX "MealRecipeItem_sectionId_idx" ON "MealRecipeItem"("sectionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "MealSection_mealId_order_idx" ON "MealSection"("mealId", "order");

-- CreateIndex
CREATE INDEX "MealNoteItem_mealId_order_idx" ON "MealNoteItem"("mealId", "order");

-- CreateIndex
CREATE INDEX "MealNoteItem_sectionId_idx" ON "MealNoteItem"("sectionId");

-- CreateIndex
CREATE INDEX "MealShoppingLine_noteItemId_order_idx" ON "MealShoppingLine"("noteItemId", "order");
