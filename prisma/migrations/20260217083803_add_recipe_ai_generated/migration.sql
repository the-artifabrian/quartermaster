-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Recipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "servings" INTEGER NOT NULL DEFAULT 4,
    "prepTime" INTEGER,
    "cookTime" INTEGER,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "rawText" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "householdId" TEXT,
    CONSTRAINT "Recipe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Recipe_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Recipe" ("cookTime", "createdAt", "description", "householdId", "id", "isFavorite", "notes", "prepTime", "rawText", "servings", "sourceUrl", "title", "updatedAt", "userId") SELECT "cookTime", "createdAt", "description", "householdId", "id", "isFavorite", "notes", "prepTime", "rawText", "servings", "sourceUrl", "title", "updatedAt", "userId" FROM "Recipe";
DROP TABLE "Recipe";
ALTER TABLE "new_Recipe" RENAME TO "Recipe";
CREATE INDEX "Recipe_userId_idx" ON "Recipe"("userId");
CREATE INDEX "Recipe_householdId_idx" ON "Recipe"("householdId");
CREATE INDEX "Recipe_title_idx" ON "Recipe"("title");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
