ALTER TABLE "ShoppingListItem"
ADD COLUMN "horizon" TEXT NOT NULL DEFAULT 'next'
CHECK ("horizon" IN ('next', 'later'));

CREATE INDEX "ShoppingListItem_listId_horizon_checked_idx"
ON "ShoppingListItem"("listId", "horizon", "checked");
