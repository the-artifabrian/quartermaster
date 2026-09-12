# #225 — dependable Shopping checks

Branch: `fix/225-shopping-checks`, based on `8c0fbf4`.

Checkboxes submit the desired state and the purchase version the shopper saw.
Unconfirmed work stays on the open Shopping page with local feedback and Retry
when needed. Clear checked excludes those rows. Another device signed into the
same account now receives Shopping changes through SSE and polling.

## Local review

From the repository root, create a disposable database:

```sh
git switch fix/225-shopping-checks
export QM225_REVIEW_DIR="$(mktemp -d /tmp/qm225-review.XXXXXX)"
export DATABASE_URL="file:$QM225_REVIEW_DIR/review.db"
bunx prisma migrate deploy
bun scripts/reviews/225-fixture.ts
bun run build
PORT=3225 bun run start:mocks
```

Open <http://localhost:3225/shopping>. Sign in as `shoppingreview` or
`shoppingmember`, password `local-shopping-225`. Both belong to the same
disposable Pro household. The fixture refuses to run against a database that
already contains users. Use another port if 3225 is occupied.

1. Check and uncheck Rice, including quick repeated taps. The last tap wins;
   after confirmation the row follows the ordinary unchecked/checked ordering.
2. Open another tab/window as `shoppingreview`, then add, check and clear on the
   first page. The idle second page updates. Repeat in a separate browser as
   `shoppingmember` to check household sharing.
3. In browser developer tools, block requests matching
   `*resources/shopping-check*`, then check an item. The list remains readable,
   with “Couldn’t confirm this check” and Retry. Other Shopping controls work.
4. With that check unconfirmed, Clear checked removes Bread but retains the
   unconfirmed row. Navigating to Recipes warns before discarding pending
   intent; staying keeps the change. Unblock requests and press Retry. Once
   confirmed, navigation proceeds without that warning.
5. With a check unconfirmed, change its quantity or delete it from the other
   browser. The refreshed outcome replaces the obsolete intent. Retry cannot
   check a changed quantity or recreate a removed item.
6. Repeat at a narrow viewport and expand/collapse Later or filter the list
   while a check is pending. Its state belongs to the page, so hiding the row
   does not discard it.

For deterministic lost-response, concurrency, and fallback cases, stop the
manual server and run against the same disposable database/build:

```sh
CI=true PORT=3225 bunx playwright test \
  tests/e2e/shopping-checks.test.ts tests/e2e/shopping-list.test.ts \
  --workers=1 --retries=0 --reporter=line
```

## Implementation and recovery

The original regression command was:

```sh
bun run test --run app/routes/plan/shopping-list-actions.test.ts \
  -t 'retrying the same desired check'
```

Before the repair, two identical requests returned the purchase to unchecked:
expected `checked: true`, received `false` (1.70 seconds for the focused run).
The existing action unconditionally inverted the stored value. Direct
reproduction confirmed the cause already identified in source review; no
production instrumentation was needed.

`ShoppingListItem.checkVersion` advances atomically through SQLite triggers for
changes to displayed content, checked state, list/section, and Meal
contributions. This covers existing alternate writers without requiring them to
remember a separate invalidation call. A conditional update checks household
ownership and that version. `lastCheckMutationId` retains only the latest
checkbox write so a lost-response retry can recognize its own commit, while a
later member's check/uncheck still invalidates the old request. Future
table-rebuild migrations must recreate these triggers.

These two fields are write coordination, not purchase history. JSON export and
restore continue to preserve the existing purchase data; restored rows receive
fresh IDs/versions and no outstanding local request is restored. The migration
only adds columns/triggers and retains existing rows and contributions. The
migration test rehearses existing-data preservation, contribution movement and
deletion, and transaction rollback on a disposable SQLite database.

The JSON resource uses the same authorized write operation as the existing
Shopping action. Legacy toggle submissions without a desired state/version are
rejected with reload feedback. Resource reads are private and uncached. The
browser handles transport errors locally instead of invoking the whole route's
error boundary.

Each request has an eight-second deadline. A failed write is read back before
replay; at most one automatic replay occurs for an unchanged observed version.
Manual Retry also reads first. Changes, deletion and authorization loss stop
replay. Pending intent is held only in memory for this page and is isolated by
list; leaving/closing/reloading does not retain it. An in-flight request may
already have committed, which is why failure copy says unconfirmed.

Reversing an uncertain check still requires confirming the original request
before saving the reversal. An unchanged read alone cannot establish that the
original request will not commit later. This also ensures that a delayed copy
cannot undo a reversal after the page has cleared its pending state.

Household events include a document identity for Shopping writes. All eligible
devices receive events; the origin document advances its event cursor without
redundantly refreshing itself. Own-account events refresh data without creating
self-notification toasts. Existing Pro UI boundaries remain in place.

## Review follow-up

- Fixed a delayed-request race: check, uncheck before the first request
  finishes, then lose its response. Previously an unchanged read cleared pending
  state, allowing the original request to check the item afterward. The browser
  regression `reversing an uncertain check` reproduced this with stored
  `checked: true` instead of `false`; it now passes. The retry path confirms the
  outstanding request before applying the latest tap and shows saving feedback
  while writing.
- Added the missing origin identity to From Staples submissions and move
  confirmations, preventing redundant refreshes in the submitting document.
- Added browser coverage for a late successful response after a newer household
  requirement has refreshed, and stalled writes exhausting their bounded retry.

## Verification

- Full Vitest suite before this review follow-up: 117 files, 1,446 tests passed.
  After the fixes, all 30 affected component, action and migration tests passed.
- Typecheck, lint and production build passed. Lint retains four existing
  test-cleanup warnings outside this change.
- All 16 focused Chromium checks passed. They cover real authenticated writes,
  failures before commit, lost responses after commit, later device writes,
  rapid taps during revalidation, stale/deleted/unauthorized work, pending Clear
  checked, navigation, same-account SSE/polling, and existing Shopping journeys.
- Browser evidence uses disposable accounts, desktop/phone viewports and
  controlled failures. It is not a physical-device or normal-shopping trial.

No production data was used. PR opening remains a separate approval after local
review, following `docs/DEVELOPMENT_PLAN.md`.
