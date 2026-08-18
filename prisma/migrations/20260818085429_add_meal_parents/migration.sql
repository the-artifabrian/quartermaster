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

-- Backfill (#104): every existing (mealPlanId, UTC day, mealType) group of
-- legacy MealPlanEntry rows becomes one Meal; each entry becomes one ordered
-- MealRecipeItem inside it. Legacy rows are left untouched — they keep driving
-- the current planner until #105 switches it, and #106 removes them.
--
-- The semantic day is the UTC calendar day of the stored instant — the same
-- convention serializeDate/the planner UI use to bucket entries into day
-- slots. The database holds DateTime values in TWO storage formats from
-- different Prisma eras: INTEGER epoch milliseconds and TEXT
-- 'YYYY-MM-DDTHH:MM:SS.SSS+00:00' (production has both in every legacy Plan
-- column). Grouping or ordering on the raw column would therefore split or
-- misorder day slots, so every date/createdAt read goes through a
-- typeof()-dispatched conversion, and every value this backfill writes uses
-- the current client's TEXT format so the new tables start format-uniform.
--
-- IDs are deterministic ('meal-bf-' || first entry id, 'mri-bf-' || entry id)
-- so a rehearsal is comparable with the real run and #105 can re-run a delta
-- pass for legacy rows written between this deploy and the UI switch.
--
-- Meal order within a day: breakfast, lunch, dinner, snack, then any
-- unexpected label lexically. Meal.createdAt/updatedAt take the group's
-- first/last entry creation instants; item order is createdAt (as julian day,
-- chronological across both storage formats) then id.
WITH "legacy" AS (
    SELECT
        e."id",
        e."mealPlanId",
        e."mealType",
        e."servings",
        e."cooked",
        e."recipeId",
        CASE WHEN typeof(e."date") = 'integer'
             THEN date(e."date" / 1000, 'unixepoch')
             ELSE date(e."date")
        END AS "utcDay",
        CASE WHEN typeof(e."createdAt") = 'integer'
             THEN e."createdAt" / 86400000.0 + 2440587.5
             ELSE julianday(e."createdAt")
        END AS "jdCreated"
    FROM "MealPlanEntry" e
)
INSERT INTO "Meal" ("id", "date", "order", "label", "completed", "createdAt", "updatedAt", "mealPlanId")
SELECT
    'meal-bf-' || MIN(l."id"),
    l."utcDay" || 'T00:00:00.000+00:00',
    ROW_NUMBER() OVER (
        PARTITION BY l."mealPlanId", l."utcDay"
        ORDER BY
            CASE l."mealType"
                WHEN 'breakfast' THEN 0
                WHEN 'lunch' THEN 1
                WHEN 'dinner' THEN 2
                WHEN 'snack' THEN 3
                ELSE 4
            END,
            l."mealType"
    ) - 1,
    l."mealType",
    0,
    strftime('%Y-%m-%dT%H:%M:%f+00:00', MIN(l."jdCreated")),
    strftime('%Y-%m-%dT%H:%M:%f+00:00', MAX(l."jdCreated")),
    l."mealPlanId"
FROM "legacy" l
GROUP BY l."mealPlanId", l."utcDay", l."mealType";

-- A legacy serving override becomes override / Recipe.servings — preserving
-- the ratio the user chose without treating legacy servings as trustworthy
-- yield; no override means one batch (1×). Recipe.servings is always positive
-- today; the guard only protects against an unexpected zero. The Meal join is
-- unambiguous here: at this point "Meal" contains exactly the rows created
-- above, one per (mealPlanId, UTC day, label) group.
WITH "legacy" AS (
    SELECT
        e."id",
        e."mealPlanId",
        e."mealType",
        e."servings",
        e."cooked",
        e."recipeId",
        CASE WHEN typeof(e."date") = 'integer'
             THEN date(e."date" / 1000, 'unixepoch')
             ELSE date(e."date")
        END AS "utcDay",
        CASE WHEN typeof(e."createdAt") = 'integer'
             THEN e."createdAt" / 86400000.0 + 2440587.5
             ELSE julianday(e."createdAt")
        END AS "jdCreated"
    FROM "MealPlanEntry" e
)
INSERT INTO "MealRecipeItem" ("id", "order", "recipeTitle", "scaleMultiplier", "cooked", "recipeId", "createdAt", "updatedAt", "mealId")
SELECT
    'mri-bf-' || l."id",
    ROW_NUMBER() OVER (
        PARTITION BY l."mealPlanId", l."utcDay", l."mealType"
        ORDER BY l."jdCreated", l."id"
    ) - 1,
    r."title",
    CASE
        WHEN l."servings" IS NULL THEN 1
        WHEN r."servings" > 0 THEN CAST(l."servings" AS REAL) / r."servings"
        ELSE 1
    END,
    l."cooked",
    l."recipeId",
    strftime('%Y-%m-%dT%H:%M:%f+00:00', l."jdCreated"),
    strftime('%Y-%m-%dT%H:%M:%f+00:00', l."jdCreated"),
    m."id"
FROM "legacy" l
JOIN "Recipe" r ON r."id" = l."recipeId"
JOIN "Meal" m
    ON m."mealPlanId" = l."mealPlanId"
    AND m."date" = l."utcDay" || 'T00:00:00.000+00:00'
    AND m."label" = l."mealType";
