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
    ├── HouseholdIngredient (Staples)
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
    │ Staple matches omitted; everything else kept
    ▼
Shopping rows + optional MealShoppingContribution provenance
```

Unresolved names and incompatible units remain visible instead of being guessed
into a total. Manual Shopping rows are first-class and are not removed by
Staples logic.

A Meal contribution stores current generated provenance, not event history.
Refreshing one Meal replaces only that Meal’s contribution and preserves manual
rows, other Meals, and compatible checked state.

Shopping checks submit an explicit state and the observed purchase version.
SQLite triggers advance that version for row and Meal-contribution changes, so
checking cannot silently cover demand added after the shopper saw it. One latest
request ID permits safe checkbox retries without an operation history. The open
page reconciles uncertain writes before replay and excludes pending checks from
Clear checked; it does not retain an offline queue. JSON recovery creates fresh
write identities while preserving purchase data. Table-rebuild migrations must
retain the version triggers.

## Staples

`HouseholdIngredient` is the household availability model, and the only one. A
row has a stable canonical key plus `isStaple`; there is no per-Staple state
(#289). Staples are a quick-add list of usual items: tapping one on the Staples
screen, or picking it in Shopping's From Staples popover, puts it on Next shop
through `resolveNextShopRestockTarget`.

`annotateShoppingDemand` is the one seam that reads them, and it answers one
question: does this demand line match a Staple? A match is dropped from
generated demand, so adding a whole Meal omits it and the Plan picker offers it
unticked. Nothing else consults availability — Recipe cards and Recipe detail
show what a Recipe needs, not what the household has.

The plain-basics heuristic (`isStapleIngredient`: water, salt, pepper, plain
oils) is deliberately separate from saved Staples. It supplies the Plan picker's
unticked defaults only; it never removes a line on its own.

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
readable overview with optional editing, saved only after an explicit action.
The original input or available extraction is retained in `Recipe.rawText`;
reviewed saves do not run extraction or charge AI usage again. Recipe
enhancement returns suggested description and time estimates that the user
chooses whether to apply. Provider errors normalize to safe UI errors.

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

Which layer to test in, and how, is in [AGENTS.md](../AGENTS.md#testing). Vitest
runs pure logic and authenticated loader/action behavior against real test
SQLite databases. Playwright runs user flows against a production build.
Migration tests execute shipped SQL when data conversion itself is the risk.

A test file opts into the setup it needs: `import '#tests/setup/db-setup.ts'`
for a freshly seeded database before each test,
`import '#tests/setup/mocks-setup.ts'` for the MSW handlers, and the
`@vitest-environment jsdom` docblock for a DOM. Files needing none of those pay
for none of them, and a query or an outbound request made without the matching
import fails with an error naming it. Worker databases live under a directory
unique to each run, so concurrent runs cannot overwrite or clean up one
another's files.

Playwright runs on every pull request and uploads its HTML report. It is not yet
a required check, and deploys do not wait for it. Browser checks and simulations
are implementation evidence, not substitutes for normal use.

_Updated 24 September 2026._
