-- A meal plan belongs to a household week. Backfill the last nullable legacy
-- rows, merge plans that already share that identity, then enforce it.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

UPDATE "MealPlan"
SET "householdId" = (
    SELECT "HouseholdMember"."householdId"
    FROM "HouseholdMember"
    WHERE "HouseholdMember"."userId" = "MealPlan"."userId"
    ORDER BY "HouseholdMember"."createdAt", "HouseholdMember"."id"
    LIMIT 1
)
WHERE "householdId" IS NULL;

CREATE TEMP TABLE "_MealPlanMerge" (
    "oldId" TEXT NOT NULL PRIMARY KEY,
    "canonicalId" TEXT NOT NULL
);

INSERT INTO "_MealPlanMerge" ("oldId", "canonicalId")
SELECT
    "id",
    FIRST_VALUE("id") OVER (
        PARTITION BY COALESCE("householdId", 'orphan:' || "userId"), "weekStart"
        ORDER BY "createdAt", "id"
    )
FROM "MealPlan";

CREATE TABLE "new_MealPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekStart" DATETIME NOT NULL,
    "householdId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MealPlan_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_MealPlan" (
    "id", "weekStart", "householdId", "createdAt", "updatedAt"
)
SELECT
    "canonical"."id",
    "canonical"."weekStart",
    "canonical"."householdId",
    MIN("oldPlan"."createdAt"),
    MAX("oldPlan"."updatedAt")
FROM "_MealPlanMerge" AS "merge"
JOIN "MealPlan" AS "oldPlan" ON "oldPlan"."id" = "merge"."oldId"
JOIN "MealPlan" AS "canonical" ON "canonical"."id" = "merge"."canonicalId"
GROUP BY
    "canonical"."id",
    "canonical"."weekStart",
    "canonical"."householdId";

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

WITH "rankedEntries" AS (
    SELECT
        "entry".*,
        "merge"."canonicalId",
        ROW_NUMBER() OVER (
            PARTITION BY
                "merge"."canonicalId",
                "entry"."date",
                "entry"."mealType",
                "entry"."recipeId"
            ORDER BY "entry"."createdAt", "entry"."id"
        ) AS "entryRank",
        MAX("entry"."cooked") OVER (
            PARTITION BY
                "merge"."canonicalId",
                "entry"."date",
                "entry"."mealType",
                "entry"."recipeId"
        ) AS "mergedCooked",
        FIRST_VALUE("entry"."servings") OVER (
            PARTITION BY
                "merge"."canonicalId",
                "entry"."date",
                "entry"."mealType",
                "entry"."recipeId"
            ORDER BY
                CASE WHEN "entry"."servings" IS NULL THEN 1 ELSE 0 END,
                "entry"."createdAt" DESC,
                "entry"."id" DESC
        ) AS "mergedServings"
    FROM "MealPlanEntry" AS "entry"
    JOIN "_MealPlanMerge" AS "merge" ON "merge"."oldId" = "entry"."mealPlanId"
)
INSERT INTO "new_MealPlanEntry" (
    "id", "date", "mealType", "servings", "cooked", "mealPlanId", "recipeId", "createdAt"
)
SELECT
    "id",
    "date",
    "mealType",
    "mergedServings",
    "mergedCooked",
    "canonicalId",
    "recipeId",
    "createdAt"
FROM "rankedEntries"
WHERE "entryRank" = 1;

DROP TABLE "MealPlanEntry";
DROP TABLE "MealPlan";
ALTER TABLE "new_MealPlan" RENAME TO "MealPlan";
ALTER TABLE "new_MealPlanEntry" RENAME TO "MealPlanEntry";
DROP TABLE "_MealPlanMerge";

CREATE UNIQUE INDEX "MealPlan_householdId_weekStart_key" ON "MealPlan"("householdId", "weekStart");
CREATE INDEX "MealPlanEntry_mealPlanId_idx" ON "MealPlanEntry"("mealPlanId");
CREATE INDEX "MealPlanEntry_recipeId_idx" ON "MealPlanEntry"("recipeId");
CREATE UNIQUE INDEX "MealPlanEntry_mealPlanId_date_mealType_recipeId_key" ON "MealPlanEntry"("mealPlanId", "date", "mealType", "recipeId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
