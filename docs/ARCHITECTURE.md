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
  `/recipes/*` page in its error boundary and has no loader, since each child
  signs the request in itself; a folder without a layout, such as `_auth/`, is
  organisation only and its files are siblings under root.
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
  named `haptic`, `theme`, `refresh` and `launch`; the shell talks back by
  dispatching a `qm:refresh` event on pull to refresh and by injecting launch
  timestamps and the screen's insets at document start. The Web side is
  `app/utils/shell-bridge.ts`, which checks that a handler exists before each
  call so the same code runs in Safari and the Home Screen install. The Swift
  side is `ios/Quartermaster/Quartermaster/ShellBridge.swift`.
- **Contract.** The "Shell bridge" section of [the iOS README](../ios/README.md)
  is the contract: message names, bodies and what the shell does with each.
  Change it there first, then both sides. Shell behaviour reaches users only
  through a TestFlight build, so the Web side must keep working against the
  previous shell.

### Recipe photos

Photos are stored in object storage (Tigris) under
`users/<userId>/recipes/<recipeId>/images/<file>`, and
`app/utils/storage.server.ts` writes every key. The file name is a timestamp, an
id and an extension taken from the upload's checked type, never the browser's
file name. A copy for a shared Recipe gets a new name of the same shape.

Pages show them through `/resources/images`, which resizes with openimg and
caches each resize on disk. Share pages and link previews use it too, so it has
no login, and `app/utils/image-route.ts` sets what it accepts:

- **Keys.** Only keys of the shape above. Anything else gets a 400 before
  storage or the disk is touched.
- **Sizes.** Only the sizes the pages ask for: each `<Img>` size in `IMG_SIZES`,
  its srcset widths, and the 1200×630 share image. Components take their width
  and height from `IMG_SIZES`, so the page and the route use one list. An
  unlisted size gets the next listed size up instead of an error, so a page
  cached before a size changed still shows its photo. No size at all serves the
  original, which the data export links to.
- **Formats.** AVIF, WebP, or the original format. `fit` is `cover` or left
  out. Both mean the same crop, so they share one cached copy. A format needs a
  size: no page asks for a full-size AVIF or WebP.

Per photo that is at most 21 resizes no larger than 1200×630, plus one
full-size copy in the original format. Uploads are capped at 3 MB.

The cache is `/data/images` in production, on the same volume as SQLite. It
stays bounded in two ways. Deleting a photo also deletes its cached resizes,
because the route answers from the cache before it asks storage. And the hourly
maintenance in `server/scheduled-maintenance.ts` deletes the oldest resizes when
the cache passes 100 MB. It skips files written in the last ten minutes and
never removes folders, so a resize being written isn't pulled out from under
openimg. A folder or file it isn't allowed to read or delete is skipped and
counted in the log line. A pruned resize is made again on its next view.

Two gaps are known and accepted. A resize that is already being made when its
photo is deleted can land in the cache after the delete has cleared it, and
then stays until the prune removes it. And a browser or the service worker
that already holds a deleted photo keeps showing it from its own cache.

## Data model

Most user data belongs to a Household, not an individual User.

```text
User
├── auth: Password, Session, Passkey, Connection, Verification
├── access: Role, Permission, Subscription
└── HouseholdMember → Household
    ├── Recipe → Ingredient, Instruction, RecipeImage
    ├── RecipeMetadataValue (Cuisine, Season, Course)
    │   └── RecipeMetadataAssignment ← Recipe
    ├── Menu → MenuSection → MenuItem → MenuShoppingLine
    ├── MealPlan → Meal
    │   ├── MealSection
    │   ├── MealRecipeItem
    │   ├── MealNoteItem → MealShoppingLine
    │   └── MealShoppingContribution → ShoppingListItem
    ├── HouseholdIngredient (Staples)
    ├── ShoppingList → ShoppingListItem
    ├── HouseholdInvite
    └── HouseholdEvent
```

A Meal's Recipe items and note items each point at an optional MealSection, so
deleting a section keeps its items. A RecipeMetadataAssignment joins one Recipe
to one household classification value. A Shopping row's `horizon` puts it in
Next shop or Later.

`UsageEvent` records AI limits: one row per use of a paid AI feature, counted
and written in one write transaction (`claimAiUsage`). A voice row covers the
Whisper call and the parse that follows it. A row is deleted again when the
call fails in a way the user can't cause, such as a provider outage.

New household data must be authorized by household membership, included in
export/import when durable, and handled in sole-member household moves.

Recipes, the Shopping list and invites also point at the User who made them, and
those keys cascade on user delete. `deleteAccount` in
`app/utils/account-deletion.server.ts` hands them to another member first (an
owner, else the longest-standing member) and promotes that member when the
Household would have no owner, so a deleted member's data stays with the
Household. Only a sole member's deletion removes the Household. New data owned
by a User and a Household needs the same handover.

An interactive transaction that reads, or decides what to write, before its
first write runs through `writeTransaction` in
`app/utils/write-transaction.server.ts`. Its first statement takes SQLite's
write lock, so a write from another process (the e2e tests' own Prisma client,
or an ops script over `fly ssh`) makes it wait out the busy timeout instead of
failing at its first write. Within the app's one process the libsql adapter
already runs one transaction at a time. A transaction whose first SQL statement
writes, and an array `$transaction([...])` that starts with a write, need
nothing. An `upsert` may run a SELECT first, so it doesn't count as a write.

libSQL runs each interactive transaction on a native connection of its own and
never closes it, and Prisma keeps its last 100 closed transactions, so those
connections and their page caches would stay in memory. `createPrismaClient` in
`app/utils/db.server.ts` wraps the adapter so that a transaction lets go of its
connection when it ends, and the next garbage collection frees it.

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

Amounts are saved as written, and `parseAmount()` in `app/utils/fractions.ts` is
the one place that gives them a number. Anything that scales, sums, converts or
counts an amount asks it. It reads the whole string or nothing: a fraction, a
mixed number, a decimal with a dot or a comma (“1,5”), or thousands that can't
be anything else (“1,000,000”, “1,000.5”). An amount it can't read as exactly
one number stays as written and is never summed or scaled. That covers “2
large” and a pack size like “2 x 400”. It also covers one to three digits, a
single comma or dot, then three digits: a Romanian scale writes 1.25 kg as
“1,250”, and “1.000” is one thousand in Romanian but one in English. Ranges
such as “1,5–2” scale end by end and never sum; a range with an end like that,
or with its low end above its high end, stays as written. The import, paste,
voice and Shopping quick-add parsers only find where an amount starts and ends,
and they never split a number at its comma.

The paste, JSON-LD and ingredient parsers read text as long as a whole paste or
a JSON-LD field, so their patterns must stay linear. Ingredient lines are cut at
`MAX_INGREDIENT_LINE_LENGTH` once links are reduced to their text, and a cut
line makes the import report Ingredients as shortened.
`app/utils/recipe-parsing-time.test.ts` checks that parsing time grows linearly
with the input for the patterns that can backtrack on it. Inside one ingredient
line it grows the line below the cap, and it skips the parts of the paren
patterns that only ever see text already matched up to the end of the line.

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

**Rate limits.** Express limits requests per client address before React Router
sees them, and nothing a client sends can choose its own bucket.
`app/utils/client-address.server.ts` picks the address. Production traffic comes
through Cloudflare, then Fly, so Fly's `fly-client-ip` is usually a Cloudflare
edge. The visitor's own address, in `cf-connecting-ip`, counts only when the
request carries our edge secret in `x-qm-edge` (see Deployment and recovery).
The connecting address alone can't show that a request came through our zone.
Without the secret the key is `fly-client-ip`. `req.ip`, which comes from
`X-Forwarded-For`, is used only when no `fly-client-ip` arrives at all, as in
local runs; an unreadable one goes to a single shared bucket. IPv4-mapped
addresses count as IPv4, and IPv6 addresses count per /64.

`server/rate-limit.ts` picks the limit from the path as the router resolves it
(decoded, any case, dot segments resolved, `.data` dropped). Sign-in, sign-out,
sign-up, codes, passkeys, Household invites, account settings and admin allow 10
non-GET requests a minute. The paid AI routes (Recipe import, enhance,
transcribe) allow 20 in their own bucket, other non-GET requests 100, and
GETs 1000. Tests check that every listed path is a real route, and that every
action under `_auth`, every other action that checks a password or code, takes
an invite or sends an email, and every route that reaches a paid AI helper is on
a strict tier.

**Logs and analytics.** `redactUrl` in `app/utils/redact-url.ts` replaces the
values of `code`, `token`, `target`, `session_id`, `otp`, `state` and similar
query parameters, including inside `redirectTo`. These go through it:

- the request log and the `server_error` event;
- in the browser, every URL in a PostHog event's properties, the links
  autocapture records, URLs in error messages, the network requests and page
  addresses recorded for replays.

Replay page content is not redacted. Log a user id, never an email address or
token.

## Keeping loader data fresh

Four layers can answer a navigation with data the server did not just produce.
Each has one owner and one invalidation trigger.

| Layer                        | Owner                                                                   | Serves                                                                                                                  | Dropped by                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-memory loader cache       | `app/utils/loader-cache.ts`, used by each route's `clientLoader`        | The last data for a URL visited this session, on Plan, Shopping, Recipes, Staples and Recipe                            | Any non-GET submission, when it starts and when it ends; a change of user or Household; a page reload                                                 |
| Service worker `.data` cache | `public/sw.js`, driven by `app/components/service-worker-data-sync.tsx` | The same five routes' `.data` responses when the network fails or has not answered in 4 s, keyed per user and Household | `qm-data-invalidate` after any mutation except a Shopping one; `qm-data-purge` on logout; a new deploy's cache version                                |
| Root loader skipped          | `shouldRevalidate` in `app/root.tsx`                                    | Header, user, tier and theme from the previous page                                                                     | Any navigation the router marks for revalidation, except same-page search changes and links that opt out (the bottom tabs); a pending toast forces it |
| Route loader skipped         | A route's own `shouldRevalidate`, such as Plan's day picker             | The route's current data when only view-only search params changed                                                      | Everything else: the route runs its loader                                                                                                            |

The stale-while-revalidate routes show the cached entry at once, then
`useStaleRevalidate` (`app/utils/use-stale-revalidate.ts`) revalidates once
behind it. A load of the URL the page is already on, whoever started it, always
goes to the server, so a revalidation never reads its own cache.

How a change reaches other screens:

- **A mutation in this tab.** The submission clears the in-memory cache as it
  starts and again as it ends, and posts `qm-data-invalidate` when it ends. The
  next navigation to any screen reads the server. The action's redirect is never
  answered from memory. So if the Plan looks stale after a Recipe edit, the edit
  was not a Router submission: a native `fetch` must call
  `invalidateServiceWorkerData()` itself.
- **A change by another household member.** Shopping mutations and Plan actions
  that touch the list write a `HouseholdEvent` row and publish it; the event
  types are in `app/utils/household-events.server.ts`. Every open client holds
  one `EventSource` on `/resources/household-events`
  (`app/utils/household-event-source.client.tsx`), polls every 30 seconds to
  cover reconnects, and drops its own events by client id. The server sends a
  `keepalive` event every 30 seconds; a stream that shows nothing for 75 seconds
  (a half-open cellular socket fires no error) is closed and reopened the way an
  error is, with polling in between. Subscribers decide what to do: Shopping
  revalidates after a 500 ms debounce, the tab bar shows a dot, and the root
  toasts a batched summary. Edits to Recipes, Meals and Staples themselves emit
  no event today, so another member sees them on their next navigation or pull
  to refresh. This is refresh signalling, not collaborative editing.
- **An app relaunch.** Memory starts empty, so the first visit to each screen
  hits the network. The service worker answers that request from its `.data`
  cache only if the network fails or has not answered in 4 seconds (the late
  response still refreshes the cache). After any mutation the 4 second fallback
  pauses until fresh `.data` arrives, so the revalidation behind an action never
  shows pre-mutation data; a failed network still falls back. And a document
  navigation gets the cached app shell only offline. Nothing cached outlives a
  deploy: the cache names carry the build's version and old generations are
  reaped on activate.

Why the rules are shaped this way:

- Shopping mutations skip `qm-data-invalidate` because the next Shopping read is
  network-first anyway (the worker's mutation pause covers a slow one), and
  clearing the namespace on every tick would evict the offline fallbacks of
  unrelated screens.
- Root is skipped for same-page search changes and tab switches because its data
  (user, tier, theme) does not depend on them, and single fetch would otherwise
  re-run it on every page-to-page navigation, back and forward included. Back
  and forward still wait on one root request.
- The `.data` cache is per user and Household so a shared device never shows one
  Household's data to another; until the client has sent its namespace the
  worker is network-only. A worker the browser restarted mid-session asks the
  requesting page for its namespace when a request fails, and serves only that
  namespace's cache.
- Offline, root's `shouldRevalidate` skips the root loader, which has no offline
  copy and whose failure would replace the whole app; a pending toast waits in
  its cookie. The refresh behind a remembered page waits for the `online` event.
  A tab whose data the worker lacks shows an offline notice from its own error
  boundary, inside the app, so the tab bar stays; it retries by itself once the
  network is back.

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
- Production requires the `APP_ORIGIN` secret (`https://useqm.app`).
  `app/utils/env.server.ts` checks it with the rest of the environment before
  migrations run. Outside production it defaults to `http://localhost:$PORT`.
  Every absolute URL the app hands out comes from it, through `getAppOrigin()`
  in `app/utils/app-origin.server.ts`, and none comes from the request, whose
  `Host` and `X-Forwarded-*` headers the client controls. It is used for:
  - emailed verification links (signup, password reset, change email);
  - robots.txt and the sitemap;
  - OG and JSON-LD URLs and share links, through the root loader's
    `requestInfo.origin`;
  - the Household invite link;
  - the TOTP issuer shown in authenticator apps;
  - the passkey relying party ID and origin;
  - Stripe checkout and portal return URLs;
  - the HTTP→HTTPS redirect, and the 301 from `www.` plus its host to it
    (`server/https-redirect.ts`). Only GET and HEAD move, other hosts such as
    fly.dev don't, and the healthcheck never does;
  - the referrer check that picks the page to return to after Google login.

  Redirects within the site stay relative, so the browser keeps the host it used
  (a LAN IP in dev, or the fly.dev host) and its cookies.

- Set `APP_ORIGIN` as an unstaged Fly secret before the first deploy that
  requires it, and confirm it reached the machine with `fly ssh console -C env`.
- A Cloudflare Transform Rule (Modify Request Header) sets `x-qm-edge` on every
  request to the zone, as a static value that overwrites anything a client sent.
  The same value is the unstaged Fly secret `CF_EDGE_SECRET`. Both are in place.
  To rotate, change the rule and the secret together. If the secret is missing,
  the server warns at boot and rate limits key on `fly-client-ip`.

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

Playwright runs on every pull request and uploads its HTML report. It is a
required check for merging, and deploys do not wait for it. CI sets
`BOTTOM_NAV_FEEDBACK_TRACE_ONLY=1`, so the 34 ms bottom-nav feedback budget is
logged there and asserted only in local runs. Browser checks and simulations are
implementation evidence, not substitutes for normal use.

Playwright gives its server a made-up `ANTHROPIC_API_KEY`, which wins over the
one in `.env`, so a local run never reaches the real API. Requests carrying it
get canned answers from `tests/mocks/anthropic.ts`: a Recipe whose title counts
the images sent, or nothing found when the Household has a metadata value named
`E2E_UNREADABLE_MARKER`.

`page.waitForFunction` does not await an async predicate: it resolves with the
first result, even `false`. To wait on async page state such as Cache Storage,
use `expect.poll(() => page.evaluate(async () => …))`.

_Updated 20 November 2026._
