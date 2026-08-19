-- CreateTable
CREATE TABLE "MealShoppingContribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mealId" TEXT,
    "itemId" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" TEXT,
    "unit" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MealShoppingContribution_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "Meal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MealShoppingContribution_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ShoppingListItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MealShoppingContribution_itemId_idx" ON "MealShoppingContribution"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "MealShoppingContribution_mealId_canonicalName_key" ON "MealShoppingContribution"("mealId", "canonicalName");
