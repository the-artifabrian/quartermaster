-- CreateTable
CREATE TABLE "MealPlanTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "householdId" TEXT,
    CONSTRAINT "MealPlanTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealPlanTemplate_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MealPlanTemplateEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dayOfWeek" INTEGER NOT NULL,
    "mealType" TEXT NOT NULL,
    "servings" INTEGER,
    "templateId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    CONSTRAINT "MealPlanTemplateEntry_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MealPlanTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealPlanTemplateEntry_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MealPlanTemplate_userId_idx" ON "MealPlanTemplate"("userId");

-- CreateIndex
CREATE INDEX "MealPlanTemplate_householdId_idx" ON "MealPlanTemplate"("householdId");

-- CreateIndex
CREATE INDEX "MealPlanTemplateEntry_templateId_idx" ON "MealPlanTemplateEntry"("templateId");

-- CreateIndex
CREATE INDEX "MealPlanTemplateEntry_recipeId_idx" ON "MealPlanTemplateEntry"("recipeId");
