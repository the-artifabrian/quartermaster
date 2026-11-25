# Architecture

Quartermaster is a household-scoped React Router app backed by SQLite. The first
sections give the shape of the system: how a request travels, the main
decisions, the data model, how the Plan and Shopping fit together, live updates,
and how production runs. The sections after them hold the detail. Product terms
live in [GLOSSARY.md](../GLOSSARY.md), and the guessing bounds and rate limits
in [SECURITY.md](./SECURITY.md).

## System

```text
Browser (Web app)    iOS shell (WKWebView, ios/)
    │                    │  user agent QuartermasterShell/1
    └────────────────────┘  + message bridge
    │
Cloudflare → Fly → LiteFS proxy
    │
Express → React Router loaders and actions
    ├── Prisma → SQLite → LiteFS
    ├── object storage for Recipe images
    ├── Anthropic for optional Recipe extraction and enhancement
    ├── Groq Whisper for optional speech input
    ├── Stripe for subscriptions
    └── SSE for household refresh events (Pro)
```

The app runs on Bun on a single Fly Machine. A request comes through Cloudflare
and Fly to the LiteFS proxy, then to Express (`server/index.ts`). Express
redirects to HTTPS and the canonical host, applies the per-address rate limits
(see [SECURITY.md](./SECURITY.md#rate-limits)) and serves static files. It hands
everything else to React Router, which runs two root middlewares before any
loader or action: the form-body guard (Logs and analytics) and the demo guard
(Demo). Loaders and actions then check the user and their Household themselves
(Auth and subscriptions) and read and write SQLite through Prisma.

The iOS app is a small Swift shell whose web view loads the same deployed Web
app. Nothing is bundled, so a deploy reaches the app at once (iOS shell).

## Main decisions

- **One machine.** SQLite on one Fly Machine is cheap and simple, and a deploy
  restarts the app. Nightly offsite backups and a written restore runbook stand
  in for failover. What a second Machine would need is listed under
  [Deployment and recovery](#deployment-and-recovery).
- **The Household owns the data.** Recipes, Menus, the Plan, Staples and
  Shopping belong to a Household, and everyone in it shares all of it.
- **Planned Meals are snapshots.** Menus stay reusable, and editing one never
  changes a Meal already planned from it.
- **Shopping changes only when someone asks.** Editing a Recipe or a Meal never
  touches the list by itself, and a Meal update never rewrites a row's own typed
  amount.
- **AI reads and suggests, and people decide.** Import transcribes what the
  source gives, enhancement waits for a tap, and every manual path works without
  an API key.
- **A thin iOS shell.** The app loads the Web app instead of carrying its own UI
  ([ADR 0002](adr/0002-small-native-shell.md)), and Pro stays on the web
  ([ADR 0001](adr/0001-keep-pro-out-of-the-ios-app.md)).
- **The demo is a real account.** A visitor gets a user of their own with a copy
  of a sample Household. It runs the same code as any account, with a guard in
  front of the actions a demo can't use.

Some features were tried and taken out. AI quantity planning went because
checking its numbers was harder than setting a Recipe's multiplier by hand. A
preparation checklist went because it repeated the Recipe's steps without timing
anyone could trust. A per-Staple Available/Out state went because keeping it up
was a chore once the From Plan picker existed. Costing Recipes from Romanian
prices stopped at a spike. It priced 12 of the 22 lines a test Menu needed, and
partial totals would have looked more exact than they were. Quick Entry and the
bulk text and file importer were retired in favour of Import; JSON export and
restore stay.

## Data model

Most user data belongs to a Household, not an individual User.

```text
User
├── auth: Password, Session, Passkey, Verification, EmailCode
├── access: Role, Subscription
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

A user reaches Household data through their membership, and the loaders and
actions check it. Recipes, the Shopping list and invites also point at the User
who made them (Households and accounts). A Meal's Recipe items and note items
each point at an optional MealSection, so deleting a section keeps its items. A
RecipeMetadataAssignment joins one Recipe to one household classification value.
A Shopping row's `horizon` puts it in Next shop or Later. `UsageEvent` holds one
row per use of a paid AI feature, for the daily limits described under AI. The
demo's tables are described under Demo.

An interactive transaction that reads, or decides what to write, before its
first write runs through `writeTransaction` in
`app/utils/write-transaction.server.ts`. Its first statement takes SQLite's
write lock, so a write from another process (the e2e tests' own Prisma client,
or an ops script over `fly ssh`) makes it wait out the busy timeout instead of
failing at its first write. Within the app's one process the libsql adapter
already runs one transaction at a time. A transaction whose first SQL statement
writes, and an array `$transaction([...])` that starts with a write, need
nothing. An `upsert` may run a SELECT first, so it doesn't count as a write.

## Plan and Shopping

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

Later Menu edits do not change the Meal. A deleted Recipe leaves a visible
missing card instead of silently removing part of the Meal. A Meal may also hold
Recipes added one by one, or plain text. Meals have an explicit order within a
day. Labels and serving times are optional and don't control the order.

Shopping changes after an explicit action: Add to Shopping or Update Shopping on
a Meal, the From Plan picker, Need on a Staple, the From Staples picker, a line
from a Recipe, or a typed row. The amounts that come from Meals are built in
stages:

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

Unresolved names and incompatible units stay visible instead of being guessed
into a total. Each Meal's share of a row is kept as its contribution, apart from
the row's own typed amount, so updating one Meal replaces only that Meal's share
and leaves manual rows and other Meals alone. A checked row is a purchase, and
new demand never joins it. Staples are a quick-add list of usual items, and a
demand line that matches one is left off. The Planning, Shopping and Staples
sections have the detail.

## Live updates

On Pro, a Shopping change reaches the other phone as it happens. Shopping
actions, and Plan actions that touch the list, write a `HouseholdEvent` row and
publish it on an in-process event bus. Each open Pro client holds one
`EventSource` on `/resources/household-events`. Shopping revalidates, the
Shopping tab shows a dot, and the root shows a summary toast. Sending an event
is fire-and-forget: `emitHouseholdEvent` catches its own errors, so a failed
event never fails the action, and the other phone sees the change on its next
load. Edits to Recipes, Meals and Staples send no event. Events only tell other
clients to refresh; there is no collaborative editing.

A navigation can also be answered from a cache: memory, the service worker, or a
loader the router skipped.
[Keeping loader data fresh](#keeping-loader-data-fresh) says what each one
serves and what clears it.

## Running in production

Production is a single Fly Machine with one attached volume. LiteFS uses a
static lease and makes that machine the writable primary without depending on
Consul. Adding or cloning a Machine with the current config would make every
copy declare itself the primary.

Merging to `master` deploys. At boot, `other/litefs.yml` checks the environment,
dumps the database to the volume, runs the Prisma migrations, which only go
forward, and starts the app. There are three kinds of copy: a daily offsite
snapshot in Tigris, the last three pre-migration dumps on the volume, and Fly's
volume snapshots. [RESTORE.md](./RESTORE.md) has the restore steps and the
reasons for the boot order.

Two watchdogs end a stuck process, and Fly's `on-failure` restart policy starts
it again. `server/memory-watchdog.ts` exits when the machine stays short of
memory, or the process holds too much swap, even after a forced garbage
collection. `server/event-loop-watchdog.ts` runs on a worker thread and kills
the process when the main thread stops making progress. Hourly maintenance
(`server/scheduled-maintenance.ts`) deletes expired demo users, rebuilds the
demo template when its content changed, deletes expired sessions and codes and
old usage and event rows, and prunes the image cache.

[Deployment and recovery](#deployment-and-recovery) has the production
configuration and what a second Machine would need.

## Route files

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
- `[.]` escapes a dot: `_seo/robots[.]txt.ts` is `/robots.txt`.
- `*.server.ts`, `*.client.ts`, `*.test.ts` and anything whose name starts with
  `+` sit next to routes without becoming routes.

When a case is unclear, `bunx react-router routes` prints the compiled tree.

## iOS shell

Why the app is a shell is in [ADR 0002](adr/0002-small-native-shell.md). The
shell and the Web app meet in three places:

- **Detection.** The shell appends `QuartermasterShell/1` to the user agent.
  `isNativeShell` in `app/utils/native-shell.server.ts` reads it, the root
  loader passes it down, and components ask `useIsNativeShell()` from
  `app/utils/request-info.ts`. Anyone can send the token, so it may only hide
  things or pick safer defaults (Pro hidden, sessions always remembered); it
  never grants access.
- **Messages.** The page talks to the shell through `WKScriptMessageHandler`s
  named `haptic`, `theme`, `refresh` and `launch`. The shell talks back with
  events and document-start scripts. Pull to refresh dispatches `qm:refresh`. A
  share from the app's Share Extension goes to the import page through
  `ios/Quartermaster/Quartermaster/ShareIntent.swift`, which sets
  `window.__qmShareImport` and dispatches `qm:share-import`, and
  `takeShareImport` in `app/utils/shell-bridge.ts` reads it. Launch timestamps
  and the screen's insets are set at document start. The Web side is
  `app/utils/shell-bridge.ts`, which checks that a handler exists before each
  call so the same code runs in any browser. The Swift side is
  `ios/Quartermaster/Quartermaster/ShellBridge.swift`.
- **Contract.** The "Shell bridge" section of [the iOS README](../ios/README.md)
  is the contract: message names, bodies and what the shell does with each.
  Shell changes reach phones only through a TestFlight build, so a phone can be
  running an older shell than the site expects.

The apple-app-site-association file claims every path, so on a phone with the
app installed a link in an email, such as a sign-up or password reset link,
opens the app, with the app's own cookies rather than Safari's. A signup or
reset code can instead be typed on the device that asked for it; a change-email
code works only on the device that asked for it. The app is always logged in, so
a reset goes ahead there and logs the app out once the password is set,
whichever account it was logged in as. A signup link asks to log out first and
uses nothing up until then.

## Households and accounts

Every Household keeps an owner. People leave a Household when they join another,
leave it themselves (members only), are removed by the owner, or delete their
account. All of these go through `removeMembership` in
`app/utils/household-membership.server.ts`, inside the same `writeTransaction`
as the reads that decided the move. When others stay, `findHeir` picks the heir:
another owner if there is one, else the member who joined longest ago. If the
heir isn't an owner yet, they become one. When nobody stays, `dissolveHousehold`
deletes the Household. Recipes and the Shopping list would only lose their
Household on its delete (`onDelete: SetNull`), so it deletes them first and
returns their photo keys for removal after the commit.

The keys from Recipes, the Shopping list and invites to the User who made them
cascade on user delete, so `deleteAccount` in
`app/utils/account-deletion.server.ts` hands those rows to the heir first and a
deleted member's data stays with the Household. Only the owner, who makes and
revokes invites, gets the live invite links; the Household page never sends them
to other members.

A Recipe's share link is `/share/<recipe id>`. It works until the Recipe is
deleted and can't be revoked on its own. Saving from it copies the sender's
Recipe as it stands, including the text it was imported from (`rawText`), and
gives the photo its own copy (a demo user's copy points at the source's file,
see Demo). A Menu has a share link too, `/share/menus/<menu id>`, where Save to
my Menus copies the Menu and its Recipes into the reader's Household. Deleting a
Recipe removes its rows before its photo file, and the file only when no other
Recipe shows it.

## Saving edits

Recipe and Menu edits save over rows other members may have changed since the
form loaded. Each form posts every row with its id, plus the ids of the rows it
loaded (`app/utils/loaded-rows.ts`), and the Save runs in one write transaction:

- A row the form posts back keeps its id. Ingredient and step ids are what
  cooking checks are keyed on, and nothing in the schema points at them.
- A Save removes only rows the form loaded and left out. A row added meanwhile
  stays and goes after the saved rows. A Menu card added meanwhile to a section
  the editor removed moves to the end of the first section.
- A row deleted meanwhile that the form still shows is saved again, as a new
  row. A missing Menu card (its Recipe gone) can't be, so it stays removed.
- A new row carries the id the form gave it when it was added. The Save creates
  it with that id if no row has it yet, so a Save that reaches the server twice
  finds its rows the second time instead of adding them again.
- A posted id that belongs to another Recipe's or Menu's row never changes that
  row; the new row gets a fresh id.

Cooking checks live in the browser's `localStorage` for seven days, keyed by
account, Household and Recipe (`app/utils/use-cooking-progress.ts`). A row whose
text, order or heading changed loses its check.

libSQL runs each interactive transaction on a native connection of its own and
never closes it, and Prisma keeps its last 100 closed transactions, so those
connections and their page caches would stay in memory. `createPrismaClient` in
`app/utils/db.server.ts` wraps the adapter so that a transaction lets go of its
connection when it ends, and the next garbage collection frees it.

## Demo

The demo gives a visitor a user of their own, with `demoExpiresAt` set two hours
ahead, on Pro, with a copy of a sample Household. `app/utils/demo.server.ts`
keeps one template Household in the database: the sample Recipes with their
stock photos (`app/assets/demo-photos`, credits in its `CREDITS.md`) and the
Staples, owned by a user with no password and an email under `.invalid`. The
`DemoTemplate` row points at it and holds two hashes, one of the sample Recipes
and Staples and one of the photo files. Scheduled maintenance runs
`ensureDemoTemplate` right after demo expiry, at startup and every hour; when
either hash changed, it builds a new template beside the old one, moves the
pointer in a write transaction, and deletes the old template's owner with
`deleteAccount`.

`createDemoCopy` keeps its transactions short, because the libSQL adapter runs
one at a time per process. One counts live demo users (at most 30) and creates
the visitor. The next re-reads the template and copies its library a statement
per kind of row, and then the sample week is planned for the visitor's day
through the app's own writers. The Plan, Shopping and Menus are made on each
copy from the running code's content. A start that can't get a transaction in
time is refused as unavailable. Copies share the template's photo keys, so the
refcount keeps a photo until no Recipe shows it. `DemoAiUsage` counts AI uses
across all demo users and isn't tied to a user, so it outlives them. In PostHog
a demo user's person and browser events carry `is_demo: true` (a super property,
removed for anyone else on load), as do `demo_started` and a demo user's
`server_error`; real users have no `is_demo` at all.

A root middleware in `app/utils/demo-guard.server.ts` refuses a demo user's POST
(or any method but GET and HEAD) to a route on its blocked list, keyed on the
route pattern, before the action runs: email, username and name, password,
passkeys, two-factor, every Household action and joining by invite, restoring a
JSON backup, Stripe checkout and the billing portal, and admin. A form goes back
to its page with a toast that says it's turned off in the demo; a JSON caller
gets a 403 with the same message. Every other route with an action is on an
allowed list with its reason, and a test fails on a route that is on neither.
Inside allowed routes, a demo user's Recipe photo is dropped without being
checked or stored, with a toast; a Recipe they save from a share page points at
the source's photo instead of storing a copy, reading its key again in the
transaction that writes the copy; Recipes and Menus in a Household with a demo
user or the template's owner are not found on the public share pages; an invite
into a demo Household reads as invalid; and no email goes to an `.invalid`
address. The Upgrade page's return from checkout leaves a demo user's
subscription alone. `aiUsageLimitsFor` gives the three AI call sites their caps:
a demo user gets three uses of each feature, and each use also takes one of the
60 uses all demo users share in a day, counted in `DemoAiUsage` in the same
write transaction.

A POST to `/demo` starts a demo for a signed-out browser and signs it in. Each
client gets five starts an hour, counted in memory under the client key
`server/index.ts` stamps on every request; the route is otherwise on the strong
tier, so starts don't use up sign-in attempts. The Session's `expirationDate` is
the user's `demoExpiresAt`, so `getUserId` ends it on time without waiting for
expiry, and its cookie never has an Expires, in the iOS app too. A copy or
session that fails partway deletes the user it made. The user is deleted at once
by Log Out and by `intent=end` (which the demo banner's Sign up posts), and
otherwise by the first step of scheduled maintenance, which deletes every demo
user whose `demoExpiresAt` has passed, each through `deleteAccount`; one that
fails is logged and reported, and the next run tries again. The admin user lists
leave out demo users and template owners.

A demo user gets a banner in the site header that counts down from the time left
the root loader sends by the server's clock, and an Upgrade page that explains
Pro in place of checkout.

## Planning

A Meal's day is a calendar day, stored as UTC midnight and sent by forms as
`yyyy-MM-dd` (`z.iso.date()`). Which day is today belongs to the user:
`getRequestToday` (`app/utils/today.server.ts`) reads the browser's timezone
hint cookie and returns that zone's date. Each loader that draws Today, past
days or "this week" (Plan, Shopping's From Plan, Add to Plan on a Recipe or
Menu) puts it in its data, and components compare days against it, so the server
and the browser render the same day. Without a hint, on the first request before
the hint check reloads, or with a zone the server doesn't know, today is the UTC
day. Data cached before loaders sent a today uses the browser's own date
(`loadedToday`).

Today is fixed per load: a page left open past midnight, or shown from the
loader or service worker cache, keeps the old day until its next server load.
Plan revalidates behind a cached entry at once. A later today then moves its
selected day, unless the URL picked a day or a Meal or the person is busy (a
sheet open, a navigation or fetcher under way). Add to Plan on a Recipe starts
on today each time it opens. Offline, the old day stays until the network
returns.

## Shopping

Manual Shopping rows are first-class, and Staples never remove them.

A Meal's contribution records what that Meal puts on Shopping now and keeps no
history, so an update drops a deleted Recipe's lines. Update Shopping leaves a
checked row alone. If the Meal's demand on a checked row grew, shrank or went
away, the row and the share stay as they are, nothing is added elsewhere for it,
and the toast says which rows were left. After the row is unchecked, the next
update applies the new amount. Undo of a Meal deleted with its Shopping amounts
puts a share whose row was checked since onto an unchecked row instead. The Meal
writers read the list and write in one `writeTransaction`. Add to Shopping,
Update Shopping and From Plan read the Meal and its demand in it too
(`app/utils/shopping-adds.server.ts`), and a line added from Recipe detail reads
its target row there.

A row typed in Shopping or added from Recipe detail keeps its own amount. Meal
demand that joins it adds to that amount on display. Edit changes only the row's
own amount, and Remove generated amount takes the Meal share off again.

A cooked Recipe item adds no demand on any path. On Update Shopping, amounts it
already put on Shopping stay as they are, checked or not, including an
ingredient it shares with an uncooked item. If its Recipe was deleted, no amount
the Meal has on Shopping is withdrawn or lowered, though larger amounts and new
lines still apply. The rule lives in `loadMealShoppingDemand`.

From Plan opens a picker over a Plan week, and `planPickerLineStatus` in
`app/utils/shopping-plan-picker.ts` decides how each line starts. When this
Meal's amount sits on an unchecked Later row, the line starts unticked, and
ticking it moves the row to Next shop. Otherwise a line whose amount this Meal
already put on Shopping can't be ticked. It shows as on the list, or shows
Shopping's amount when the Meal changed since. A name on the list from somewhere
else starts unticked, and so does a Staple or a plain basic such as salt. Every
other line starts ticked, unless its day is past. A Meal shows as done when
nothing in it is ticked, at least one line is its own amount on the list, and
the rest are that or usually on hand.

A check posts the state the shopper chose and the row's `checkVersion` as they
saw it. SQLite triggers bump that version whenever the row's amount or one of
its Meal contributions changes, so a check can't cover an amount added after the
shopper looked. The row keeps only the id of its latest check
(`lastCheckMutationId`), so a check whose answer was lost can be sent again
safely. Before sending a check again, the open page reads the row from the
server, and Clear checked skips a row whose check is still unconfirmed. Nothing
is queued offline. A JSON restore keeps whether each row was checked and starts
its version and check id afresh. Row Edit and Remove generated amount also send
the version the person saw; the server checks it inside the write transaction
and answers 409 with the row's current state when it moved.

## Staples

`HouseholdIngredient` is the household availability model, and the only one. A
row has a stable canonical key plus `isStaple`; there is no per-Staple state.
Tapping Need on the Staples screen puts one on Next shop through
`resolveNextShopRestockTarget`, which adds a row, moves a Later row up, or
brings back a checked one. Shopping's From Staples picker posts the picked names
to Shopping's `bulk-add` instead. It lets the person pick only Staples whose
name isn't on the list, checked rows included, and adds them to Next shop.

`annotateShoppingDemand` is the one seam that reads them, and it answers one
question: does this demand line match a Staple? A match is dropped from
generated demand, so adding a whole Meal omits it and the Plan picker offers it
unticked. Nothing else consults availability. Recipe cards and Recipe detail
show what a Recipe needs, never what the household has.

The plain-basics heuristic (`isStapleIngredient`: water, salt, pepper, plain
oils) is deliberately separate from saved Staples. It supplies the Plan picker's
unticked defaults only; it never removes a line on its own.

## Ingredient parsing and identity

`parseIngredient()` in `app/utils/ingredient-parser.ts` extracts amount, unit,
name, and notes from loose Recipe text. `normalizeIngredientName()` removes safe
modifiers, normalizes plurals, and protects compounds such as “rice vinegar” and
protein cuts. It lives in `app/utils/recipe-matching.server.ts` with
`getCanonicalIngredientName`, the plain-basics heuristic and the check for
optional lines (`isOptionalIngredient`). Shopping combines demand lines by their
canonical name (a fixed synonym list maps cilantro and coriander to one key) and
unit family, never by a fuzzy match.

Amounts are saved as written, and `parseAmount()` in `app/utils/fractions.ts` is
the one place that gives them a number. Anything that scales, sums, converts or
counts an amount asks it. It reads the whole string or nothing: a fraction, a
mixed number, a decimal with a dot or a comma (“1,5”), or thousands that can't
be anything else (“1,000,000”, “1,000.5”, or with spaces as French sites write
them, “1 000” and “1 000 000”). An amount it can't read as exactly one number
stays as written and is never summed or scaled. That covers “2 large” and a pack
size like “2 x 400”. It also covers one to three digits, a single comma or dot,
then three digits: a Romanian scale writes 1.25 kg as “1,250”, and “1.000” is
one thousand in Romanian but one in English. One group after a space that
doesn't start with 0 is the same: “2 400 g” can be two 400 g tins. Ranges such
as “1,5–2” scale end by end and never sum; a range with an end like that, or
with its low end above its high end, stays as written. Yields go through it too,
so “Makes 1,000 cookies” gives no yield rather than 1, and in “Makes 4 500 ml
jars”, which it can't read, the first number is the yield. The import, paste,
voice and Shopping quick-add parsers only find where an amount starts and ends,
and they never split a number at its comma. The ingredient and quick-add parsers
keep thousands split by spaces together when a unit follows, or when they read
as one number. A container after the unit (“2 400 g tins tomatoes”) makes the
first number a count of tins instead, as it read before. The voice parser never
groups them, since a spoken count before a size is common.

The paste, JSON-LD and ingredient parsers read text as long as a whole paste or
a JSON-LD field, so their patterns must stay linear. Ingredient lines are cut at
`MAX_INGREDIENT_LINE_LENGTH` once links are reduced to their text, and a cut
line makes the import report Ingredients as shortened.
`app/utils/recipe-parsing-time.test.ts` checks that parsing time grows linearly
with the input for the patterns that can backtrack on it, with the helper in
`tests/growth.ts` that the voice parser's and the browser analytics' timing
tests use too. Inside one ingredient line it grows the line below the cap, and
it skips the parts of the paren patterns that only ever see text already matched
up to the end of the line. The browser reads and sends only the first 2,000
characters of an error message when it redacts the URLs in it.

## Auth and subscriptions

```text
requireUserId(request)
    → requireUserWithHousehold(request)
    → optional requireUserWithTier(request)
      or requireProTierOrNativeShellNull(request)
```

Authorization happens in loaders and actions, not only in the UI. Pro limits are
feature-specific, and losing Pro never makes household data unreadable. The
guessing bounds for passwords and codes, and the rate limits behind them, are in
[SECURITY.md](./SECURITY.md).

**Sessions.** `app/utils/session.server.ts` is the cookie storage.
`app/utils/auth.server.ts` owns the `Session` rows: a session lasts
`SESSION_EXPIRATION_TIME` (30 days), and `refreshSessionIfNeeded` extends a
remembered one that has under `SESSION_REFRESH_THRESHOLD` (7 days) left. The
"Remember me" box decides whether the cookie carries an `expires`; without one
it is a browser-session cookie and is never extended. The iOS shell always
remembers (`shouldRememberSession` in `app/utils/native-shell.server.ts`),
because WKWebView drops session cookies when iOS kills the app. A demo session
is the exception to both: it ends with the demo and is never remembered (see
Demo).

Changing the password in Settings signs out every other session of the user and
keeps the current one; a password reset signs out all of them. With 2FA on,
changing the email, turning 2FA off and the Passkeys page ask for a code again
when the session last verified more than two hours ago
(`requireRecentVerification` in `app/routes/_auth/verify.server.ts`). Changing
the email also asks for the current password before any code is sent, as adding
a passkey does. An account with no password is sent to reset it, as below.

A 2FA sign-in waits in the verify cookie for its code. The cookie names a
pending `Session` row, and once that row's `createdAt` is more than 10 minutes
old the server refuses it and deletes the row (`findPendingSignIn` in
`app/routes/_auth/login.server.ts`), so a kept copy of the cookie can't outlast
it. The age comes from the row rather than the cookie because the row is read
anyway and is what gets deleted. The row takes at most
`MAX_PENDING_SIGN_IN_TRIES` codes. Finishing the sign-in moves the session to a
new id, so the pending id stops existing. On a shared browser that pending
sign-in is someone else's business once another person signs in. A sign-in
without 2FA clears it, and so does every way a session ends on the browser
(`endSessionCookies` in `app/utils/auth.server.ts`): logging out, deleting the
account, and a session that has expired or gone. The two-hour check and the
reverify step only count a pending sign-in that belongs to the signed-in user.

Adding a passkey asks for the current password
(`app/routes/_auth/webauthn/registration.ts`). The request for the passkey
options checks it, and only then sets the challenge cookie. That cookie is
signed, names the account and lasts five minutes, and the request that saves the
passkey needs it. Each challenge saves one passkey at most: the server remembers
the ones it has spent, in memory, so a restart forgets them and a cookie from
before it could be used once more within its five minutes. With 2FA on, opening
the Passkeys page follows the two-hour rule, and so does the options request. A
notice goes to the account's email once the passkey is saved.

Every way to make an account sets a password: signup asks for one, and a passkey
can only be added to an account that has one. The exception is an account from
when the app offered Google sign-in that never set a password. It can't log in,
and gets a password from Forgot password, which emails a code first and upserts
the `Password` row (`resetUserPassword` in `app/utils/auth.server.ts`). Settings
sends such an account there too if it somehow holds a session, so nothing sets a
first password without proof.

The browser's passkey list follows the server through the WebAuthn Signal API
(`app/utils/passkeys.ts`), where the browser has it. The Passkeys page sends the
account's full list on load and after a delete, and a sign-in that gets "Passkey
not found" (a 404) tells the browser to forget that passkey. A refused save in
Settings tells the browser nothing: when a save that worked loses its answer and
is sent again, the resend is refused too, and the phone would drop a passkey the
server kept. A passkey left on the device by a real refusal goes with the full
list the next time the Passkeys page loads.

**Emailed codes.** Signup, password reset and email change email a code and a
link (`app/utils/email-code.server.ts`, called through `prepareVerification` in
`app/routes/_auth/verify.server.ts`). A code is 8 characters from
`ABCDEFGHJKLMNPQRSTUVWXYZ123456789`, picked with `crypto.randomInt`. Case
doesn't matter, and the code field drops spaces and dashes from a pasted code.
The link carries a separate 32-byte token rather than the code. The `EmailCode`
table keeps only HMAC-SHA-256 digests of both, keyed with the first
`SESSION_SECRET` and compared with `timingSafeEqual`. Rotating the secret makes
codes in flight stop working. Authenticator codes for 2FA stay in `Verification`
on `@epic-web/totp`. The verify page sends each kind down its own check, so an
emailed type never reaches the TOTP check and `2fa` never reaches the emailed
codes. The guessing bound is in [SECURITY.md](./SECURITY.md#emailed-codes).

Each code works for 10 minutes, or until one of the target's codes is used. A
new request adds a code and leaves the earlier ones alone, so a stranger asking
for codes can't stop the owner using one already in their inbox. Each (type,
target) holds at most 5 live codes. Past that nothing is sent, the
forgot-password answer doesn't change, and nothing a stranger can do ends a live
code early. The cap is checked and a place taken in one write transaction, so a
burst of requests can't overshoot it. The place matches no code until the email
has gone out, and a failed send removes it. If the code can't be marked as sent
after its email went out, its place is removed too and the person is told the
send failed. A reset is keyed by the account's id, whichever of its username or
email was typed, and a signup by the lowercased address.

Forgot-password answers the same way for an account that exists and one that
doesn't, and at about the same speed. Both make one lookup before answering; a
known account's code is made and emailed afterwards, through `runInBackground`
in `app/utils/background.server.ts`. Tests wait for that work with
`backgroundWorkSettled`, and so does graceful shutdown (`server/shutdown.ts`),
for up to 3 of its 4 seconds, alongside the PostHog flush. An event that
background work captures after the flush has started can be lost, and work still
running after 3 seconds is cut off and logged. A send cut off by a deploy this
way can leave its code's place taken, matching no code, until it expires 10
minutes later; the target has one place fewer of its 5 until then.

Using a code finds and deletes its row, then the target's other codes of that
type, in one write transaction. The transaction holds SQLite's write lock from
its first statement, so of two submits of the same code the second finds no row,
and only one succeeds. The check that exactly one row was deleted is a backstop.
A new email or password ends the user's reset codes in the same transaction that
changes it: changing the email, changing or creating a password in Settings, and
the reset itself. Change email checks the code first, may send the user through
reverify, and uses it later in the same transaction as the email update. An
email-change code stores the address it was sent to, and that address is the one
it sets. The verify cookie keeps the addresses this device asked for, and the
code's address must be one of them. GET `/verify` only fills in the form; mail
scanners fetch links, so nothing is used until the form is posted.

**Pro.** `app/utils/subscription.server.ts` is the source of truth.
`getUserTier` reads the Stripe-backed `Subscription` row, and
`requireUserWithTier` returns the tier with the user and Household. The two
Pro-only resource routes, `resources/enhance-recipe` and `resources/transcribe`,
guard with `requireProTierOrNativeShellNull`. Without Pro it redirects to
`/upgrade`, or in the iOS shell returns null so the route answers with an error
its caller shows in place (ADR 0001). Every other Pro check reads `isProActive`.
AI import refuses with a 403 and applying an enhancement answers `requiresPro`.
Pages show or hide Pro features with it, and live updates are gated there alone,
since the household-events routes ask only for a Household member. The client
reads the tier through the hooks in `app/utils/subscription.ts`. To find every
place a user sees Pro, search rather than trust a list:

```sh
grep -rlw Pro app --include='*.tsx'
```

Checkout takes its price from `STRIPE_PRO_YEARLY_PRICE_ID`. The upgrade form
names a plan (`yearly` is the only one), never a price, and an unknown plan or a
missing price is refused before Stripe is asked. Deleting an account cancels its
Stripe subscription once the deletion has committed, so a deletion that fails
never leaves an account whose Pro was cancelled under it. The delete reads the
subscription id before the row goes. If Stripe then fails, the account stays
deleted and the failure is logged and captured as `stripe_cancel_failed` with
the subscription id, to cancel by hand.

## Logs and analytics

`redactUrl` in `app/utils/redact-url.ts` replaces the values of `code`, `token`,
`target`, `session_id`, `otp`, `state` and similar query parameters, including
inside `redirectTo`. These go through it:

- the request log and the `server_error` event;
- in the browser, every URL in a PostHog event's properties, the links
  autocapture records, URLs in error messages, the network requests and page
  addresses recorded for replays.

`handleError` in `app/entry.server.tsx` sends `server_error` for 5xx responses
and thrown errors only. A 4xx, such as a bot's POST to a page with no action, is
in the request log only, plus one warning when a body sent as a form fails to
read. React Router's origin check is the one exception: it answers 400 but stays
reported, since a mismatch can mean a broken proxy setup. A form body the server
can't read gets a 400 from the root middleware in
`app/utils/form-body.server.ts`, and upload routes map the multipart parser's
errors to the same 400 with `rethrowUnreadableUpload`.

Replays record the page's text, since `mask_all_text` is off. Input values are
masked by type, with the list in `app/utils/posthog.client.ts`: every type the
SDK's own "mask all inputs" covers, plus hidden inputs. Masking settings turned
on in the PostHog project would replace that list with the SDK's, which leaves
hidden inputs out, so they stay off. The hidden inputs that carry a secret are
blocked with `ph-no-capture` as well, so they stay out of replays whatever the
remote settings are: the invite token on the join page, and `redirectTo` and the
verify page's `target` and link `token` on the sign-in forms. A page that shows
a secret marks it with PostHog's `ph-no-capture` class, and the recording keeps
only an empty box of its size: the 2FA setup's QR code and URI, and the
Household invite link. posthog-js has no browser-side setting to stop recording
on chosen URLs; the URL blocklist for recordings lives in the PostHog project's
settings.

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
  answered from memory. A mutation sent with a plain `fetch` instead of a Router
  submission clears nothing unless it does so itself. Most call
  `invalidateServiceWorkerData()`. The Shopping check
  (`app/hooks/use-shopping-checks.tsx`) clears only the in-memory cache, since
  Shopping skips `qm-data-invalidate` (below).
- **A change by another household member.** [Live updates](#live-updates) covers
  the outline. The event types are in `app/utils/household-events.server.ts`,
  and the client's stream is `app/utils/household-event-source.client.tsx`. It
  polls every 30 seconds to cover reconnects and drops its own events by client
  id. The server sends a `keepalive` event every 30 seconds; a stream that shows
  nothing for 75 seconds (a half-open cellular socket fires no error) is closed
  and reopened the way an error is, with polling in between. Shopping
  revalidates after a 500 ms debounce, and the root batches its toast. The three
  subscribers are each gated on Pro, so a Free client opens no stream and sees
  another member's Shopping change on its next load. A change with no event
  shows on the next navigation or pull to refresh.
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

Every Anthropic call goes through `requestAnthropicJson` in
`app/utils/anthropic-json.server.ts`, which asks Anthropic for JSON and checks
the answer against the caller's Zod schema. Each feature keeps its own prompt,
schema and error wording, and a provider failure comes back as a kind the
feature turns into a plain message.

Every import saves what it read at once and opens the new Recipe
(`saveImportedRecipe` in `app/utils/import-recipe-save.server.ts`), and Pro adds
AI reading of pasted text and screenshots. A notice with Edit and Undo shows
only when a part was missing or shortened, or another Recipe has the same title.
A link the Household already has saves nothing, and Import says "Already in your
Recipes". The pasted text, or the AI's extraction for screenshots, is kept in
`Recipe.rawText`. Since nothing is reviewed first, the AI prompt asks for a
transcription and adds nothing the source doesn't give. Recipe enhancement
suggests a description and time estimates the user may apply. Voice input sends
audio to Groq Whisper, then the transcript to the fast model to split into
items, falling back to the rule-based parser.

Each paid feature has a daily limit per user: 10 AI imports, 10 enhancements and
30 voice inputs, counted from the server's local midnight. `claimAiUsage` in
`app/utils/ai-rate-limit.server.ts` counts today's `UsageEvent` rows and writes
a new one in one write transaction, so parallel requests queue rather than all
passing; a claim it can't record is refused. A voice row covers the Whisper call
and the parse that follows it. A call that fails in a way the user can't cause
(no key, a dropped connection, a provider 429 or 5xx, a bad key) gives its row
back. A timeout, other 4xx and anything after a 200 stay spent, so slow or bad
input can't buy unlimited calls. Hourly maintenance in
`server/scheduled-maintenance.ts` deletes rows from earlier days.

An image sent to the import gets the photo upload's checks: its first bytes,
then its header against the same decoded-size limit, before a daily use is
claimed. Preparing it for the model waits for the same turn as other photo jobs,
and a use spent waiting too long comes back.

## Recipe photos

Photos are stored in object storage (Tigris) under
`users/<userId>/recipes/<recipeId>/images/<file>`, and
`app/utils/storage.server.ts` writes every key. The file name is a timestamp, an
id and an extension taken from the upload's checked type, never the browser's
file name. A copy for a shared Recipe gets a new name of the same shape.

The browser shrinks a picked photo to 2048 px on the long edge, as a JPEG, when
it is over the 3 MB upload limit or has more than 8 million pixels, or 4 million
for a PNG, which can be 16-bit and interlaced. The app never shows a photo
larger than 2048 px, and any photo the browser leaves alone fits every limit
below.

### Checking an upload

An upload is checked before anything is saved, in
`app/utils/recipe-photo.server.ts`, and storage takes only a photo that passed.
The browser's type and the file name are ignored. The first bytes must be JPEG,
PNG or WebP, the formats the form offers. sharp must then read the same format
from the header and decode the whole file to a thumbnail, since a JPEG cut off
partway still has a readable header. A file that fails gets "We can't use that
file. Choose a JPG, PNG or WebP." next to the photo field, and the Recipe isn't
saved or changed. The form then takes the file off its input, so the next Save
goes through without it. HEIC is refused by its first bytes. The prebuilt sharp
can read a HEIC header but not decode it.

The production machine has 512 MB and one CPU, so the limit is on the memory a
decode holds, not the file size. That is width × height × channels × bytes per
sample, read from the header. A baseline JPEG may decode to 150 MB, which fits a
48 MP phone photo, because it shrinks while it loads. A plain PNG may decode to
100 MB, since it streams. A progressive JPEG, an interlaced PNG or a WebP
decodes whole and may decode to 32 MB. A photo over its limit gets "That photo
is too big. Try a smaller one." Two decodes at once add up, so every sharp job
on a photo (the upload check, each resize, and the import's preparation) waits
for one shared turn. When `MAX_WAITING_PHOTO_JOBS` (eight) jobs are already
waiting, the next is refused at once with the busy error. A job gives up after
30 seconds of waiting, or when its request is aborted, and sharp stops one that
runs for 30 seconds. Under Bun the request's abort signal doesn't fire when the
visitor leaves, so in practice a job whose visitor left still waits its turn or
its 30 seconds.

### Serving resizes

Pages show photos through `/resources/images`, which resizes with openimg and
caches each resize on disk. Share pages and link previews use it too, so it has
no login, and `app/utils/image-route.ts` sets what it accepts:

- **Keys.** Only keys of the shape above. Anything else gets a 400 before
  storage or the disk is touched.
- **Sizes.** Only the sizes the pages ask for: each `<Img>` size in `IMG_SIZES`,
  its srcset widths, and the 1200×630 share image. Components take their width
  and height from `IMG_SIZES`, so the page and the route use one list. An
  unlisted size gets the next listed size up instead of an error, so a page
  cached before a size changed still shows its photo. No size at all serves the
  photo the data export links to: upright, at most 2048 px, and without the
  stored bytes' metadata, which can hold where it was taken.
- **Formats.** AVIF, WebP, or the original format. `fit` is `cover` or left out.
  Both mean the same crop, so they share one cached copy. A format needs a size:
  no page asks for a full-size AVIF or WebP.
- **Decoding.** The route reads the stored photo's header first, so one over the
  upload's limit gets an error before it is decoded. The decode then waits for
  its turn like every other photo job.

Per photo that is at most 21 resizes no larger than 1200×630, plus one copy of
at most 2048 px in the original format. Uploads are capped at 3 MB.

The cache is `/data/images` in production, on the same volume as SQLite. It
stays bounded in two ways. Deleting a photo also deletes its cached resizes,
because the route answers from the cache before it asks storage. And the hourly
maintenance in `server/scheduled-maintenance.ts` deletes the oldest resizes when
the cache passes 100 MB. It skips files written in the last ten minutes and
never removes folders, so a resize being written isn't pulled out from under
openimg. A folder or file it isn't allowed to read or delete is skipped and
counted in the log line. A pruned resize is made again on its next view.

A resize that is already being made when its photo is deleted can land in the
cache after the delete has cleared it. The cache stays far under the prune
limit, so the prune would rarely reach it. The delete therefore clears the
photo's resizes again two minutes later, from an unref'd timer that logs a
failure and moves on. Three gaps are known and accepted. A restart inside those
two minutes loses the second clear, and a resize that lands then is served until
the cache passes the limit. A browser or the service worker that already holds a
deleted photo keeps showing it from its own cache. And when the storage delete
itself fails, the delete is logged and the Recipe goes anyway, but the photo
stays in storage, so it and its resizes keep serving to anyone who has the key.

## Data export and restore

Settings exports the Household as JSON, or only its Recipes. The file links to
photos rather than holding them. `/resources/download-user-data` returns the
signed-in user's own account record as JSON, and no page links to it.

Full JSON import accepts older exports and restores durable household data on
every tier, one restore at a time per process. It takes files up to 10 MB, sent
as a multipart file part. Before parsing it checks the JSON's depth and its
count of objects, arrays and commas against `RESTORE_JSON_LIMITS`. After parsing
it checks the lists against `RESTORE_LIMITS` before the schema runs, and the
schema stops at the first bad element of each list. What the Household already
has counts as skipped. Anything else that doesn't land counts as failed and is
logged with where it sits in the file. A write error it doesn't expect stops the
restore with a reply on the page, and running it again picks up the rest. One
thing a rerun can't bring back: a sub-Recipe link to a Recipe later in the file
than the error, because the rerun matches the Recipes already saved by title and
leaves them as they are. A Meal's day is the date written in the file, a plain
day or the date part of a full ISO string, and a plan's week is the Monday of
the day it names. A day that isn't one counts as failed (`invalid-date`), and so
does a real day outside its plan's week (`outside-week`).

## Deployment and recovery

How the machine boots, backs up and restarts is under
[Running in production](#running-in-production), and the restore steps are in
[RESTORE.md](./RESTORE.md).

Production requires the `APP_ORIGIN` secret (`https://useqm.app`).
`app/utils/env.server.ts` checks it with the rest of the environment before
migrations run. Outside production it defaults to `http://localhost:$PORT`.
Every absolute URL the app hands out comes from it, through `getAppOrigin()` in
`app/utils/app-origin.server.ts`, and none comes from the request, whose `Host`
and `X-Forwarded-*` headers the client controls. It is used for:

- emailed verification links (signup, password reset, change email);
- robots.txt and the sitemap;
- OG and JSON-LD URLs and share links, through the root loader's
  `requestInfo.origin`;
- the Household invite link;
- the TOTP issuer shown in authenticator apps;
- the passkey relying party ID and origin;
- Stripe checkout and portal return URLs;
- the HTTP→HTTPS redirect, and the 301 from `www.` plus its host to it
  (`server/https-redirect.ts`). The 301 is for GET and HEAD on the www host
  alone, so fly.dev and Fly's healthcheck are never redirected.

Redirects within the site stay relative, so the browser keeps the host it used
(a LAN IP in dev, or the fly.dev host) and its cookies. `APP_ORIGIN` is an
unstaged Fly secret; `fly ssh console -C env` shows whether it reached the
machine.

A Cloudflare Transform Rule (Modify Request Header) sets `x-qm-edge` on every
request to the zone, as a static value that overwrites anything a client sent.
The same value is the unstaged Fly secret `CF_EDGE_SECRET`. To rotate, change
the rule and the secret together. If the secret is missing, the server warns at
boot and rate limits key on `fly-client-ip`. If it is set but requests through
Cloudflare stop carrying it, they key on `fly-client-ip` too, and the server
logs a warning with their count at most once an hour, without the header's
value. Only requests for APP_ORIGIN's host count, since anyone can send
Cloudflare's headers to the fly.dev host.

Before a multi-machine deployment, all of these must be designed, wired, and
tested together:

- elect exactly one writable primary and give replicas a safe way to discover it
  and fail over without stale data winning;
- replay every write on the primary. The LiteFS proxy currently handles normal
  non-GET actions, including admin writes; audit every route rather than
  assuming HTTP method conventions are enough;
- provide read-your-writes consistency after replication-aware writes, either
  with the LiteFS proxy transaction cookie or an equivalent transaction-position
  wait/replay mechanism; and
- exercise failover, admin mutations, and an immediate post-write read on real
  replicas before increasing the Machine count.

## Testing

Which layer to test in, and how, is in [AGENTS.md](../AGENTS.md#testing). Vitest
runs pure logic and authenticated loader/action behavior against real test
SQLite databases. Playwright runs user flows against a production build. A
migration test rehearses a data-converting migration against legacy data before
it ships. Delete the test once production has applied the migration, because the
conversion can never run again. `app/utils/schema-constraints.test.ts` guards
the CHECK constraints and triggers that exist only in migration SQL, such as the
Shopping `checkVersion` triggers, since Prisma would drop them silently if it
rebuilt those tables.

A test file opts into the setup it needs: `import '#tests/setup/db-setup.ts'`
for a freshly migrated database before each test,
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
guard. It also runs a few address literals through that guard (see
[SECURITY.md](./SECURITY.md#fetching-recipe-links)).

The Playwright `login` fixture signs in a user who already has a Household,
created the same way signup creates one, and returns its `householdId`. Seed
test data into that Household. Creating another one for the same user gives them
two memberships, and the app would pick one at random. `insertNewUser` inserts a
user with no Household, which production can't produce; give them one with
`createOwnHousehold` before they sign in through the UI.

Playwright runs on every pull request and uploads its HTML report. It is a
required check for merging, and deploys do not wait for it. CI sets
`BOTTOM_NAV_FEEDBACK_TRACE_ONLY=1`, so the 34 ms bottom-nav feedback budget is
logged there and asserted only in local runs.

Playwright gives its server a made-up `ANTHROPIC_API_KEY`, which wins over the
one in `.env`, so a local run never reaches the real API. Requests carrying it
get canned answers from `tests/mocks/anthropic.ts`: a Recipe whose title counts
the images sent, or nothing found when the Household has a metadata value named
`E2E_UNREADABLE_MARKER`.

The root layout sets `data-hydrated` on `<html>` from an effect, once, on the
first load, after every mount effect has run, so the router takes navigations by
then. State those effects set can still commit after it, so the marker doesn't
mean the page has settled. `hydrated(locator)` and `waitForHydration(page)` in
`tests/playwright-utils.ts` wait for it. After a client navigation the marker is
already there, so `hydrated()` only checks that the element is attached. Setting
`PW_CPU_THROTTLE=4` slows the page's CPU four times, which brings out the races
a slow CI runner hits.
