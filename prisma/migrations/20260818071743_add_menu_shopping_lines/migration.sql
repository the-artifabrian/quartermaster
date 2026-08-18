-- Roadmap 1A (#102): ordered Shopping lines under Menu note cards. Purely
-- additive — one new table, no existing rows touched. A note card (MenuItem
-- kind = 'note', text in "note") may carry several ordinary Shopping lines
-- with a required name and optional free-text quantity/unit, so supporting
-- purchases travel with the Menu without a drink/decor/plating subsystem.
-- Lines cascade with their item. Rehearsed on a disposable copy of the
-- development database: integrity_check and foreign_key_check clean,
-- pre-existing row counts unchanged.

-- CreateTable
CREATE TABLE "MenuShoppingLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "quantity" TEXT,
    "unit" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "itemId" TEXT NOT NULL,
    CONSTRAINT "MenuShoppingLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MenuItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MenuShoppingLine_itemId_order_idx" ON "MenuShoppingLine"("itemId", "order");
