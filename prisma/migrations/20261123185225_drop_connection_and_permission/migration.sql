-- Google sign-in and the unused Permission model went in #466, which stopped
-- reading and writing these tables. They are dropped one deploy later so the
-- image before #466, whose boot seed writes Permission rows, could still be
-- rolled back to in between.

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Connection";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Permission";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "_PermissionToRole";
PRAGMA foreign_keys=on;
