# Development plan

## Where things stand

Quartermaster is a solo project used daily by its maintainer, built for personal
use and portfolio value. The core loop works:

```text
save Recipes → plan Meals → build Shopping → cook
```

Roadmap [#98](https://github.com/the-artifabrian/quartermaster/issues/98) is
complete. It shipped Menus, ordered Meals, combined Shopping, household Staples,
honest Recipe time/yield, and manual Recipe classification and filtering. AI
quantity planning and the preparation checklist were tried and removed because
they added more friction than value. Romanian/RON costing was tested on fixed
examples and stopped because useful coverage required too much identity and
price-catalogue work.

The formal #126 metadata checkpoint is retired. Current priorities and task
decisions live in
[#249](https://github.com/the-artifabrian/quartermaster/issues/249). Reviewed
metadata suggestions (#127), discovery sections (#129), product costing
(#133–#136), and durable ingredient links (#144) are deferred until real use
gives them a reason to return. Their unused observation tickets (#128 and #130)
are closed.

## Product direction

Quartermaster should stay useful and pleasant for everyday cooking. The normal
path is choosing a Recipe, planning it, then selectively adding ingredients to
Shopping; direct Shopping entry is also common. Full-plan generation is
optional. A feature should remove real work, improve an interaction or deliver a
measurable technical benefit. Portfolio value includes understandable code and
polished behavior. Simplify or remove work whose maintenance and complexity
outweigh its usefulness.

Current product rules:

- Keep single-Recipe cooking fast.
- Menus are reusable; planned Meals are stable snapshots.
- Shopping changes only after an explicit action.
- Staples are a small household availability model, not exact stock.
- Recipe cards stay minimal. Recently Updated is the real default.
- Recipe capture offers Import (URL, text, screenshots) and Write a Recipe.
  Quick Entry and the migration-only text/file bulk importer are retired; JSON
  export/restore remains supported.
- Keep manual paths complete. AI may propose or extract, never silently decide.
- Prefer flat lists, few controls, and no category grouping in Shopping.

## How roadmap work runs

- Use GitHub issues as the source of truth for specs, acceptance criteria,
  progress, review findings and verification. Create, update and close issues as
  the work progresses. Keep local documentation minimal and limited to durable
  project guidance; put task-specific handoffs in the issue.
- Keep only a small next-work selection. Open issues are candidates, not
  delivery commitments; close dormant proposals and choose again after a focused
  change.
- Implement one focused, reversible issue on its own local branch, preserving
  unrelated local work. Run appropriate checks and exercise affected journeys
  with disposable data.
- Thoroughly review the complete diff against the issue's acceptance criteria:
  correctness, regressions, failure handling, and unnecessary complexity. Fix
  worthwhile findings within scope; record unrelated findings separately. Rerun
  affected checks and review the fixes before handing over.
- Provide working local startup/data instructions and one useful ordinary
  journey for Alex to review, with the expected result and material limitations.
  Put detailed automated failure evidence in the issue; do not require manual
  replay of every tested case.
- Wait for Alex's explicit approval before opening a PR. If manual testing finds
  problems, fix and recheck them locally, then provide updated testing steps.
  Continue independent authorized work while waiting.
- Straightforward removals may proceed directly to a PR after thorough review
  and sufficient automated and disposable-data checks, without requiring Alex to
  test locally. Use judgment; this exception does not cover changes that need a
  product or interaction decision.
- Product experiments also require a runnable local comparison and manual
  testing steps. Screenshots may supplement that handoff; they do not establish
  acceptance or authorize a production feature.
- GitHub dependency links represent real implementation or data prerequisites.
- Observation issues collect normal-use feedback without blocking unrelated work
  or requiring a formal verdict.
- Record real use honestly. Tests and demos are implementation evidence, not
  dogfooding.
- Rehearse risky migrations on a disposable copy and preserve export/restore
  paths.
- Because merging to `master` deploys, ask Alex before merging or otherwise
  deploying. Approval to open a PR does not authorize merging or deployment.

## Roadmap outcomes

1. **Menus, Meals, and combined Shopping (#99–#114).** Menus and ordered Meals
   shipped with stable snapshots and explicit Shopping contributions. AI
   quantity planning was removed after normal use showed that reviewing its
   output was harder than adjusting the stored multiplier directly.
2. **Staples (#115–#120, #289).** Household Staples replaced Pantry behavior.
   Real use then showed that maintaining an Available/Out state per Staple was a
   chore that earned nothing once the Plan picker (#288) existed, so #289
   dropped it along with the archived Pantry, the cutover flag and #120's
   deferred cleanup. Staples are now a quick-add list of usual items.
3. **Recipe metadata and discovery (#121–#130).** Honest nullable time/yield and
   the small Cuisine/Season/Course vocabulary shipped. The formal #126
   observation checkpoint is retired; concrete problems can be recorded when
   they arise. Reviewed metadata suggestions and discovery sections did not earn
   implementation and remain deferred; their unused observation tickets are
   closed.
4. **Costing (#131–#136).** The reproducible Romanian/RON spike produced honest
   partial totals but only 12/22 required-line coverage for the Levantine Menu.
   Product work stopped rather than presenting false precision.
5. **Preparation (#137–#141).** The transient checklist repeated Recipe steps
   without trustworthy timing or useful coordination, so it was removed. Saved
   tasks and timer handoff did not proceed.

The final copy sweep in #142 aligned public, in-app, and repository descriptions
with those outcomes. Separate work tracked by #185 improved PWA launch metadata,
authenticated-content safety, navigation preload, updates, and iOS launch
presentation.

## Known debt and deliberate leftovers

- Ingredient matching still has legacy fuzzy behavior. #144 is a possible
  durable-link replacement, not current work.
- `emitHouseholdEvent()` is fire-and-forget; revisit if real contention appears.
- Some AI Recipe helpers remain optional and secondary. AI Recipe import is the
  proven high-value path.
- Playwright runs on every pull request but is not yet a required check or a
  deploy gate.

Operational restore steps live in [RESTORE.md](./RESTORE.md). Product terms live
in [CONTEXT.md](../CONTEXT.md).

_Updated 12 September 2026._
