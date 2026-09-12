ALTER TABLE "ShoppingListItem" ADD COLUMN "checkVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ShoppingListItem" ADD COLUMN "lastCheckMutationId" TEXT;

-- Keep the precondition atomic with every existing writer, including old
-- generation, restocking, recovery and contribution-only changes. A content
-- fingerprint alone would miss check -> uncheck after a lost response.
CREATE TRIGGER "shopping_item_check_version"
AFTER UPDATE OF "name", "quantity", "unit", "checked", "source", "horizon", "listId"
ON "ShoppingListItem"
WHEN OLD."name" IS NOT NEW."name"
  OR OLD."quantity" IS NOT NEW."quantity"
  OR OLD."unit" IS NOT NEW."unit"
  OR OLD."checked" IS NOT NEW."checked"
  OR OLD."source" IS NOT NEW."source"
  OR OLD."horizon" IS NOT NEW."horizon"
  OR OLD."listId" IS NOT NEW."listId"
BEGIN
  UPDATE "ShoppingListItem" SET "checkVersion" = "checkVersion" + 1 WHERE "id" = NEW."id";
END;

CREATE TRIGGER "shopping_contribution_insert_version"
AFTER INSERT ON "MealShoppingContribution"
BEGIN
  UPDATE "ShoppingListItem" SET "checkVersion" = "checkVersion" + 1 WHERE "id" = NEW."itemId";
END;

CREATE TRIGGER "shopping_contribution_delete_version"
AFTER DELETE ON "MealShoppingContribution"
BEGIN
  UPDATE "ShoppingListItem" SET "checkVersion" = "checkVersion" + 1 WHERE "id" = OLD."itemId";
END;

CREATE TRIGGER "shopping_contribution_update_version"
AFTER UPDATE OF "itemId", "mealId", "canonicalName", "name", "quantity", "unit"
ON "MealShoppingContribution"
WHEN OLD."itemId" IS NOT NEW."itemId"
  OR OLD."mealId" IS NOT NEW."mealId"
  OR OLD."canonicalName" IS NOT NEW."canonicalName"
  OR OLD."name" IS NOT NEW."name"
  OR OLD."quantity" IS NOT NEW."quantity"
  OR OLD."unit" IS NOT NEW."unit"
BEGIN
  UPDATE "ShoppingListItem" SET "checkVersion" = "checkVersion" + 1
  WHERE "id" IN (OLD."itemId", NEW."itemId");
END;
