# Architecture

Quartermaster is a household-scoped React Router app backed by SQLite. This
document describes the durable shape and important data flows. Product terms
live in [CONTEXT.md](../CONTEXT.md); feature details live in
[FEATURES.md](./FEATURES.md).

## System

```text
Browser / PWA
    │
Express → React Router loaders and actions
    ├── Prisma → SQLite → LiteFS
    ├── object storage for Recipe images
    ├── Anthropic for optional Recipe extraction and enhancement
    ├── Groq Whisper for optional speech input
    ├── Stripe for subscriptions
    └── SSE for household refresh events
```

The app runs on Bun in Fly.io. Express owns middleware and hands application
routing to React Router.

## Data model

Most user data belongs to a Household, not an individual User.

```text
User
├── auth: Password, Session, Passkey, Connection, Verification
├── access: Role, Permission, Subscription
└── HouseholdMember → Household
    ├── Recipe → Ingredient, Instruction, RecipeImage
    ├── Menu → MenuSection → MenuItem → MenuShoppingLine
    ├── MealPlan → Meal
    │   ├── MealRecipeItem
    │   ├── MealSection → MealNoteItem → MealShoppingLine
    │   └── MealShoppingContribution
    ├── HouseholdIngredient (Staples/Out)
    ├── InventoryItem (archived Pantry recovery)
    ├── ShoppingList → ShoppingListItem
    ├── HouseholdInvite
    └── HouseholdEvent
```

`UsageEvent` records AI limits. New household data must be authorized by
household membership, included in export/import when durable, and handled in
sole-member household moves.

## Planning

A Recipe is canonical cooking content. A Menu is a reusable arrangement of
Recipe and note cards. Planning a Menu copies its structure into a Meal
snapshot:

```text
Menu + current Recipe titles
        │ explicit Add to Plan
        ▼
Meal + frozen sections/notes/titles/multipliers
        │
        └── Recipe references keep current ingredients and instructions readable
```

Later Menu edits do not change the Meal. Deleted Recipes leave visible missing
cards rather than silently removing part of the Meal. A Meal may also contain
individually added Recipes or plain text.

Meals have explicit order within a day. Labels and serving times are optional
context and do not control order.

## Shopping

Shopping is built in stages:

```text
Meal/Recipe inputs
    │
    ▼
buildShoppingDemand()
    │ scale, omit headings/optional lines, normalize, combine compatible units
    ▼
annotateShoppingDemand()
    │ normal Staples omitted; Out Staples and non-Staples kept
    ▼
Shopping rows + optional MealShoppingContribution provenance
```

Unresolved names and incompatible units remain visible instead of being guessed
into a total. Manual Shopping rows are first-class and are not removed by
Staples logic.

A Meal contribution stores current generated provenance, not event history.
Refreshing one Meal replaces only that Meal’s contribution and preserves manual
rows, other Meals, and compatible checked state.

## Staples and legacy Pantry

`HouseholdIngredient` is the active household availability model. A row has a
stable canonical key plus `isStaple` and `isOut`.

`Household.staplesCutoverAt` chooses the mode:

- Before cutover, the recoverable legacy Pantry behavior applies.
- After cutover, HouseholdIngredient rows are the only availability source.
- Clearing the timestamp explicitly restores legacy behavior.
- Archived `InventoryItem` rows remain stored and exportable until cleanup is
  worth the loss of that rollback path.

Recipe cards do not serialize or show availability. Recipe detail and Shopping
share the Staples/Out interpretation.

## Ingredient parsing and identity

`parseIngredient()` extracts amount, unit, name, and notes from loose Recipe
text. `normalizeIngredientName()` removes safe modifiers, normalizes plurals,
and protects compounds such as “rice vinegar” and protein cuts.

Shopping uses deterministic demand identity and unit-family conversion. Legacy
fuzzy Recipe matching still exists for a few older suggestion/recovery paths. It
is not a claim of exact ingredient identity; #144 may replace its hot paths with
durable, correctable links later.

## Auth and subscriptions

```text
requireUserId(request)
    → requireUserWithHousehold(request)
    → optional requireProTier(request)
```

Authorization happens in loaders/actions, not only in the UI. Pro limits are
feature-specific and degrade without making household data unreadable.

## Real-time refresh

Shopping mutations emit a household event. The server writes a `HouseholdEvent`
row and publishes on a household channel; other active clients refresh through
SSE. Polling covers reconnects. This is refresh signaling, not collaborative
document editing.

## AI

AI calls go through a small schema-validated Anthropic JSON boundary. Prompts
and Zod schemas remain feature-local. Text and image Recipe extraction returns a
review with editable content that is saved only after an explicit action. The
original input or available extraction is retained in `Recipe.rawText`; reviewed
saves do not run extraction or charge AI usage again. Recipe enhancement returns
suggested description and time estimates that the user chooses whether to apply.
Provider errors normalize to safe UI errors.

The manual Recipe, Plan, and Shopping flows do not require API keys. AI quantity
planning was removed after real-use feedback; Recipe import remains the proven
high-value AI path.

## Deployment and recovery

- Production is intentionally a single Fly Machine with one attached volume.
  LiteFS uses a static lease and makes that machine the writable primary without
  depending on Consul. Do not add or clone a Machine with the current config:
  every copy would declare itself the primary.
- Prisma migrations are forward migrations.
- Data-risky changes require a current backup/export and rehearsal on a
  disposable database copy.
- Full JSON import accepts older exports and restores durable household data.
- LiteFS migration details and restore commands live in
  [RESTORE.md](./RESTORE.md).

Before a multi-machine deployment, all of these must be designed, wired, and
tested together:

- elect exactly one writable primary and give replicas a safe way to discover it
  and fail over without stale data winning;
- replay every write on the primary. The LiteFS proxy currently handles normal
  non-GET actions, including admin writes, while the mutating OAuth callback
  explicitly calls `ensurePrimary()`; audit every route rather than assuming
  HTTP method conventions are enough;
- provide read-your-writes consistency after replication-aware writes, either
  with the LiteFS proxy transaction cookie or an equivalent transaction-position
  wait/replay mechanism; and
- exercise failover, OAuth, admin mutations, and an immediate post-write read on
  real replicas before increasing the Machine count.

## Testing

Vitest covers pure logic and authenticated loader/action behavior against real
test SQLite databases. Focused Playwright tests cover interaction-heavy paths.
Migration tests execute shipped SQL when data conversion itself is the risk.

Full Playwright is not a CI release gate. Browser checks and simulations are
implementation evidence, not substitutes for normal use.

_Updated 3 September 2026._
