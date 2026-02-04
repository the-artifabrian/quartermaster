-- DropIndex
DROP INDEX "MealPlanEntry_mealPlanId_date_mealType_key";

-- CreateIndex
CREATE UNIQUE INDEX "MealPlanEntry_mealPlanId_date_mealType_recipeId_key" ON "MealPlanEntry"("mealPlanId", "date", "mealType", "recipeId");
