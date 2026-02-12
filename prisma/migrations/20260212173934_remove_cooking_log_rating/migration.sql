-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CookingLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cookedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "recipeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "CookingLog_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CookingLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CookingLog" ("cookedAt", "createdAt", "id", "notes", "recipeId", "updatedAt", "userId") SELECT "cookedAt", "createdAt", "id", "notes", "recipeId", "updatedAt", "userId" FROM "CookingLog";
DROP TABLE "CookingLog";
ALTER TABLE "new_CookingLog" RENAME TO "CookingLog";
CREATE INDEX "CookingLog_recipeId_idx" ON "CookingLog"("recipeId");
CREATE INDEX "CookingLog_userId_idx" ON "CookingLog"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
