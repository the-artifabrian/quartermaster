#!/usr/bin/env bash
# Runs the Playwright suite the way CI does: a production build, a throwaway
# database in WAL mode (as production runs it), and CI mode. Extra arguments go
# to `playwright test`, so `scripts/e2e.sh tests/e2e/plan.test.ts` runs one file.
# PORT defaults to 3117 to stay off a dev server on :3000.
set -euo pipefail

cd "$(dirname "$0")/.."

export PORT="${PORT:-3117}"
DB_DIR="$(mktemp -d)"
trap 'rm -rf "$DB_DIR"' EXIT
export DATABASE_PATH="$DB_DIR/e2e.db"
export DATABASE_URL="file:$DATABASE_PATH"
# Tiny generated photos for the demo template. The server reads the same
# directory, so its startup build finds the template current.
export DEMO_PHOTO_DIR="$DB_DIR/demo-photos"

bun run build
bunx prisma migrate deploy
bun prisma/run-seed-infrastructure.ts
bun tests/build-e2e-demo-template.ts
bun prisma/journal-mode-wal.ts
CI=true bunx playwright test "$@"
