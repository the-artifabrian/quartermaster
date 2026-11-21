-- CreateTable
CREATE TABLE "EmailCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "linkTokenHash" TEXT NOT NULL,
    "address" TEXT,
    "sentAt" DATETIME,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "EmailCode_target_type_idx" ON "EmailCode"("target", "type");

-- Emailed codes move to EmailCode. Codes still in flight stop working.
DELETE FROM "Verification" WHERE "type" IN ('onboarding', 'reset-password', 'change-email');
