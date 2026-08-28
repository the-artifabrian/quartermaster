-- Add the honest Recipe metadata alongside the legacy fields. Prep, Cook, and
-- servings stay in place until their consumers move in later tickets.
ALTER TABLE "Recipe" ADD COLUMN "activeTime" INTEGER;
ALTER TABLE "Recipe" ADD COLUMN "totalTime" INTEGER;
ALTER TABLE "Recipe" ADD COLUMN "yieldAmount" REAL
  CONSTRAINT "Recipe_yieldAmount_positive"
  CHECK ("yieldAmount" IS NULL OR "yieldAmount" > 0);
ALTER TABLE "Recipe" ADD COLUMN "yieldLabel" TEXT;

-- Legacy Prep does not distinguish hands-on time, so Active stays unknown.
-- A Total is safe only when both legacy parts are present, non-negative, and
-- add up to a positive duration. Partial, missing, and zero-only values remain
-- unknown. Legacy servings never populate either typed-yield field.
UPDATE "Recipe"
SET "totalTime" = "prepTime" + "cookTime"
WHERE "prepTime" IS NOT NULL
  AND "cookTime" IS NOT NULL
  AND "prepTime" >= 0
  AND "cookTime" >= 0
  AND "prepTime" + "cookTime" > 0;
