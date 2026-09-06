# #237 implementation evidence

Branch: `feat/237-cooking-reset`, from current `origin/master` at `920cc28`
(merged PR #267). GitHub
[#237](https://github.com/the-artifabrian/quartermaster/issues/237) and roadmap
[#249](https://github.com/the-artifabrian/quartermaster/issues/249) own the
acceptance criteria. The parent and child records, native sub-issues, #237's
empty blocker list, open PRs, and existing branches/worktrees were checked
before editing. Existing worktrees and the main checkout are preserved.

## Accepted before/after

Before: local ingredient/instruction checks existed, but there was no contextual
reset. Storage was keyed only by Recipe; changing the mounted Recipe could
retain stale in-memory checks and write them under another Recipe's key.

After: More actions offers **Reset cooking checks** only when current checks
exist. It clears this Recipe's checks and persisted record. Reopening restores
checks automatically, scoped by authenticated account, household, and Recipe. No
start screen, extra mode, confirmation dialog, or progress panel is added.

This removes individually unchecking rows for the next cook and reconstructing
progress after navigation. The added work is one contextual action when cooking
again. Local state remains implicit until checks exist. Existing ingredients,
scaling, cooking cues, instruction scrolling, keep-awake, and ingredient sheet
retain their presentation and behavior. Checks/reset do not write Recipe, Meal,
or Shopping data. Planned occurrences deliberately share this Recipe's local
checks; deferred #254 is not activated.

## Storage boundary

- Versioned v2 namespace; old unscoped records are ignored because they cannot
  be assigned safely to an account. Existing old checks therefore start clear.
- Checks store exact canonical row ID/content, so changed or removed rows lose
  their checks while unchanged rows can resume. Viewing scale and unit display
  do not change row identity.
- Context changes clear in-memory checks before children commit, then hydrate.
  Only interactions trigger saves; hydration/pruning preserves the timestamp.
- Seven days since the last check/uncheck, with invalid, future-dated, and
  expired records discarded. Opening/checking prunes the namespace and retains
  at most 50 recently changed Recipe records across this browser's contexts.
- Reset removes the record. Blocked/full browser storage leaves checks/reset
  usable in memory, but cannot guarantee resume or durable reset. No server
  synchronization, cross-device progress, schema, migration, or export change.

## Reproduce the preview

Prepared checkout and synthetic SQLite database:

```sh
cd /private/tmp/quartermaster-237
sh /private/tmp/qm-237-review/start.sh
```

Open http://localhost:9237/recipes/cooking-review-pasta and sign in with
`cookingreview` / `local-cooking-237`. The short handoff contains one task.

For a fresh checkout of this branch, use a new empty scratch directory:

```sh
bun install --frozen-lockfile
cp .env.example .env
export DATABASE_URL=file:/tmp/qm-237-fresh/data.db
export DATABASE_PATH=/tmp/qm-237-fresh/data.db
export DATA_VOLUME_PATH=/tmp/qm-237-fresh
mkdir -p "$DATA_VOLUME_PATH"
bunx prisma generate
bunx prisma migrate deploy
bun scripts/reviews/237-fixture.ts
bun run build
PORT=9237 bun run start:mocks
```

The fixture refuses a database containing users. It creates only a synthetic
household and Walnut pasta Recipe. External services are mocked; no live
provider credentials or household data are used.

## Verification and complete review

- Full Vitest: 115 files, 1,416 tests passed. After final review, three stronger
  exact-expiry boundary cases were added and the affected hook suite rerun.
- Six production-build Chromium journeys pass: phone/desktop resume, linked
  Recipe navigation/back, keyboard reset and focus return, persisted reset,
  same-browser account isolation, household move, edited content, and existing
  cooking cues and floating ingredient-sheet behavior. Real SQLite snapshots
  verify checks/reset leave Recipe, Plan items (including cooked and scale), and
  Shopping unchanged.
- Actual preview login and the short manual journey exercised with the same
  Walnut pasta at 390×844 and 1280×844. Screenshots inspected; no horizontal
  overflow or page errors. Review increased the new reset item's touch target
  from the menu default of 40px to 44px, followed by a rebuild and browser
  recheck.
- Build, TypeScript, lint, formatting, and diff checks pass. Lint has four
  pre-existing warnings in unrelated files. The initial sandboxed full suite
  could not bind sockets in five server tests; the complete run passed with
  local socket access. An initial browser cue assertion used an incomplete text
  match; it was corrected to the existing cue locator and rerun.
- Complete application, tests, fixture, and documentation diff reviewed against
  #237: context ownership, render/hydration/save ordering, expiry, changed
  content, reset scope, failure behavior, ordinary screen presentation, and
  unnecessary complexity. No new unrelated application issue was found.

Commands:

```sh
bun run test --run
bun run test --run app/utils/use-cooking-progress.test.tsx
bun run build
bun run typecheck
bun run lint
DATABASE_URL=file:/private/tmp/qm-237-review/data.db PORT=9237 bunx playwright test tests/e2e/cooking-progress.test.ts tests/e2e/recipes.test.ts --grep 'cooking checks|edited cooking|phone Recipes restore Ingredients|Recipe instructions show passive' --workers=1 --reporter=line
```

Logs, phone/desktop screenshots, and the additional preview inspection script
are in `/private/tmp/qm-237-review/`. Full Playwright, physical
iPhone/VoiceOver, and real cooking were not run; synthetic/browser checks
establish implementation behavior, not recurring user value.

Alex tried the local preview, confirmed it works, and explicitly approved
opening the PR. This satisfies the PR-opening requirement in
[DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md). Merge and deployment still need
separate approval. #252 remains awaiting a decision, #242 still gates
#227/#228/#230, #254 remains deferred, and #263 remains a proposal.

## Preview screenshots

These show the same synthetic phone Recipe before and after the reset action.

[Checks present and reset menu](237-cooking-checks.png) ·
[After reset](237-cooking-cleared.png)
