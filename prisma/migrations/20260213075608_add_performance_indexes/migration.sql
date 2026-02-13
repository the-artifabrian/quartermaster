-- CreateIndex
CREATE INDEX "CookingLog_recipeId_userId_idx" ON "CookingLog"("recipeId", "userId");

-- CreateIndex
CREATE INDEX "HouseholdEvent_householdId_userId_idx" ON "HouseholdEvent"("householdId", "userId");

-- CreateIndex
CREATE INDEX "MealPlan_householdId_weekStart_idx" ON "MealPlan"("householdId", "weekStart");
