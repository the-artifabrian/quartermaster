# Feature reference

Quartermaster saves the Recipes you cook, plans them as Meals, and turns the
plan into Shopping.

## Core loop

### Recipes

- Create, edit, favorite, search, sort, and share Recipes.
- Manual create/edit starts with title, ingredients, and instructions, with
  optional yield beside ingredients. Photo, Details, and Classification stay
  collapsed until needed; their values are retained when saving. Optional
  details do not contribute to a completeness score.
- Import one Recipe from a URL, pasted text, or screenshots; write a Recipe
  manually when needed. Quick Entry and the legacy text/file bulk importer have
  been removed. Household and Recipe JSON recovery remain available.
- Imports open a readable overview with Save Recipe and optional Edit. Correct
  titles, ingredients, steps and supplied time/yield before saving when needed.
  Failed saves retain the active review; leaving or reloading Import does not
  yet restore it.
- Imported Recipes retain pasted input or available extracted structure for
  recovery, without displaying it in import editing, saved editing or reading.
  Useful source URL access remains. Both JSON exports include retained source
  and older exports remain accepted. Anonymous sharing omits raw source;
  authenticated Save to my Recipes includes it in the copied Recipe.
- Scale ingredient display, switch units, print, and keep personal notes.
- Cook with ingredient/step check-off, glanceable duration and temperature cues,
  wake lock, and local progress. Checks resume on this browser for up to seven
  days, separately for each account, household, and Recipe. When checks exist,
  More actions offers Reset cooking checks for the next cook. Changed or removed
  ingredient/instruction rows lose their checks; reset leaves Recipe content,
  Plan, and Shopping unchanged.
- Add a Recipe to a Menu, Plan, or Shopping.
- Recipe cards stay minimal. Recently Updated is the default. Recipe detail
  shows what the Recipe needs, with each ingredient one tap from Shopping.
- Filter the library by favorites, maximum time, and Cuisine, Season, and
  Course. Any chosen value within one dimension matches; every dimension with a
  choice must match.

### Menus

- Build a reusable multi-dish Menu from ordered Recipe and note cards.
- Use optional sections, Recipe multipliers, display notes, and free-text
  Shopping lines for drinks or shared purchases.
- Reorder and move cards with labelled controls on phone and desktop.
- Plan a Menu as one stable Meal snapshot; later Menu edits do not silently
  rewrite it.
- Preserve Menus, ordering, missing Recipe cards, and notes in full JSON
  export/import.
- Share a Menu by link. Anyone can read it and open its Recipes; a signed-in
  reader can Save to my Menus, which copies the Menu and its Recipes into their
  Household, and a later visit offers Open my Menu.
- Menus are intentionally imageless.

### Plan and Meals

- Plan an ordered list of Meals for each day of a Monday-start week.
- A Meal may contain one or more Recipes, a Menu snapshot, or plain text such as
  “Leftovers.”
- Search Recipes and saved Menus together when adding a Meal to a day; a Menu
  can also be found by the Recipe titles inside it.
- Store an optional label, serving time, guest count, Recipe multiplier, and
  cooked state.
- Add Recipes to an existing Meal, reorder Meals, and edit Meal details without
  leaving the Plan.
- Add one Meal’s demand to Shopping explicitly, and update it later from the
  Meal’s current Recipes, multipliers, and note lines. An update drops the lines
  of a deleted Recipe.

### Staples

- Keep a household list of ingredients normally assumed available.
- Put a Staple on the Next shop from its row; a matching row already there is
  moved or brought back rather than duplicated, and a Staple already waiting
  reads “On list” instead. Staples carry no availability state.
- Search, add, and remove Staples; they survive household changes and full data
  recovery.
- A household with no Staples sees suggested ones (salt, olive oil, eggs, and
  the like), each a one-tap add. They stay for that visit so several can be
  added in a row.

### Shopping

- Pick Meals and lines from a Plan week in the From Plan picker, or add one Meal
  explicitly from its Plan card. Staple matches, plain pantry basics, lines
  already on the list, and days that have passed arrive unticked.
- Combine compatible quantities across Recipes and Menu note lines while leaving
  unresolved or incompatible amounts visible.
- Omit lines matching a household Staple; include everything else.
- Put several household Staples on the Next shop from one quiet header picker.
- Keep manual rows separate from Meal contributions so updates do not overwrite
  another Meal or a shopper’s correction.
- Edit, search, check off, clear, and quick-add in a flat list with no aisle
  grouping.
- Keep two horizons: Next shop is the list for the coming trip, and Later is a
  collapsible section below it for things to buy another time. Rows move between
  them, Later has its own quick add, and adding a row already waiting in the
  other horizon offers to move it.
- Sync household changes through SSE with polling fallback.

## Supporting features

### Households and recovery

- One household per user with owner/member roles and invite links.
- Household-scoped Recipes, Menus, Plans, Staples, and Shopping.
- Household-record JSON export/import, older-export compatibility, and household
  move handling. Recipe image files are not embedded in JSON.
- Settings offers Export All Data (the household JSON), Export Recipes, and
  Import Data. `/resources/download-user-data` returns the signed-in user's own
  account record (profile, roles, and session dates) as JSON; no page links to
  it.
- Delete my account: while another member remains, the Recipes and Shopping list
  pass to them (an owner first) and the Household stays; a sole member's
  deletion removes the Household and everything in it. Settings says which
  before the confirming tap.
- Optional Free/Pro subscription limits with graceful downgrade.

### Sign-in and security

- Password, passkey, and Google sign-in, with a "Remember me" choice.
- Two-factor auth with an authenticator app (TOTP), turned on and off in
  Settings; login then asks for the code.

### AI and voice

- Extract Recipes from text and images with Anthropic models.
- Suggest Recipe description and time improvements for explicit review.
- Transcribe voice with Groq Whisper and parse short spoken inputs.
- Rate limits, schema validation, and manual fallback keep these features
  optional. The app works without API keys.

### iOS app

- A small Swift shell that loads the Web app, distributed through TestFlight
  only. A deploy reaches it at once.
- Share-sheet import: a Recipe link shared from Safari, Messages, or a site's
  share button opens Import with the fetch running.
- Home Screen quick actions for Shopping and Import recipe, pull to refresh,
  haptics, reopening the last page on a cold start, and a native offline view
  with Retry.
- Pro and Google sign-in are hidden in the app, and sessions are always
  remembered.

## UI and infrastructure

- Mobile-first PWA with safe areas, 44px touch targets, dark mode, offline read
  caching, and optimistic interaction.
- Warm paper-and-ink design using Young Serif, DM Sans, sage, and copper.
- Sessions, OAuth, passkeys, CSP, SSRF protection, input validation, and secure
  uploads.
- SQLite/Prisma on Fly.io with LiteFS, object storage, pre-migration backups,
  Vitest coverage, and focused Playwright flows.

Product terms live in [GLOSSARY.md](../GLOSSARY.md). Shipped, stopped, and
deferred roadmap outcomes live in [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)
and roadmap #98.

_Updated 8 October 2026._
