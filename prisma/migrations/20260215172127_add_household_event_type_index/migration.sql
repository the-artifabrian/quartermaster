-- CreateIndex
CREATE INDEX "HouseholdEvent_householdId_type_createdAt_idx" ON "HouseholdEvent"("householdId", "type", "createdAt");
