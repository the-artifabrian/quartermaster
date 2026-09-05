# Development plan

## Where things stand

Quartermaster is a daily-used personal app. The core loop works:

```text
save Recipes → plan Meals → generate Shopping → cook
```

Roadmap [#98](https://github.com/the-artifabrian/quartermaster/issues/98) is
complete. It shipped Menus, ordered Meals, combined Shopping, household
Staples/Out, honest Recipe time/yield, and manual Recipe classification and
filtering. AI quantity planning and the preparation checklist were tried and
removed because they added more friction than value. Romanian/RON costing was
tested on fixed examples and stopped because useful coverage required too much
identity and price-catalogue work.

#250 and #126 remain normal-use observation logs, not implementation gates.
Archived Pantry cleanup (#120), reviewed metadata suggestions (#127), discovery
sections (#129), product costing (#133–#136), and durable ingredient links
(#144) are deferred until real use gives them a reason to return. Their unused
observation tickets (#128 and #130) are closed.

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

## Roadmap outcomes

1. **Menus, Meals, and combined Shopping (#99–#114).** Menus and ordered Meals
   shipped with stable snapshots and explicit Shopping contributions. AI
   quantity planning was removed after normal use showed that reviewing its
   output was harder than adjusting the stored multiplier directly.
2. **Staples (#115–#120).** Household Staples/Out replaced active Pantry
   behavior. Archived Pantry rows remain recoverable; #250 collects normal-use
   notes and #120 cleanup is deferred.
3. **Recipe metadata and discovery (#121–#130).** Honest nullable time/yield and
   the small Cuisine/Season/Course vocabulary shipped. #126 collects normal-use
   notes. Reviewed metadata suggestions and discovery sections did not earn
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

_Updated 3 September 2026._
