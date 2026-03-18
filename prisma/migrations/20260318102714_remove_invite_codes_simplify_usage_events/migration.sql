-- DropIndex
DROP INDEX "InviteCode_redeemedById_idx";

-- DropIndex
DROP INDEX "InviteCode_createdById_idx";

-- DropIndex
DROP INDEX "InviteCode_code_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "InviteCode";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UsageEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UsageEvent" ("createdAt", "id", "type", "userId") SELECT "createdAt", "id", "type", "userId" FROM "UsageEvent";
DROP TABLE "UsageEvent";
ALTER TABLE "new_UsageEvent" RENAME TO "UsageEvent";
CREATE INDEX "UsageEvent_type_createdAt_idx" ON "UsageEvent"("type", "createdAt");
CREATE INDEX "UsageEvent_userId_createdAt_idx" ON "UsageEvent"("userId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
