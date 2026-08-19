-- Delta pass (#105): reconcile the backfilled Meal rows with the legacy
-- MealPlanEntry table one final time, at the deploy that switches the planner
-- UI onto Meals. Between the #104 backfill deploy and this one, the legacy
-- planner kept writing only MealPlanEntry, so entries may have been created,
-- toggled, re-slotted, or deleted without their Meal counterparts — and a
-- sole-member household move may have cascade-dropped backfilled Meals while
-- their entries survived (PR #150's documented caveat). This migration is a
-- full idempotent reconcile rather than a created-since-cutoff pass, so it
-- also recreates those dropped Meals and re-running it is a no-op.
--
-- Scope guard: only rows carrying the deterministic backfill ids
-- ('meal-bf…', 'mri-bf-<entry id>') are created, updated, or deleted here.
-- Meals restored by JSON import have ordinary cuids and are never touched,
-- except that a day shared with backfilled Meals gets its within-day order
-- renumbered with imported Meals kept after backfilled ones, preserving the
-- import-time "append after existing same-day Meals" placement.
--
-- Every legacy DateTime read is typeof()-dispatched (INTEGER epoch-ms vs TEXT
-- ISO eras — see #104); every written value uses the current client's TEXT
-- format, keeping the Meal tables format-uniform.

-- Step 1: drop backfilled items whose legacy entry was deleted.
DELETE FROM "MealRecipeItem"
WHERE "id" LIKE 'mri-bf-%'
  AND NOT EXISTS (
    SELECT 1 FROM "MealPlanEntry" e WHERE 'mri-bf-' || e."id" = "MealRecipeItem"."id"
  );

-- Step 2: create a Meal for every legacy (plan, UTC day, mealType) group that
-- lacks one — new groups written since the backfill, and groups whose Meal a
-- household move cascade-dropped. Groups are matched to existing backfilled
-- Meals by their grouping key, not by id: deleting a group's first entry
-- changes MIN(id), so the deterministic id alone cannot identify the group's
-- surviving Meal. The 'meal-bf2-' fallback covers an entry that moved days and
-- became first of a new group while its old group's Meal still holds the
-- 'meal-bf-' id. The order placeholder is renumbered in step 5.
WITH "legacy" AS (
    SELECT
        e."id",
        e."mealPlanId",
        e."mealType",
        CASE WHEN typeof(e."date") = 'integer'
             THEN date(e."date" / 1000, 'unixepoch')
             ELSE date(e."date")
        END AS "utcDay",
        CASE WHEN typeof(e."createdAt") = 'integer'
             THEN e."createdAt" / 86400000.0 + 2440587.5
             ELSE julianday(e."createdAt")
        END AS "jdCreated"
    FROM "MealPlanEntry" e
),
"groups" AS (
    SELECT
        "mealPlanId",
        "utcDay",
        "mealType",
        MIN("id") AS "firstId",
        MIN("jdCreated") AS "jdFirst",
        MAX("jdCreated") AS "jdLast"
    FROM "legacy"
    GROUP BY "mealPlanId", "utcDay", "mealType"
)
INSERT INTO "Meal" ("id", "date", "order", "label", "completed", "createdAt", "updatedAt", "mealPlanId")
SELECT
    CASE WHEN EXISTS (SELECT 1 FROM "Meal" x WHERE x."id" = 'meal-bf-' || g."firstId")
         THEN 'meal-bf2-' || g."firstId"
         ELSE 'meal-bf-' || g."firstId"
    END,
    g."utcDay" || 'T00:00:00.000+00:00',
    1000000,
    g."mealType",
    0,
    strftime('%Y-%m-%dT%H:%M:%f+00:00', g."jdFirst"),
    strftime('%Y-%m-%dT%H:%M:%f+00:00', g."jdLast"),
    g."mealPlanId"
FROM "groups" g
WHERE NOT EXISTS (
    SELECT 1 FROM "Meal" m
    WHERE m."id" LIKE 'meal-bf%'
      AND m."mealPlanId" = g."mealPlanId"
      AND m."date" = g."utcDay" || 'T00:00:00.000+00:00'
      AND m."label" = g."mealType"
);

-- Step 3: upsert one item per legacy entry — creates items for new entries,
-- and re-points/overwrites existing backfilled items whose entry changed
-- (cooked toggles, serving overrides, or a move to another day/slot/plan).
-- Legacy rows are authoritative for backfill-linked items until this deploy:
-- nothing else could write them. Values mirror the #104 backfill exactly:
-- multiplier = override / Recipe.servings (1× when absent or unguarded zero),
-- item order = createdAt (as julian day) then id within the group.
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
),
"target" AS (
    SELECT
        l."id" AS "entryId",
        l."servings",
        l."cooked",
        l."recipeId",
        l."jdCreated",
        (SELECT m."id" FROM "Meal" m
         WHERE m."id" LIKE 'meal-bf%'
           AND m."mealPlanId" = l."mealPlanId"
           AND m."date" = l."utcDay" || 'T00:00:00.000+00:00'
           AND m."label" = l."mealType"
         ORDER BY m."id"
         LIMIT 1) AS "mealId",
        ROW_NUMBER() OVER (
            PARTITION BY l."mealPlanId", l."utcDay", l."mealType"
            ORDER BY l."jdCreated", l."id"
        ) - 1 AS "itemOrder"
    FROM "legacy" l
)
INSERT INTO "MealRecipeItem" ("id", "order", "recipeTitle", "scaleMultiplier", "cooked", "recipeId", "createdAt", "updatedAt", "mealId")
SELECT
    'mri-bf-' || t."entryId",
    t."itemOrder",
    r."title",
    CASE
        WHEN t."servings" IS NULL THEN 1
        WHEN r."servings" > 0 THEN CAST(t."servings" AS REAL) / r."servings"
        ELSE 1
    END,
    t."cooked",
    t."recipeId",
    strftime('%Y-%m-%dT%H:%M:%f+00:00', t."jdCreated"),
    strftime('%Y-%m-%dT%H:%M:%f+00:00', t."jdCreated"),
    t."mealId"
FROM "target" t
JOIN "Recipe" r ON r."id" = t."recipeId"
ON CONFLICT ("id") DO UPDATE SET
    "order" = excluded."order",
    "recipeTitle" = excluded."recipeTitle",
    "scaleMultiplier" = excluded."scaleMultiplier",
    "cooked" = excluded."cooked",
    "recipeId" = excluded."recipeId",
    "updatedAt" = excluded."updatedAt",
    "mealId" = excluded."mealId";

-- Step 4: drop backfilled Meals left with no items (their whole group was
-- deleted or moved elsewhere). Backfilled Meals never carry generic text; the
-- guard keeps this deletion provably away from imported text-only Meals.
DELETE FROM "Meal"
WHERE "id" LIKE 'meal-bf%'
  AND "genericText" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "MealRecipeItem" i WHERE i."mealId" = "Meal"."id"
  );

-- Step 5: renumber within-day order on every day that has backfilled Meals:
-- backfilled Meals first in the migrated order (breakfast, lunch, dinner,
-- snack, then unexpected labels lexically — matching #104), imported Meals
-- after them in their existing relative order.
WITH "ranked" AS (
    SELECT
        m."id" AS "mid",
        ROW_NUMBER() OVER (
            PARTITION BY m."mealPlanId", m."date"
            ORDER BY
                CASE WHEN m."id" LIKE 'meal-bf%' THEN 0 ELSE 1 END,
                CASE WHEN m."id" LIKE 'meal-bf%' THEN
                    CASE m."label"
                        WHEN 'breakfast' THEN 0
                        WHEN 'lunch' THEN 1
                        WHEN 'dinner' THEN 2
                        WHEN 'snack' THEN 3
                        ELSE 4
                    END
                ELSE 0 END,
                CASE WHEN m."id" LIKE 'meal-bf%' THEN m."label" ELSE '' END,
                m."order",
                m."createdAt",
                m."id"
        ) - 1 AS "newOrder"
    FROM "Meal" m
    WHERE EXISTS (
        SELECT 1 FROM "Meal" b
        WHERE b."mealPlanId" = m."mealPlanId"
          AND b."date" = m."date"
          AND b."id" LIKE 'meal-bf%'
    )
)
UPDATE "Meal"
SET "order" = (SELECT "newOrder" FROM "ranked" WHERE "ranked"."mid" = "Meal"."id")
WHERE "id" IN (SELECT "mid" FROM "ranked");
