-- Complete the staged Recipe metadata transition (#124). Every production
-- consumer now uses Active/Total/typed Yield or a stored scale multiplier, so
-- the unverified Prep/Cook/servings columns can be removed. This copy never
-- derives typed yield from legacy servings and leaves existing explicit
-- metadata byte-for-byte unchanged.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Recipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "activeTime" INTEGER,
    "totalTime" INTEGER,
    "yieldAmount" REAL
      CONSTRAINT "Recipe_yieldAmount_positive"
      CHECK ("yieldAmount" IS NULL OR "yieldAmount" > 0),
    "yieldLabel" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "rawText" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "householdId" TEXT,
	CONSTRAINT "Recipe_yield_pair"
	  CHECK (
	    ("yieldAmount" IS NULL AND "yieldLabel" IS NULL) OR
	    ("yieldAmount" IS NOT NULL AND "yieldLabel" IS NOT NULL AND trim("yieldLabel") <> '')
	  ),
    CONSTRAINT "Recipe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Recipe_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Recipe" (
    "id", "title", "description", "activeTime", "totalTime", "yieldAmount",
    "yieldLabel", "isFavorite", "isAiGenerated", "sourceUrl", "rawText",
    "notes", "createdAt", "updatedAt", "userId", "householdId"
)
SELECT
    "id", "title", "description", "activeTime", "totalTime", "yieldAmount",
    "yieldLabel", "isFavorite", "isAiGenerated", "sourceUrl", "rawText",
    "notes", "createdAt", "updatedAt", "userId", "householdId"
FROM "Recipe";

DROP TABLE "Recipe";
ALTER TABLE "new_Recipe" RENAME TO "Recipe";
CREATE INDEX "Recipe_userId_idx" ON "Recipe"("userId");
CREATE INDEX "Recipe_householdId_idx" ON "Recipe"("householdId");
-- Preserve the historical title index while contracting unrelated columns.
CREATE INDEX "Recipe_title_idx" ON "Recipe"("title");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
