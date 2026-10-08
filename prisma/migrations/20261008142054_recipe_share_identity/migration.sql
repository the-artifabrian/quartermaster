-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN "copiedFromRecipeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_householdId_copiedFromRecipeId_key" ON "Recipe"("householdId", "copiedFromRecipeId");
