/*
  Warnings:

  - You are about to drop the `MealPlanTemplate` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MealPlanTemplateEntry` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `notificationsLastSeenAt` on the `HouseholdMember` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "MealPlanTemplate_householdId_idx";

-- DropIndex
DROP INDEX "MealPlanTemplate_userId_idx";

-- DropIndex
DROP INDEX "MealPlanTemplateEntry_recipeId_idx";

-- DropIndex
DROP INDEX "MealPlanTemplateEntry_templateId_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MealPlanTemplate";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MealPlanTemplateEntry";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_HouseholdMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HouseholdMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_HouseholdMember" ("createdAt", "householdId", "id", "role", "updatedAt", "userId") SELECT "createdAt", "householdId", "id", "role", "updatedAt", "userId" FROM "HouseholdMember";
DROP TABLE "HouseholdMember";
ALTER TABLE "new_HouseholdMember" RENAME TO "HouseholdMember";
CREATE INDEX "HouseholdMember_householdId_idx" ON "HouseholdMember"("householdId");
CREATE INDEX "HouseholdMember_userId_idx" ON "HouseholdMember"("userId");
CREATE UNIQUE INDEX "HouseholdMember_householdId_userId_key" ON "HouseholdMember"("householdId", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
