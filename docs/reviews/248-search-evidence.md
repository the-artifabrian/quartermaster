# #248 local review

Branch `fix/248-recipe-search-clarity`, based on merged #260 (`be833bd`).
Accepted #251 B: clearer saved-Recipe search; no chooser. The existing library
presentation, matching/ranking, sort and direct Recipe journey stay intact.
Active restrictions are named below search even with filters collapsed; reset
clears search and restrictions while preserving sort. Unknown time stays
included and says “Time unknown” only under a time constraint.

## Run the prepared checkout

```sh
cd /private/tmp/quartermaster-248
sh /private/tmp/qm-248-review/start.sh
```

Open http://localhost:9248 and sign in with **searchreview** /
**local-search-248**. The unchanged merged build is running at
http://localhost:9247 with the same synthetic library/account for comparison.
Both are local mocked builds, using `/private/tmp/qm-248-review/data.db`.

To recreate independently from this branch, use an empty scratch directory:

```sh
bun install
cp .env.example .env
export DATABASE_URL=file:/tmp/qm-248-fresh/data.db
export DATABASE_PATH=/tmp/qm-248-fresh/data.db
export DATA_VOLUME_PATH=/tmp/qm-248-fresh
mkdir -p "$DATA_VOLUME_PATH"
bunx prisma generate
bunx prisma migrate deploy
bun scripts/reviews/248-fixture.ts
bun run build
PORT=9248 bun run start:mocks
```

The seed refuses a database containing users. Use a new scratch directory for
another run. Never point these commands at household/production data.

## Try

1. `/recipes`: search reads **Search by name or ingredient**. Ordinary cards,
   navigation, sort and controls match the baseline. Unknown time adds no text.
2. `/recipes?favorites=true&search=Walnut&sort=alphabetical`: on a phone, leave
   filters collapsed. Favorites is visible below search; the empty state
   explains the restriction. **Clear search and filters** empties the input and
   reveals Walnut pasta, keeping Alphabetical sorting.
3. `/recipes?maxTime=30`: Lemon rice (30 min) and Walnut pasta (25 min) remain;
   Chickpea lunch says **Time unknown**; Slow roast (120 min) is excluded. The
   existing inclusive policy and filter control labels are unchanged.
4. `/recipes?cuisine=mediterranean`: the actual selected Cuisine is named while
   collapsed. Toggle classification choices normally; reset reaches the full
   library. `/recipes?quality=flagged` also identifies that existing URL filter.
5. Type Walnut and immediately reset, then type again. Old Favorites/time/query
   state must not reappear. Type and immediately toggle Favorites: both your
   text and intentional filter change remain. Clear the text yourself: Favorites
   stays selected.
6. Search Walnut, open its Recipe, and use browser Back. The query, input and
   results agree. Try keyboard Enter on reset, phone/desktop widths, and
   ordinary Recipe edit/save. The import overview and capture flows are
   unaffected.

## Evidence

- 16 focused Vitest tests pass (search matching/ranking, household isolation,
  search loader and classification behavior).
- Production build, TypeScript, lint and formatting/diff checks pass. Lint has
  four pre-existing warnings elsewhere.
- Five production-build Chromium journeys pass: phone/desktop restriction/reset,
  pending typing/filter changes and Back; existing search/typo/diacritic
  journey; classification editing; ordinary Recipe CRUD.
- Identical four-Recipe phone/desktop before/after screenshots inspected for
  unconstrained library, Favorites + Walnut, time and classification. No page
  errors or horizontal overflow in the comparison. Screenshots live in
  `/private/tmp/qm-248-review/` (`9247-*` baseline, `9248-*` proposed).
- Complete application/test/fixture/doc diff reviewed. Fixed the pending-search
  race discovered in browser checks, preserved metadata badge counts, and
  included the effective legacy `quality=flagged` restriction. Affected checks
  rerun after the fix.

Synthetic browser evidence does not establish real dinner-choice value or
physical iPhone behavior. #262's status-bar cause remains unconfirmed; scroll
restoration was preserved. #257 and #223's broad mobile Staples assertion stay
separate. No PR, merge or deployment is authorized by this handoff.
