-- Roadmap 1A (#100): ordered discriminated Menu items. Purely additive — one
-- new table, no existing rows touched. kind = 'recipe' for now (#102 adds note
-- cards). "recipeTitle" freezes the display title at add/replace time and
-- "recipeId" is nulled on Recipe deletion (ON DELETE SET NULL), so a deleted
-- Recipe leaves a clearly missing card instead of silently shrinking the Menu.
-- "scaleMultiplier" stores positive decimal ingredient batches (1 = one batch);
-- legacy Recipe.servings is deliberately not consulted (#98 readiness
-- corrections). Rehearsed on a disposable copy of the development database:
-- integrity_check and foreign_key_check clean, pre-existing row counts
-- unchanged.

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "recipeTitle" TEXT,
    "scaleMultiplier" REAL,
    "note" TEXT,
    "recipeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sectionId" TEXT NOT NULL,
    CONSTRAINT "MenuItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MenuItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "MenuSection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MenuItem_sectionId_order_idx" ON "MenuItem"("sectionId", "order");

-- CreateIndex
CREATE INDEX "MenuItem_recipeId_idx" ON "MenuItem"("recipeId");
