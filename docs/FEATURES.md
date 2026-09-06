# Feature reference

Quartermaster saves the Recipes you cook, plans them as Meals, and turns the
plan into Shopping.

## Core loop

### Recipes

- Create, edit, favorite, search, sort, and share Recipes.
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
  wake lock, and local progress.
- Add a Recipe to a Menu, Plan, or Shopping.
- Recipe cards stay minimal. Recently Updated is the default. Recipe detail
  shows actionable Staples/Out-aware availability.

### Menus

- Build a reusable multi-dish Menu from ordered Recipe and note cards.
- Use optional sections, Recipe multipliers, display notes, and free-text
  Shopping lines for drinks or shared purchases.
- Reorder and move cards with labelled controls on phone and desktop.
- Plan a Menu as one stable Meal snapshot; later Menu edits do not silently
  rewrite it.
- Preserve Menus, ordering, missing Recipe cards, and notes in full JSON
  export/import.
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
- Add one Meal’s demand to Shopping explicitly and refresh it when relevant
  Recipe or quantity inputs change.

### Staples

- Keep a household list of ingredients normally assumed available.
- Mark a Staple Out to ensure it is unchecked in Next shop immediately;
  generated Shopping also treats it as unavailable when required.
- Search, add, remove, and restore Staples across household changes and full
  data recovery.
- Archived Pantry data remains available as a deliberate rollback path but is
  inert after the Staples cutover.

### Shopping

- Generate from a selected Plan week or add one Recipe/Meal explicitly.
- Combine compatible quantities across Recipes and Menu note lines while leaving
  unresolved or incompatible amounts visible.
- Omit normal Staples; include Out Staples and every non-Staple.
- Add several household Staples to the next shop from one quiet header picker.
- Keep manual rows separate from generated Meal contributions so refreshes do
  not overwrite another Meal or a shopper’s correction.
- Edit, search, check off, clear, and quick-add in a flat list with no aisle
  grouping.
- Sync household changes through SSE with polling fallback.

## Supporting features

### Households and recovery

- One household per user with owner/member roles and invite links.
- Household-scoped Recipes, Menus, Plans, Staples, and Shopping.
- Household-record JSON export/import, older-export compatibility, and household
  move handling. Recipe image files are not embedded in JSON.
- Optional Free/Pro subscription limits with graceful downgrade.

### AI and voice

- Extract Recipes from text and images with Anthropic models.
- Suggest Recipe description and time improvements for explicit review.
- Transcribe voice with Groq Whisper and parse short spoken inputs.
- Rate limits, schema validation, and manual fallback keep these features
  optional. The app works without API keys.

## UI and infrastructure

- Mobile-first PWA with safe areas, 44px touch targets, dark mode, offline read
  caching, and optimistic interaction.
- Warm paper-and-ink design using Young Serif, DM Sans, sage, and copper.
- Sessions, OAuth, passkeys, CSP, SSRF protection, input validation, and secure
  uploads.
- SQLite/Prisma on Fly.io with LiteFS, object storage, pre-migration backups,
  Vitest coverage, and focused Playwright flows.

Product terms live in [CONTEXT.md](../CONTEXT.md). Shipped, stopped, and
deferred roadmap outcomes live in [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)
and roadmap #98.

_Updated 4 September 2026._
