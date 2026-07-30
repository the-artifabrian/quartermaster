-- A household owns one shopping list. Merge any lists created by concurrent
-- first-touch requests before enforcing that identity in the schema.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TEMP TABLE "_ShoppingListMerge" (
    "oldId" TEXT NOT NULL PRIMARY KEY,
    "canonicalId" TEXT NOT NULL
);

INSERT INTO "_ShoppingListMerge" ("oldId", "canonicalId")
SELECT
    "id",
    FIRST_VALUE("id") OVER (
        PARTITION BY "householdId"
        ORDER BY "createdAt", "id"
    )
FROM "ShoppingList"
WHERE "householdId" IS NOT NULL;

UPDATE "ShoppingListItem"
SET "listId" = (
    SELECT "canonicalId"
    FROM "_ShoppingListMerge"
    WHERE "oldId" = "ShoppingListItem"."listId"
)
WHERE "listId" IN (
    SELECT "oldId"
    FROM "_ShoppingListMerge"
    WHERE "oldId" <> "canonicalId"
);

UPDATE "ShoppingList"
SET "updatedAt" = (
    SELECT MAX("source"."updatedAt")
    FROM "ShoppingList" AS "source"
    JOIN "_ShoppingListMerge" AS "merge"
        ON "merge"."oldId" = "source"."id"
    WHERE "merge"."canonicalId" = "ShoppingList"."id"
)
WHERE "id" IN (
    SELECT "canonicalId"
    FROM "_ShoppingListMerge"
);

DELETE FROM "ShoppingList"
WHERE "id" IN (
    SELECT "oldId"
    FROM "_ShoppingListMerge"
    WHERE "oldId" <> "canonicalId"
);

DROP TABLE "_ShoppingListMerge";

DROP INDEX "ShoppingList_householdId_idx";
CREATE UNIQUE INDEX "ShoppingList_householdId_key" ON "ShoppingList"("householdId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
