-- CreateTable
CREATE TABLE "RecipeMetadataValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dimension" TEXT NOT NULL CONSTRAINT "RecipeMetadataValue_dimension_valid"
        CHECK ("dimension" IN ('cuisine', 'season', 'course')),
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "householdId" TEXT NOT NULL,
    CONSTRAINT "RecipeMetadataValue_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecipeMetadataAssignment" (
    "recipeId" TEXT NOT NULL,
    "valueId" TEXT NOT NULL,

    PRIMARY KEY ("recipeId", "valueId"),
    CONSTRAINT "RecipeMetadataAssignment_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecipeMetadataAssignment_valueId_fkey" FOREIGN KEY ("valueId") REFERENCES "RecipeMetadataValue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RecipeMetadataValue_householdId_dimension_nameKey_key" ON "RecipeMetadataValue"("householdId", "dimension", "nameKey");

-- CreateIndex
CREATE INDEX "RecipeMetadataValue_householdId_dimension_sortOrder_name_idx" ON "RecipeMetadataValue"("householdId", "dimension", "sortOrder", "name");

-- CreateIndex
CREATE INDEX "RecipeMetadataAssignment_valueId_idx" ON "RecipeMetadataAssignment"("valueId");

-- Seed the small shared defaults for every existing household. Cuisine starts
-- empty because it is household-specific.
INSERT INTO "RecipeMetadataValue" (
    "id", "dimension", "name", "nameKey", "sortOrder", "createdAt", "updatedAt", "householdId"
)
SELECT
    'rmv_' || lower(hex(randomblob(16))),
    defaults."dimension",
    defaults."name",
    defaults."nameKey",
    defaults."sortOrder",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    household."id"
FROM "Household" AS household
CROSS JOIN (
    SELECT 'season' AS "dimension", 'Year-round' AS "name", 'year-round' AS "nameKey", 0 AS "sortOrder"
    UNION ALL SELECT 'season', 'Spring', 'spring', 10
    UNION ALL SELECT 'season', 'Summer', 'summer', 20
    UNION ALL SELECT 'season', 'Autumn', 'autumn', 30
    UNION ALL SELECT 'season', 'Winter', 'winter', 40
    UNION ALL SELECT 'course', 'Breakfast', 'breakfast', 0
    UNION ALL SELECT 'course', 'Main', 'main', 10
    UNION ALL SELECT 'course', 'Side', 'side', 20
    UNION ALL SELECT 'course', 'Dessert', 'dessert', 30
) AS defaults;
