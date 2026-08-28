# Development plan

## Where things stand

Quartermaster is a daily-used personal app. The core loop works:

```text
save Recipes → plan Meals → generate Shopping → cook
```

Roadmap [#98](https://github.com/the-artifabrian/quartermaster/issues/98) is in
progress. Menus, ordered Meals, combined Shopping, and household Staples/Out are
shipped. AI quantity planning was tried and removed because it added more
friction than value.

The next implementation ticket is #121, the additive Recipe time/yield shape.
Archived Pantry cleanup (#120) is deferred because it is still a cheap rollback
path.

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

1. **Recipe metadata and discovery (#121–#130).** Add honest nullable time and
   yield, a small Cuisine/Season/Course vocabulary, optional reviewed metadata
   proposals, and compact discovery sections.
2. **Costing (#131–#136).** Start with a reproducible Romanian/RON fixture
   spike. Build product UI only if the result is useful without price-catalogue
   chores or false precision.
3. **Preparation (#137–#141).** Start with one transient editable checklist for
   a real hosted Meal. Add persistence only if it beats a handwritten list.
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

_Updated 28 August 2026._
