-- Add the explicit household cutover marker. Existing households remain on
-- legacy Pantry behavior because null is deliberately different from a
-- reviewed, confirmed empty Staple selection.
ALTER TABLE "Household" ADD COLUMN "staplesCutoverAt" DATETIME;

-- Durable canonical household ingredients are additive. Legacy InventoryItem
-- rows are neither rewritten nor deleted: they remain the pre-gate recovery
-- source until the later cleanup milestone is explicitly authorized.
CREATE TABLE "HouseholdIngredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "isStaple" BOOLEAN NOT NULL DEFAULT false,
    "isOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "householdId" TEXT NOT NULL,
    CONSTRAINT "HouseholdIngredient_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HouseholdIngredient_out_requires_staple" CHECK ("isOut" = false OR "isStaple" = true)
);

CREATE UNIQUE INDEX "HouseholdIngredient_householdId_canonicalKey_key" ON "HouseholdIngredient"("householdId", "canonicalKey");
CREATE INDEX "HouseholdIngredient_householdId_isStaple_isOut_idx" ON "HouseholdIngredient"("householdId", "isStaple", "isOut");
