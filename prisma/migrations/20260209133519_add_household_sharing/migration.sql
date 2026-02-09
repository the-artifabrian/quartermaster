-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'My Household',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HouseholdMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "subscriptionExpiresAt" DATETIME,
    "trialEndsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "quantity" REAL,
    "unit" TEXT,
    "expiresAt" DATETIME,
    "lowStock" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "householdId" TEXT,
    CONSTRAINT "InventoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryItem_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_InventoryItem" ("createdAt", "expiresAt", "id", "location", "lowStock", "name", "quantity", "unit", "updatedAt", "userId") SELECT "createdAt", "expiresAt", "id", "location", "lowStock", "name", "quantity", "unit", "updatedAt", "userId" FROM "InventoryItem";
DROP TABLE "InventoryItem";
ALTER TABLE "new_InventoryItem" RENAME TO "InventoryItem";
CREATE INDEX "InventoryItem_userId_idx" ON "InventoryItem"("userId");
CREATE INDEX "InventoryItem_userId_location_idx" ON "InventoryItem"("userId", "location");
CREATE INDEX "InventoryItem_householdId_idx" ON "InventoryItem"("householdId");
CREATE TABLE "new_MealPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekStart" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "householdId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MealPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealPlan_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MealPlan" ("createdAt", "id", "updatedAt", "userId", "weekStart") SELECT "createdAt", "id", "updatedAt", "userId", "weekStart" FROM "MealPlan";
DROP TABLE "MealPlan";
ALTER TABLE "new_MealPlan" RENAME TO "MealPlan";
CREATE INDEX "MealPlan_userId_idx" ON "MealPlan"("userId");
CREATE INDEX "MealPlan_householdId_idx" ON "MealPlan"("householdId");
CREATE UNIQUE INDEX "MealPlan_userId_weekStart_key" ON "MealPlan"("userId", "weekStart");
CREATE TABLE "new_Recipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "servings" INTEGER NOT NULL DEFAULT 4,
    "prepTime" INTEGER,
    "cookTime" INTEGER,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_Recipe" ("cookTime", "createdAt", "description", "id", "isFavorite", "notes", "prepTime", "rawText", "servings", "sourceUrl", "title", "updatedAt", "userId") SELECT "cookTime", "createdAt", "description", "id", "isFavorite", "notes", "prepTime", "rawText", "servings", "sourceUrl", "title", "updatedAt", "userId" FROM "Recipe";
DROP TABLE "Recipe";
ALTER TABLE "new_Recipe" RENAME TO "Recipe";
CREATE INDEX "Recipe_userId_idx" ON "Recipe"("userId");
CREATE INDEX "Recipe_householdId_idx" ON "Recipe"("householdId");
CREATE INDEX "Recipe_title_idx" ON "Recipe"("title");
CREATE TABLE "new_ShoppingList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'Shopping List',
    "userId" TEXT NOT NULL,
    "householdId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShoppingList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShoppingList_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ShoppingList" ("createdAt", "id", "name", "updatedAt", "userId") SELECT "createdAt", "id", "name", "updatedAt", "userId" FROM "ShoppingList";
DROP TABLE "ShoppingList";
ALTER TABLE "new_ShoppingList" RENAME TO "ShoppingList";
CREATE INDEX "ShoppingList_userId_idx" ON "ShoppingList"("userId");
CREATE INDEX "ShoppingList_householdId_idx" ON "ShoppingList"("householdId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "HouseholdMember_householdId_idx" ON "HouseholdMember"("householdId");

-- CreateIndex
CREATE INDEX "HouseholdMember_userId_idx" ON "HouseholdMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdMember_householdId_userId_key" ON "HouseholdMember"("householdId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- Backfill: create a Household per existing User
INSERT INTO "Household" ("id", "name", "createdAt", "updatedAt")
SELECT 'hh_' || "id",
       COALESCE("name", "username") || '''s Household',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User";

-- Backfill: each user is owner of their household
INSERT INTO "HouseholdMember" ("id", "role", "createdAt", "updatedAt", "householdId", "userId")
SELECT 'hm_' || "id", 'owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
       'hh_' || "id", "id"
FROM "User";

-- Backfill: set householdId on all shared models
UPDATE "Recipe" SET "householdId" = 'hh_' || "userId" WHERE "householdId" IS NULL;
UPDATE "InventoryItem" SET "householdId" = 'hh_' || "userId" WHERE "householdId" IS NULL;
UPDATE "MealPlan" SET "householdId" = 'hh_' || "userId" WHERE "householdId" IS NULL;
UPDATE "ShoppingList" SET "householdId" = 'hh_' || "userId" WHERE "householdId" IS NULL;
