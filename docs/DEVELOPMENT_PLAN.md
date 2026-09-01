# Development plan

## Where things stand

Quartermaster is a daily-used personal app. The core loop works:

```text
save Recipes → plan Meals → generate Shopping → cook
```

Roadmap [#98](https://github.com/the-artifabrian/quartermaster/issues/98) is in
progress. Menus, ordered Meals, combined Shopping, household Staples/Out, honest
Recipe time/yield, and manual Recipe classification and filtering are shipped.
AI quantity planning was tried and removed because it added more friction than
value. Romanian/RON costing was tested on fixed examples and stopped because
useful coverage required too much identity and price-catalogue work.

#126 is the normal-use human checkpoint for the Recipe metadata foundation; it
does not block #137, the next implementation ticket. Archived Pantry cleanup
(#120) and product costing (#133–#136) are deferred.

## Product direction

Quartermaster should be a tight daily driver, not a kitchen-management system. A
feature should reduce setup, clarify Shopping, or help once a Recipe has been
chosen. If it adds recurring maintenance or visible complexity without regular
value, simplify or remove it.

Current product rules:

- Keep single-Recipe cooking fast.
- Menus are reusable; planned Meals are stable snapshots.
- Shopping changes only after an explicit action.
- Staples/Out is a small household availability model, not exact stock.
- Recipe cards stay minimal. Recently Updated is the real default; availability
  belongs on Recipe detail.
- Keep manual paths complete. AI may propose or extract, never silently decide.
- Prefer flat lists, few controls, and no category grouping in Shopping.

## How roadmap work runs

- One focused, reversible ticket per branch and PR.
- GitHub dependency links represent real implementation or data prerequisites.
- Observation issues collect normal-use feedback without blocking unrelated work
  or requiring a formal verdict.
- Record real use honestly. Tests and demos are implementation evidence, not
  dogfooding.
- Rehearse risky migrations on a disposable copy and preserve export/restore
  paths.
- Because merging to `master` deploys, ask Alex before merging or otherwise
  deploying. Branch pushes and PRs are normal when implementation is requested.

## Next tracks

1. **Recipe metadata and discovery (#121–#130).** Honest nullable time/yield and
   the small Cuisine/Season/Course vocabulary are shipped. #126 collects normal
   use before any decision on reviewed metadata proposals or discovery sections.
2. **Costing (#131–#136).** The reproducible Romanian/RON spike produced honest
   partial totals but only 12/22 required-line coverage for the Levantine Menu.
   #133–#136 are deferred; revisit only with reliable regional prices and
   durable ingredient identity, or repeated real demand that earns the upkeep.
3. **Preparation (#137–#141).** The transient checklist experiment repeated
   Recipe steps without producing trustworthy timing or useful coordination. It
   did not justify its complexity and was removed. Do not pursue persistence or
   timer follow-ups without new evidence that the workflow beats handwriting.
4. **Final copy sweep (#142).** Align public and in-app copy with whatever
   actually shipped.

These tracks may move independently when their real dependencies are closed.
Normal use can still lead to later fixes, cuts, or deferrals.

## Known debt and deliberate leftovers

- Archived `InventoryItem` data and compatibility paths remain for Staples
  recovery. Remove them only when their maintenance cost is real.
- Ingredient matching still has legacy fuzzy behavior. #144 is a possible
  durable-link replacement, not current work.
- `emitHouseholdEvent()` is fire-and-forget; revisit if real contention appears.
- Some AI Recipe helpers remain optional and secondary. AI Recipe import is the
  proven high-value path.
- Full Playwright is not a CI release gate; focused browser checks are useful
  when interaction itself is the risk.

Operational restore steps live in [RESTORE.md](./RESTORE.md). Product terms live
in [CONTEXT.md](../CONTEXT.md).

_Updated 1 September 2026._
