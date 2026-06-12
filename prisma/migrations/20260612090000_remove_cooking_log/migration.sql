/*
  Warnings:

  - You are about to drop the `CookingLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CookingLog";
PRAGMA foreign_keys=on;
