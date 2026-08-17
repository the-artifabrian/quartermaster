-- Roadmap 1A (#99): household-owned Menus. Purely additive — two new tables,
-- no existing rows touched. "titleKey" stores the trimmed, NFKC-normalized,
-- lower-cased title so Menu identity is case-insensitive per household.
-- A null MenuSection.name marks the durable unnamed section every Menu keeps.
-- Rehearsed on a disposable copy of the development database: integrity_check
-- and foreign_key_check clean, all pre-existing row counts unchanged.

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "description" TEXT,
    "defaultGuestCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "householdId" TEXT NOT NULL,
    CONSTRAINT "Menu_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MenuSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "menuId" TEXT NOT NULL,
    CONSTRAINT "MenuSection_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Menu_householdId_updatedAt_idx" ON "Menu"("householdId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Menu_householdId_titleKey_key" ON "Menu"("householdId", "titleKey");

-- CreateIndex
CREATE INDEX "MenuSection_menuId_order_idx" ON "MenuSection"("menuId", "order");
