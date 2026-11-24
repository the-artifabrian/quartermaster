-- The demo Household (#440): a demo user's expiry, the cap all demo users
-- share on AI features, and the pointer to the template copies are made from.
-- Only new columns, tables and indexes, so the image before this one still
-- boots on it.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "demoExpiresAt" DATETIME;

-- CreateTable
CREATE TABLE "DemoAiUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DemoTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'current',
    "contentVersion" TEXT NOT NULL,
    "photoVersion" TEXT NOT NULL,
    "builtAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    CONSTRAINT "DemoTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DemoTemplate_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DemoAiUsage_createdAt_idx" ON "DemoAiUsage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DemoTemplate_userId_key" ON "DemoTemplate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DemoTemplate_householdId_key" ON "DemoTemplate"("householdId");

-- CreateIndex
CREATE INDEX "User_demoExpiresAt_idx" ON "User"("demoExpiresAt");
