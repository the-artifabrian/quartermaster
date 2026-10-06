# Architecture

Quartermaster is a household-scoped React Router app backed by SQLite. This
document describes the durable shape and important data flows. Product terms
live in [GLOSSARY.md](../GLOSSARY.md); feature details live in
[FEATURES.md](./FEATURES.md).

## System

```text
Browser / PWA        iOS shell (WKWebView, ios/)
    │                    │  user agent QuartermasterShell/1
    └────────────────────┘  + message bridge
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

### Route files

`app/routes.ts` only calls `react-router-auto-routes`, so the URL map is the
file tree under `app/routes/`. The rules that matter here:

- A folder adds a URL segment, and a dot in a file name does the same:
  `plan/shopping-list.tsx` and `share.$recipeId.tsx` both become two segments.
  `index.tsx` is the folder's own page.
- A `_` prefix on a folder adds no segment. `_auth/login.tsx` is `/login`;
  `_marketing/` and `_seo/` work the same way.
- `_layout.tsx` is the only file that nests. `recipes/_layout.tsx` wraps every
  `/recipes/*` page and runs its loader first; a folder without one, such as
  `_auth/`, is organisation only and its files are siblings under root.
- `$param` is a dynamic segment and `$.tsx` is the catch-all.
- A trailing `_` on a segment is stripped and changes nothing else.
  `recipes/$recipeId_.edit.tsx` is `/recipes/:recipeId/edit`, a sibling of
  `$recipeId.tsx` under the Recipes layout; `$recipeId.edit.tsx` would be the
  same route, since only `_layout.tsx` can be a parent here. The underscore is a
  Remix flat-routes habit (where it kept a page out of its namesake's
  `<Outlet>`); the plugin's `createRoutePath` just drops it.
  `settings/profile/password_.create.tsx` is the same case.
- `[.]` escapes a dot: `_seo/robots[.]txt.ts` is `/robots.txt`.
- `*.server.ts`, `*.client.ts`, `*.test.ts` and anything under a `+` prefix
  (`_marketing/+logos/`) sit next to routes without becoming routes.

When a case is unclear, `bunx react-router routes` prints the compiled tree.

### iOS shell

The iOS app is a small Swift shell whose web view loads the same deployed Web
app ([ADR 0002](adr/0002-small-native-shell.md)). Nothing is bundled; a deploy
reaches the app at once. The two sides meet in three places:

- **Detection.** The shell appends `QuartermasterShell/1` to the user agent.
  `isNativeShell` in `app/utils/native-shell.server.ts` reads it, the root
  loader passes it down, and components ask `useIsNativeShell()` from
  `app/utils/request-info.ts`. Anyone can send the token, so it may only hide
  things or pick safer defaults (Pro and Google sign-in hidden, sessions always
  remembered); it never grants access.
- **Messages.** The page talks to the shell through `WKScriptMessageHandler`s
  named `haptic`, `theme` and `refresh`; the shell talks back by dispatching a
  `qm:refresh` event on pull to refresh and by injecting launch timestamps. The
  Web side is `app/utils/shell-bridge.ts`, which checks that a handler exists
  before each call so the same code runs in Safari and the Home Screen install.
  The Swift side is `ios/Quartermaster/Quartermaster/ShellBridge.swift`.
- **Contract.** The "Shell bridge" section of [the iOS README](../ios/README.md)
  is the contract: message names, bodies and what the shell does with each.
  Change it there first, then both sides. Shell behaviour reaches users only
  through an App Store build, so the Web side must keep working against the
  previous shell.

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
Updating one Meal replaces only that Meal’s contribution with its current
demand, so a deleted Recipe’s lines leave the list. Manual rows, other Meals,
and compatible checked state are preserved.

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

**Sessions.** `app/utils/session.server.ts` is the cookie storage.
`app/utils/auth.server.ts` owns the `Session` rows: a session lasts
`SESSION_EXPIRATION_TIME` (30 days), and `refreshSessionIfNeeded` extends a
remembered one that has under `SESSION_REFRESH_THRESHOLD` (7 days) left. The
"Remember me" box decides whether the cookie carries an `expires`; without one
it is a browser-session cookie and is never extended. The iOS shell always
remembers (`shouldRememberSession` in `app/utils/native-shell.server.ts`),
because WKWebView drops session cookies when iOS kills the app.

**Pro.** `app/utils/subscription.server.ts` is the source of truth:
`getUserTier` reads the Stripe-backed `Subscription` row, `requireProTier`
guards Pro-only loaders and actions (redirecting to `/upgrade`, or a 403 in the
iOS shell per ADR 0001), `requireProTierOrNativeShellNull` does the same for
resource routes a fetcher calls, and `requireUserWithTier` returns the tier
without redirecting for pages that only show or hide Pro features. The client
reads the tier through the hooks in `app/utils/subscription.ts`. To find every
place a user sees Pro, search rather than trust a list:

```sh
grep -rlw Pro app --include='*.tsx'
```

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
SQLite databases. Playwright runs user flows against a production build. A
migration test rehearses a data-converting migration against legacy data before
it ships. Delete the test once production has applied the migration, because the
conversion can never run again. `app/utils/schema-constraints.test.ts` guards
the CHECK constraints and triggers that exist only in migration SQL, since
Prisma would drop them silently if it rebuilt those tables.

A test file opts into the setup it needs: `import '#tests/setup/db-setup.ts'`
for a freshly seeded database before each test,
`import '#tests/setup/mocks-setup.ts'` for the MSW handlers, and the
`@vitest-environment jsdom` docblock for a DOM. Files needing none of those pay
for none of them, and a query or an outbound request made without the matching
import fails with an error naming it. Worker databases live under a directory
unique to each run, so concurrent runs cannot overwrite or clean up one
another's files.

`bun run test:address-pinning` runs the Recipe URL import's pinned fetch under
Bun, which Vitest cannot, against a local HTTPS server with a throwaway CA. The
pinning relies on Bun using `tls.serverName` for SNI, the certificate check and
the keep-alive pool key, so a Bun upgrade must pass it. CI runs it in the lint
job on CI's Bun version, so upgrade that version together with the Dockerfile's.
Only this check may import `unguardedFetchFrom`, which skips the public-address
guard.

The Playwright `login` fixture signs in a user who already has a Household,
created the same way signup creates one, and returns its `householdId`. Seed
test data into that Household. Creating another one for the same user gives them
two memberships, and the app would pick one at random. `insertNewUser` inserts a
user with no Household, which production can't produce; give them one with
`createOwnHousehold` before they sign in through the UI.

Playwright runs on every pull request and uploads its HTML report. It is not yet
a required check, and deploys do not wait for it. Browser checks and simulations
are implementation evidence, not substitutes for normal use.

`page.waitForFunction` does not await an async predicate: it resolves with the
first result, even `false`. To wait on async page state such as Cache Storage,
use `expect.poll(() => page.evaluate(async () => …))`.

_Updated 6 October 2026._
