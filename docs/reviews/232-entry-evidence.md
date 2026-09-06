# #232 implementation evidence

Branch: `feat/232-ingredients-first`, based on `aae1eec` (merged PR #264), which
also includes merged Menu-scale PR #266. PR #264 merged during this work; all
its required checks passed. Scope and dependencies come from
[#232](https://github.com/the-artifabrian/quartermaster/issues/232) and roadmap
[#249](https://github.com/the-artifabrian/quartermaster/issues/249). #232 and
#237 are open and have no native blockers; #232 was chosen as the bounded,
accepted manual-form hierarchy improvement. Existing branches/worktrees are
preserved. #252 still awaits a decision, #242 gates dependent purchase changes,
#254 is deferred, and #263 remains a proposal.

## Accepted before/after

Before: Photo and an expanded Details section, including an optional-field
completeness count, preceded ingredients. On a blank phone form this put the
first ingredient well below the opening view.

After: Title, Ingredients (with optional yield), and Instructions lead the same
form. Photo, Details, and Classification follow as existing collapsed sections.
All controls stay mounted, so closing a section retains its values for
submission. The completeness count is removed. Invalid collapsed scalar fields
open before Conform focuses the first error.

This removes scrolling past optional metadata before entering food. Editing an
optional detail requires opening its existing section. There is no new step,
review screen, draft state, or persistence model. Existing action labels, row
editors, type styles, image upload, Import presentation, and Recipe cooking
remain intact. This is the issue's accepted hierarchy, not evidence of recurring
value.

## Reproduce the preview

Prepared checkout and database:

```sh
cd /private/tmp/quartermaster-232
sh /private/tmp/qm-232-review/start.sh
```

Open http://localhost:9232/recipes/new; sign in with `entryreview` /
`local-entry-232`. `/recipes/entry-review-pasta/edit` contains a synthetic
populated Recipe with long ingredient notes and optional values.

To recreate from this branch, choose a new empty scratch directory:

```sh
bun install
cp .env.example .env
export DATABASE_URL=file:/tmp/qm-232-fresh/data.db
export DATABASE_PATH=/tmp/qm-232-fresh/data.db
export DATA_VOLUME_PATH=/tmp/qm-232-fresh
mkdir -p "$DATA_VOLUME_PATH"
bunx prisma generate
bunx prisma migrate deploy
bun scripts/reviews/232-fixture.ts
bun run build
PORT=9232 bun run start:mocks
```

The fixture refuses a database containing users. It creates only synthetic data.
External services, including image storage, are mocked. No household data or
live provider credentials are needed.

## Verification

- 30 focused Vitest tests: manual form and hidden-error focus, ingredient and
  instruction editors, authenticated Recipe actions, time/yield, classification.
- Existing production-build Chromium Recipe CRUD and phone/desktop
  classification journeys pass.
- Additional production-build checks at 390px and 1280px cover minimal creation,
  keyboard navigation from title to ingredient, keyboard section opening,
  invalid Source URL recovery from closed Details, photo attachment with Photo
  closed on submit, supplied optional fields and classification, title-only edit
  with all secondary sections closed, and reopen. Real disposable SQLite
  comparisons verify the optional values, image reference, ingredient notes and
  row order.
- Ingredient and instruction drag reordering is exercised through save at both
  widths; the fixture is returned to its original order.
- Identical blank/populated phone/desktop before/after forms inspected. The
  first blank-form ingredient is at y=376–416 on the 390×844 phone viewport.
  Long notes remain editable in the existing expanded row. No horizontal
  overflow or page errors in the additional journeys.
- Build, TypeScript, lint, formatting and diff checks pass. Lint has four
  existing warnings in unrelated files.
- Complete diff reviewed for preserved fields/submission, validation, focus,
  image behavior, ordering, and unnecessary presentation changes. No server
  action, schema, import editor, or cooking-surface changes belong to this
  issue.

Commands and local artifacts:

```sh
bun run test --run app/components/recipe-form.test.tsx app/components/ingredient-fields.test.tsx app/components/instruction-fields.test.tsx app/routes/recipes/recipe-actions.test.ts app/routes/recipes/recipe-time-yield.test.ts app/routes/recipes/recipe-classification.test.ts
bun run build
bun run typecheck
bun run lint
DATABASE_URL=file:/private/tmp/qm-232-review/data.db PORT=9232 bunx playwright test tests/e2e/recipes.test.ts --grep 'Recipe CRUD flow|Recipe classification edits' --workers=1 --reporter=line
```

Screenshots and additional browser scripts/logs are in
`/private/tmp/qm-232-review/`. `9231-*` screenshots show the prior form from the
main checkout's existing build; `9232-*` show this change with identical data.
Full Playwright and physical iPhone/VoiceOver testing were not run. Browser
inspection is implementation evidence, not dogfooding.

PR opening awaits explicit approval under `docs/DEVELOPMENT_PLAN.md`: “Wait for
Alex's explicit approval before opening a PR.” No PR, merge, or deployment is
authorized by this local handoff.
