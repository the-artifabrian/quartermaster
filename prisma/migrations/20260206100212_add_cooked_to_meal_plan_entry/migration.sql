-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MealPlanEntry" (
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
);
INSERT INTO "new_MealPlanEntry" ("createdAt", "date", "id", "mealPlanId", "mealType", "recipeId", "servings") SELECT "createdAt", "date", "id", "mealPlanId", "mealType", "recipeId", "servings" FROM "MealPlanEntry";
DROP TABLE "MealPlanEntry";
ALTER TABLE "new_MealPlanEntry" RENAME TO "MealPlanEntry";
CREATE INDEX "MealPlanEntry_mealPlanId_idx" ON "MealPlanEntry"("mealPlanId");
CREATE INDEX "MealPlanEntry_recipeId_idx" ON "MealPlanEntry"("recipeId");
CREATE UNIQUE INDEX "MealPlanEntry_mealPlanId_date_mealType_recipeId_key" ON "MealPlanEntry"("mealPlanId", "date", "mealType", "recipeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
