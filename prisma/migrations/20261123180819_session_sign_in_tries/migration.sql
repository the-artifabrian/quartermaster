-- Codes tried against a pending 2FA sign-in, kept on its Session row so a
-- restart doesn't reset the count. Added in place: a rebuild would rewrite
-- every session, and the image before this one ignores the new column.
ALTER TABLE "Session" ADD COLUMN "signInTries" INTEGER NOT NULL DEFAULT 0;
