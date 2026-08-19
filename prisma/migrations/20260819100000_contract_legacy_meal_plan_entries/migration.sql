-- Contraction (#106): drop the legacy fixed-slot MealPlanEntry representation.
-- Since #105 the planner reads/writes only Meal/MealRecipeItem, and every
-- Recipe-item write mirrored a legacy row purely so the week-wide Shopping
-- generator and full export could keep reading MealPlanEntry. This deploy
-- ports those readers, so the mirrors and the table itself retire here.
--
-- Before dropping, one final safety sweep recreates Meals for orphaned
-- entries: rows whose 'mri-bf-<entry id>' mirror item is missing. Under the
-- #105 dual-write regime that only happens when a sole-member household move
-- merged colliding week plans by re-parenting entries and deleting the source
-- plan — cascade-dropping its Meals while the mirror entries survived (the
-- caveat documented on PRs #150/#151). Verified zero such rows on a prod copy
-- at rehearsal time; the sweep is a provable no-op when representations are
-- in sync, and preserves planned food if a move happens between rehearsal and
-- deploy. Known accepted edge: a JSON *import* run in the #105→#106 window
-- also created unlinked legacy rows alongside their imported Meals — on such
-- a database the sweep would duplicate those Meals (visible, deletable in the
-- planner UI; no import ran on the real database in the window, and databases
-- applying the migration chain in one sitting have no window at all).
--
-- Sweep conventions match the #104 backfill / #105 delta exactly:
-- - Every legacy DateTime read is typeof()-dispatched (INTEGER epoch-ms vs
--   TEXT ISO eras); every written value uses the current client's TEXT format.
-- - Orphans group by (plan, UTC day, mealType). Pre-#105 entries carry slot
--   names there ("breakfast"…), which become the Meal label; post-#105 mirror
--   rows carry their dead parent Meal's id — an opaque cuid that still groups
--   the dead Meal's exact composition but must not become a label, so any
--   non-slot value maps to an unlabeled Meal.
-- - Item multiplier = override / Recipe.servings (1x when absent), item order
--   by createdAt then id — the same recovery rule as #104.
-- - Recreated Meals APPEND after the day's existing Meals: within-day order
--   has been user-authoritative since #105, so unlike the delta this sweep
--   never reshuffles a day, it only renumbers days it appended to.

-- Step 1: one Meal per orphaned legacy group. The placeholder order
-- (1000000 + slot rank) keeps recreated Meals after every real one until
-- step 3 renumbers only the affected days. 'meal-ct-' ids are new to this
-- migration, so they cannot collide with 'meal-bf…' or cuid ids, and the
-- NOT EXISTS guard makes re-running the sweep a no-op.
WITH "orphan" AS (
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
    WHERE NOT EXISTS (
        SELECT 1 FROM "MealRecipeItem" i WHERE i."id" = 'mri-bf-' || e."id"
    )
),
"groups" AS (
    SELECT
        "mealPlanId",
        "utcDay",
        "mealType",
        MIN("id") AS "firstId",
        MIN("jdCreated") AS "jdFirst",
        MAX("jdCreated") AS "jdLast"
    FROM "orphan"
    GROUP BY "mealPlanId", "utcDay", "mealType"
)
INSERT INTO "Meal" ("id", "date", "order", "label", "completed", "createdAt", "updatedAt", "mealPlanId")
SELECT
    'meal-ct-' || g."firstId",
    g."utcDay" || 'T00:00:00.000+00:00',
    1000000 + ROW_NUMBER() OVER (
        PARTITION BY g."mealPlanId", g."utcDay"
        ORDER BY
            CASE g."mealType"
                WHEN 'breakfast' THEN 0
                WHEN 'lunch' THEN 1
                WHEN 'dinner' THEN 2
                WHEN 'snack' THEN 3
                ELSE 4
            END,
            g."mealType"
    ),
    CASE WHEN g."mealType" IN ('breakfast', 'lunch', 'dinner', 'snack')
         THEN g."mealType"
         ELSE NULL
    END,
    0,
    strftime('%Y-%m-%dT%H:%M:%f+00:00', g."jdFirst"),
    strftime('%Y-%m-%dT%H:%M:%f+00:00', g."jdLast"),
    g."mealPlanId"
FROM "groups" g
WHERE NOT EXISTS (
    SELECT 1 FROM "Meal" x WHERE x."id" = 'meal-ct-' || g."firstId"
);

-- Step 2: one item per orphaned entry, attached to its group's recreated
-- Meal. The JOIN on Recipe never drops rows (legacy entries cascade with
-- their Recipe, so every surviving entry has one).
WITH "orphan" AS (
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
    WHERE NOT EXISTS (
        SELECT 1 FROM "MealRecipeItem" i WHERE i."id" = 'mri-bf-' || e."id"
    )
),
"target" AS (
    SELECT
        o."id" AS "entryId",
        o."servings",
        o."cooked",
        o."recipeId",
        o."jdCreated",
        'meal-ct-' || MIN(o."id") OVER (
            PARTITION BY o."mealPlanId", o."utcDay", o."mealType"
        ) AS "mealId",
        ROW_NUMBER() OVER (
            PARTITION BY o."mealPlanId", o."utcDay", o."mealType"
            ORDER BY o."jdCreated", o."id"
        ) - 1 AS "itemOrder"
    FROM "orphan" o
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
ON CONFLICT ("id") DO NOTHING;

-- Step 3: renumber only the days the sweep appended to, preserving every
-- existing Meal's relative position (their orders are all below the
-- placeholder) and keeping recreated Meals after them in slot order.
WITH "ranked" AS (
    SELECT
        m."id" AS "mid",
        ROW_NUMBER() OVER (
            PARTITION BY m."mealPlanId", m."date"
            ORDER BY m."order", m."createdAt", m."id"
        ) - 1 AS "newOrder"
    FROM "Meal" m
    WHERE EXISTS (
        SELECT 1 FROM "Meal" c
        WHERE c."mealPlanId" = m."mealPlanId"
          AND c."date" = m."date"
          AND c."id" LIKE 'meal-ct-%'
    )
)
UPDATE "Meal"
SET "order" = (SELECT "newOrder" FROM "ranked" WHERE "ranked"."mid" = "Meal"."id")
WHERE "id" IN (SELECT "mid" FROM "ranked");

-- Step 4: the legacy representation retires. Its indexes drop with it.
DROP TABLE "MealPlanEntry";
