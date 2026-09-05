# #233 — local import review handoff

Branch: `feat/233-editable-import-review`, based on merged #259 (`1d9aadd`). The
existing checkout is `/private/tmp/quartermaster-233`. The main checkout and
other worktrees are preserved. PR #260 is open. Alex requested the
overview-first revision after local review; merging or deploying still requires
separate approval.

## Start and disposable data

The local production build is already running at http://localhost:9233. Sign in
with **importreview** / **local-import-233**. This is a synthetic Pro account in
`/private/tmp/qm-233-review/data.db`; no production data is used.

If stopped, run:

```sh
cd /private/tmp/quartermaster-233
sh /private/tmp/qm-233-review/start.sh
```

After local code changes, stop that server, run `bun run build` in this
worktree, and start it again with the same script. The script explicitly selects
the scratch database, local port, mocks and a fake AI key. Dependencies are
linked from the original local checkout; Prisma's generated client is
worktree-local.

Disposable setup was `prisma migrate deploy` against the new scratch database,
then `/private/tmp/qm-233-review/seed.ts` created only the synthetic account and
household. The provider preload at `/private/tmp/qm-233-review/providers.ts`
stubs the fixture URL and Anthropic boundary. The source image is
`/private/tmp/qm-233-review/recipe.png`. These local artifacts are disposable
and are not application configuration.

## Try the affected journeys

1. Open `/recipes/import`, choose **From Text**, and paste:

   ```text
   Chickpea lunch
   Ingredients
   2 cans chickpeas, drained and rinsed thoroughly under cold running water (reserve the liquid for another recipe; if using dried chickpeas instead, soak them overnight and simmer until completely tender before measuring the equivalent cooked weight)
   1 lemon
   Instructions
   Toss the chickpeas with lemon juice and serve.
   ```

2. Choose **Parse Recipe**. The production-style bordered overview card appears
   with **Save Recipe** and **Edit**; no input fields or Original input
   disclosure are visible. You can save directly. To correct something, choose
   **Edit** and expand the chickpea row; its amount is 2, unit is cans, and its
   complete preparation note is editable. Change the amount to 3 and rewrite the
   instruction. Add, remove, or reorder an ingredient or heading. Choose **Done
   editing** to check the revised overview; returning to Edit keeps your
   corrections. The compact typography, ingredient/step counts and metadata
   display match production.
3. Return to **Edit**, empty the title and press **Save Recipe**. The error
   identifies the title; your amount, instruction, notes, and all rows remain.
   Restore the title. Try a mismatched yield or a note longer than 500
   characters: the review stays intact and lists the problem instead of dropping
   content.
4. In browser developer tools, go offline and press **Save Recipe**. The form
   remains with a save-unconfirmed message. Return online and explicitly save.
   One ordinary save opens the corrected Recipe; rapid in-flight clicks are
   blocked. If a real request has an unknown outcome, check My Recipes before
   trying again; the app does not automatically retry creates.
5. Reload the saved Recipe. Confirm the corrections. The cooking screen has no
   **Original input** section. Open **Edit** to find the collapsed disclosure,
   containing the original title, 2 cans and original instruction. Edit normally
   and save; original input remains stored.
6. From URL, try `http://127.0.0.1/internal`: rejection leaves the URL editable.
   Then use `https://recipes.example.test/chickpeas`. Choose **Edit** and change
   title, time/yield and steps before saving. Original input retains the
   fixture's extracted JSON structure. Reimporting the fixture still warns about
   duplicates.
7. From Text, choose **Extract with AI** for any synthetic Recipe text. From
   Image, upload `/private/tmp/qm-233-review/recipe.png`. Both use synthetic
   provider results and the same overview with optional Edit. Text source keeps
   your pasted input; image source keeps the extracted structure, not image
   bytes.
8. Inspect `/resources/export-recipes` and `/resources/export-all-data` while
   signed in: Recipes add `rawText`. Automated authenticated tests also restore
   both formats into fresh households, accept old exports without that field,
   and verify anonymous shared display omits source while authenticated **Save
   to my Recipes** includes it.
9. Try **Import Another**. Cancelling the confirmation keeps the review;
   confirming starts a new import. Use phone and desktop widths.

## Evidence and limits

- Initial implementation: full Vitest run passed 1,399 tests in 114 files.
- Overview revision: 31 affected Vitest tests in four files pass. Build,
  TypeScript, lint and formatting/diff checks pass; lint retains four existing
  warnings. Three production-build Playwright journeys pass: direct overview
  save and correction of incomplete extraction; edit/overview switching,
  validation and connection failure, exact source, save/reload and duplicate
  in-flight clicks; and existing Recipe CRUD.
- Production-card correction: build/typecheck/lint pass and the three browser
  journeys pass again. Desktop/phone visual inspection covers the long-note
  fixture, compact counts/typography and Import Another cancel/confirm. The
  ingredient row wraps as one text flow so long notes cannot squeeze its name or
  unit into narrow columns.
- Additional Chromium checks cover URL rejection/input retention, all provider
  paths, metadata edits, source fidelity, duplicate warnings, authenticated
  export, phone/desktop layout and zero page errors. External extraction is
  mocked at its boundary; persistence and authentication are real and
  disposable.
- Complete diff reviewed for validation, authorization, failure handling,
  source/sharing/recovery, cache invalidation, regressions and unnecessary
  complexity. Scoped fixes include native JSON save transport, exact source line
  endings, PWA data invalidation and blocking a second create after a confirmed
  save even if navigation fails.
- This covers the active review. Navigation/reload draft recovery belongs to
  #234 and remains unavailable until its dependencies are integrated. Image
  files and complete source webpages are not archived. Mocks do not establish
  live extraction quality or product value.
- Ingredient-heading JSON recovery loss remains separately tracked in #257. The
  broad mobile test's existing Staples failure remains under #223.

PR #260 is updated under Alex's existing approval. This revision restores the
readable overview with optional Edit and moves retained source into editing.
Merge/deployment needs separate approval.
