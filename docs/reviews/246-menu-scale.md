# Try cooking from a Menu

Open http://localhost:9246/recipes/menus/menu-scale-review. Sign in with
**menureview** / **local-menu-246**.

**Your task: open the first Hummus card, marked 2×.**

The Recipe should show **Scale 2×**, **Makes 8 bowls**, and **800 g chickpeas**.
Tell me if it opens at the quantity you expected.

If the preview is stopped:

```sh
cd /private/tmp/quartermaster-246
sh /private/tmp/qm-246-review/start.sh
```

## Implementation and evidence

Issue [#246](https://github.com/the-artifabrian/quartermaster/issues/246), local
branch `fix/246-menu-recipe-scale`, based on `5221069`.

Menu links now carry each card's multiplier using the same `?scale=` pattern and
formatter as planned Meals. The existing Recipe parser, ingredient/yield
scaling, authorization and missing-Recipe handling are unchanged. Null/1× cards
retain the ordinary Recipe URL. There are no schema or write changes.

Verified on 6 September 2026:

- The new browser regression failed on the original production build: a 2× Menu
  card opened a Recipe without the expected Scale 2× control.
- With the fix, that same journey passes at 390×844 and 1280×800. It covers
  repeated stored references at 2×, 0.5× and 1×, ingredient quantities, known
  yield, ordinary library opening, view-only resets, no implicit Meal or
  Shopping item creation, and comparison with an explicitly planned Meal.
  Repeated references are synthetic database fixtures; the Menu editor's
  existing duplicate restriction is unchanged.
- Two existing browser journeys pass: Menu creation/editing/reordering,
  missing-Recipe recovery and Shopping; and manual known/unknown-yield scaling.
- 68 focused Vitest tests pass across Menu routes, planning from Menus and
  Recipe scale controls, including authorization and missing references.
- Build, typecheck, lint, formatting and diff whitespace checks pass. Lint
  retains four existing disposable-test warnings; build retains existing mixed
  static/dynamic import warnings.
- The preview's actual sign-in and 2× link were exercised in Chromium; the phone
  screenshot was inspected. All data is disposable and synthetic.

Review found the old Menu recovery browser assertion expected the unscaled URL;
it now expects the preserved 2.5× scale. No other change was needed. The full
unit/E2E suites and physical-iPhone Safari were not run for this focused link
change. Browser evidence establishes behavior, not normal-use acceptance. No PR,
merge or deployment.

## Recreate disposable data

From this checkout, choose a fresh directory (the fixture refuses an existing
user database):

```sh
review_dir=$(mktemp -d /private/tmp/qm-246.XXXXXX)
export DATABASE_URL="file:$review_dir/data.db"
export DATABASE_PATH="$review_dir/data.db"
export DATA_VOLUME_PATH="$review_dir"
export PORT=9246
bunx prisma migrate deploy
bun scripts/reviews/246-fixture.ts
bun run build
bun run start:mocks
```

Stop the existing preview before reusing port 9246. This creates a separate
database and does not copy household data. The fixture's Menu URL and sign-in
are the same as above.
