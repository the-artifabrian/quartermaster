-- CreateTable
CREATE TABLE "Meal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "order" INTEGER NOT NULL,
    "label" TEXT,
    "servingAt" DATETIME,
    "servingTimeZone" TEXT,
    "genericText" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "guestCount" INTEGER,
    "sourceMenuId" TEXT,
    "sourceMenuRevision" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    CONSTRAINT "Meal_sourceMenuId_fkey" FOREIGN KEY ("sourceMenuId") REFERENCES "Menu" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Meal_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MealRecipeItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order" INTEGER NOT NULL,
    "recipeTitle" TEXT NOT NULL,
    "scaleMultiplier" REAL NOT NULL DEFAULT 1,
    "cooked" BOOLEAN NOT NULL DEFAULT false,
    "recipeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mealId" TEXT NOT NULL,
    CONSTRAINT "MealRecipeItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MealRecipeItem_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "Meal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Meal_mealPlanId_date_order_idx" ON "Meal"("mealPlanId", "date", "order");

-- CreateIndex
CREATE INDEX "Meal_sourceMenuId_idx" ON "Meal"("sourceMenuId");

-- CreateIndex
CREATE INDEX "MealRecipeItem_mealId_order_idx" ON "MealRecipeItem"("mealId", "order");

-- CreateIndex
CREATE INDEX "MealRecipeItem_recipeId_idx" ON "MealRecipeItem"("recipeId");

-- Backfill (#104): every existing (mealPlanId, date, mealType) group of legacy
-- MealPlanEntry rows becomes one Meal; each entry becomes one ordered
-- MealRecipeItem inside it. Legacy rows are left untouched — they keep driving
-- the current planner until #105 switches it, and #106 removes them.
--
-- IDs are deterministic ('meal-bf-' || first entry id, 'mri-bf-' || entry id)
-- so a rehearsal is comparable with the real run and #105 can re-run a delta
-- pass for legacy rows written between this deploy and the UI switch.
--
-- Meal order within a day: breakfast, lunch, dinner, snack, then any
-- unexpected label lexically. DateTimes are stored as epoch milliseconds, so
-- MIN/MAX and ORDER BY over "createdAt" are chronological.
INSERT INTO "Meal" ("id", "date", "order", "label", "completed", "createdAt", "updatedAt", "mealPlanId")
SELECT
    'meal-bf-' || MIN(e."id"),
    e."date",
    ROW_NUMBER() OVER (
        PARTITION BY e."mealPlanId", e."date"
        ORDER BY
            CASE e."mealType"
                WHEN 'breakfast' THEN 0
                WHEN 'lunch' THEN 1
                WHEN 'dinner' THEN 2
                WHEN 'snack' THEN 3
                ELSE 4
            END,
            e."mealType"
    ) - 1,
    e."mealType",
    0,
    MIN(e."createdAt"),
    MAX(e."createdAt"),
    e."mealPlanId"
FROM "MealPlanEntry" e
GROUP BY e."mealPlanId", e."date", e."mealType";

-- Items order by createdAt then id within their Meal. A legacy serving
-- override becomes override / Recipe.servings — preserving the ratio the user
-- chose without treating legacy servings as trustworthy yield; no override
-- means one batch (1×). Recipe.servings is always positive today; the guard
-- only protects against an unexpected zero. The Meal join is unambiguous
-- here: at this point "Meal" contains exactly the rows created above, one per
-- (mealPlanId, date, label) group.
INSERT INTO "MealRecipeItem" ("id", "order", "recipeTitle", "scaleMultiplier", "cooked", "recipeId", "createdAt", "updatedAt", "mealId")
SELECT
    'mri-bf-' || e."id",
    ROW_NUMBER() OVER (
        PARTITION BY e."mealPlanId", e."date", e."mealType"
        ORDER BY e."createdAt", e."id"
    ) - 1,
    r."title",
    CASE
        WHEN e."servings" IS NULL THEN 1
        WHEN r."servings" > 0 THEN CAST(e."servings" AS REAL) / r."servings"
        ELSE 1
    END,
    e."cooked",
    e."recipeId",
    e."createdAt",
    e."createdAt",
    m."id"
FROM "MealPlanEntry" e
JOIN "Recipe" r ON r."id" = e."recipeId"
JOIN "Meal" m
    ON m."mealPlanId" = e."mealPlanId"
    AND m."date" = e."date"
    AND m."label" = e."mealType";
