-- Staples become a quick-add list of usual items (#289): no Available/Out
-- state, and no legacy Pantry behind a cutover flag. Three removals in one
-- migration, in an order that never reads a column it has already dropped.

-- 1. Carry the legacy Pantry forward for households that never cut over.
-- A Pantry was already a list of things the household usually has, which is
-- exactly what a Staple now means, so the rows convert rather than vanish.
-- Households that did cut over reviewed their Staples then; their archived
-- Pantry is the recovery data this change deliberately retires.
--
-- The canonical key follows householdIngredientKey(): trimmed,
-- whitespace-collapsed, lower-cased. NFKC is a JS-side nicety of the add
-- form; stored Pantry names are plain typed text. Timestamps are written as
-- ISO-8601, matching what Prisma writes, not SQLite's CURRENT_TIMESTAMP.
WITH "candidate" AS (
    SELECT
        item."id" AS "id",
        item."createdAt" AS "createdAt",
        item."householdId" AS "householdId",
        trim(
            replace(
                replace(
                    replace(
                        replace(replace(item."name", char(9), ' '), char(10), ' '),
                        char(13), ' '
                    ),
                    '  ', ' '
                ),
                '  ', ' '
            )
        ) AS "displayName"
    FROM "InventoryItem" AS item
    JOIN "Household" AS household ON household."id" = item."householdId"
    WHERE household."staplesCutoverAt" IS NULL
),
"ranked" AS (
    SELECT
        "householdId",
        lower("displayName") AS "canonicalKey",
        "displayName",
        -- Two Pantry rows can share one key ("Olive oil", "OLIVE OIL"); the
        -- one added first supplies the display name. Ordering by "createdAt"
        -- is deterministic but not strictly chronological, because the column
        -- mixes INTEGER-ms and TEXT ISO storage eras — only the capitalization
        -- of a duplicate rides on it.
        row_number() OVER (
            PARTITION BY "householdId", lower("displayName")
            ORDER BY "createdAt", "id"
        ) AS "rank"
    FROM "candidate"
    WHERE "displayName" <> ''
),
"staple" AS (
    SELECT "householdId", "canonicalKey", "displayName"
    FROM "ranked"
    WHERE "rank" = 1
)
INSERT INTO "HouseholdIngredient" (
    "id", "displayName", "canonicalKey", "isStaple", "isOut",
    "createdAt", "updatedAt", "householdId"
)
SELECT
    'hi_' || lower(hex(randomblob(16))),
    "staple"."displayName",
    "staple"."canonicalKey",
    true,
    false,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    "staple"."householdId"
FROM "staple"
-- An existing identity keeps its own row and its own Staple classification;
-- the unique key is household identity, not a Pantry copy.
WHERE NOT EXISTS (
    SELECT 1
    FROM "HouseholdIngredient" AS existing
    WHERE existing."householdId" = "staple"."householdId"
      AND existing."canonicalKey" = "staple"."canonicalKey"
);

-- 2. Drop isOut. A rebuild rather than DROP COLUMN: the column carries both
-- an index and the out-requires-staple CHECK constraint, neither of which
-- SQLite's DROP COLUMN supports.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_HouseholdIngredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "isStaple" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "householdId" TEXT NOT NULL,
    CONSTRAINT "HouseholdIngredient_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_HouseholdIngredient" ("canonicalKey", "createdAt", "displayName", "householdId", "id", "isStaple", "updatedAt") SELECT "canonicalKey", "createdAt", "displayName", "householdId", "id", "isStaple", "updatedAt" FROM "HouseholdIngredient";
DROP TABLE "HouseholdIngredient";
ALTER TABLE "new_HouseholdIngredient" RENAME TO "HouseholdIngredient";
CREATE UNIQUE INDEX "HouseholdIngredient_householdId_canonicalKey_key" ON "HouseholdIngredient"("householdId", "canonicalKey");
CREATE INDEX "HouseholdIngredient_householdId_isStaple_idx" ON "HouseholdIngredient"("householdId", "isStaple");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- 3. Retire the legacy Pantry and the cutover flag it was gated behind.
DROP TABLE "InventoryItem";
ALTER TABLE "Household" DROP COLUMN "staplesCutoverAt";
