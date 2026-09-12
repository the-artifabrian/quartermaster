ALTER TABLE "Menu" ADD COLUMN "copiedFromMenuId" TEXT;
CREATE UNIQUE INDEX "Menu_householdId_copiedFromMenuId_key" ON "Menu"("householdId", "copiedFromMenuId");
