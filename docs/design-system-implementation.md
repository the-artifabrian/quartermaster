# Design System Implementation Plan

Step-by-step overhaul based on [docs/design-system.md](./design-system.md). Each
phase builds on the previous one.

---

## Phase 1: Foundation (Design Tokens & Shared Primitives) — DONE

Replaced all CSS variable values in `app/styles/tailwind.css` with the design
system palette. Variable _names_ unchanged so component classes don't break.

**What shipped:**

- **Color palette**: `:root` light-mode + `.dark` dark-mode variables. Named
  colors: washi (bg), sumi (fg), shiro (card), matcha (primary), kinari
  (secondary), cha (muted-fg), kawa (accent), sugi (border), beni (destructive).
  Warm shadows (`shadow-warm` = rest, `shadow-warm-md` = hover, `shadow-warm-lg`
  = elevated). Radius: base 0.5rem, sm 0.25rem, lg 0.75rem.
- **Typography**: Crimson Pro + Caveat via Google Fonts (`font-display=swap`).
  Registered as `--font-serif` and `--font-handwritten` in `@theme inline`.
  `font-serif` was already used in 12 files — swapped automatically.
- **Animation curves**: 5 named easing functions (`--ease-page-settle`,
  `--ease-hover-lift`, `--ease-reveal`, `--ease-micro`, `--ease-exit`). Updated
  keyframes incl. new `fade-up-reveal` (280ms, ease-reveal).
- **Container utilities**: `container-narrow` (480px), `container-content`
  (880px), `container-grid` (1080px), `container-landing` (960px). Existing
  `container` (1400px) kept for non-redesigned pages.
- **Shared components**: `page-container.tsx` (width prop wrapper),
  `divider.tsx` (hand-drawn SVG rule, `subtle`/`accent` variants). No
  `HandwrittenText` wrapper — Caveat applied directly at 2 call sites.
- **shadcn/ui restyle**: button, input, checkbox (20px default), textarea,
  sonner, dropdown-menu (fixed `stroke="black"` → `currentColor`), popover.
  Style-only — no API changes.
- **Header & nav**: serif logo, matcha active states, sugi border, theme-color
  `#4E7A54`.

**Files:** `app/styles/tailwind.css`, `app/root.tsx`,
`app/components/page-container.tsx`, `app/components/divider.tsx`,
`app/components/bottom-nav.tsx`,
`app/components/ui/{button,input,checkbox,textarea,sonner,dropdown-menu,popover}.tsx`

---

## Phase 2: Landing Page — "The First Page of a Journal" — DONE

Complete redesign of `app/routes/_marketing/index.tsx`.

**What shipped:**

- **Hero**: Crimson Pro 300, _"What are we making this week?"_, full viewport
  height, page-settle fade-in (320ms). Subtle radial glow + decorative Divider
  (no mini previews).
- **Artifacts section** (container-landing, 960px): recipe card (2° rotation),
  week view (7-day row), shopping list (torn-paper clip-path). Scroll-reveal via
  IntersectionObserver, staggered left-right-left on desktop.
- **Closing**: _"Your recipes deserve a home."_ in Crimson Pro 400, single CTA.
- **Review fixes**: scroll-reveal visible without JS, removed dead opacity
  class, `scroll-behavior: smooth` in CSS (respects reduced-motion), fixed copy
  ("Add recipes" not "Drag recipes"), removed Caveat from week view. Updated
  subtitle/meta: _"Keep your recipes. Plan your week. Cook from what you have."_
- Preserved: JSON-LD schema, meta tags, `getUserId` redirect, sitemap export.

**Files:** `app/routes/_marketing/index.tsx`

---

## Phase 3: Recipe List — "The Recipe Box" — DONE

Redesign of `app/routes/recipes/index.tsx` and `app/components/recipe-card.tsx`.

**What shipped:**

- **Recipe card**: single responsive component — horizontal row on mobile (48px
  placeholder, serif 16px title, colored-dot match %), vertical card on desktop
  (4:3 image area, serif 18px/600, 30px progress ring). Hover lift
  (`shadow-warm-md`, ease-hover-lift 180ms). No-photo: serif initial letter.
- **Grid**: `container-grid` (1080px). 1-col mobile, 2-col md, 3-col lg.
- **Search & filters**: rounded-full pill inputs, collapsible filter row on
  mobile (mixer-horizontal toggle icon, active count badge). Filter chips
  `rounded-full bg-secondary/50`, active `bg-primary`.
- **Placeholders**: 6 warm color themes (amber/emerald/rose/stone/sky/violet at
  low opacity), dark mode variants. Serif initial letter only.
- **Empty states**: dashed border circle pattern, warm messaging. Getting
  started checklist: `bg-secondary/30` done, `bg-muted/30` pending.
- **Supporting**: match-progress-ring stroke 3→2.5, user-dropdown avatar
  centering fix, `mixer-horizontal.svg` icon.

**Files:** `app/components/recipe-card.tsx`, `app/routes/recipes/index.tsx`,
`app/utils/recipe-placeholder.ts`,
`app/components/getting-started-checklist.tsx`,
`app/components/match-progress-ring.tsx`, `app/components/user-dropdown.tsx`,
`other/svg-icons/mixer-horizontal.svg`

---

## Phase 4: Recipe Detail — "The Open Cookbook" — DONE

Redesign of `app/routes/recipes/$recipeId.tsx` and sub-components.

**What shipped:**

- **Hero**: serif title 2.25rem, `<Divider variant="accent" />`, metadata as
  inline text row (not card). Image beside title on desktop (max 400px), full
  width on mobile. `container-content` (880px). `<Img>` (openimg) for responsive
  images.
- **Ingredients**: line-height 1.7, amounts `font-medium`, headings in serif
  small-caps, 24px checkboxes (matcha fill), checked at 40% opacity +
  line-through, `bg-muted/30` unchecked fill. Desktop: sticky column.
- **Instructions**: serif step numbers (1.5rem, cha), DM Sans body (line-height
  1.75, 17px mobile), `space-y-4`, checked at 40% opacity.
- **Notes**: left border 3px kawa, `bg-accent/5`, `font-handwritten` 1.125rem.
- **Action bar**: kinari floating bar (`bg-secondary/95`, `shadow-warm-lg`).
  Matcha "I Made This". Cooking log: lighter border, cha date.
- **Review fixes**: removed back link, description `text-base`, removed hover bg
  on instructions (dark mode artifact), inline styles → Tailwind
  (`leading-[1.7]`, `[font-variant:small-caps]`).

**Files:** `app/routes/recipes/$recipeId.tsx`,
`app/components/recipe-{ingredient-list,instructions-list,metadata-card,action-bar,i-made-this-modal,cooking-log-entry}.tsx`,
`app/routes/share.$recipeId.tsx`

---

## Phase 5: Meal Plan — "The Week Ahead" — DONE

Redesign of `app/routes/plan/index.tsx`.

**What shipped:**

- **Mobile**: vertical day stack, serif day names (600), today-first ordering
  (today → future → past). Today: kawa underline + warm bg. Past: 80% opacity.
  Empty days: _"Nothing planned"_ + ghost `+`.
- **Desktop**: compact 7-col grid (lg) / 4-col (md). Shiro cards, natural height
  variation, kawa top-border on today. Index-card feel with warm shadows and
  hover border.
- **Tonight banner**: warm gradient (washi → kinari). Has meal: photo + time +
  "Let's cook". Empty: favorite suggestion. Current-week only.
- **Interactions**: warm recipe selector (circular thumbs, scrollbar-thin),
  280ms fade-in on add, Crimson Pro week nav, template modal restyle. Entry
  rows: compact checkbox + title + servings stepper (size-6 tap targets).
- **Utility**: `isPast(date)` in `app/utils/date.ts` with 5 unit tests.

**Files:** `app/routes/plan/index.tsx`, `app/components/recipe-selector.tsx`,
`app/components/meal-slot-card.tsx`, `app/components/today-banner.tsx`,
`app/components/template-modal.tsx`, `app/components/meal-plan-calendar.tsx`,
`app/utils/date.ts`, `app/utils/date.test.ts`

---

## Phase 6: Shopping List — "The Scrap of Paper" — DONE

Redesign of `app/routes/shopping.tsx`.

**What shipped:**

- **Layout**: `container-narrow` (480px), serif page title.
- **Items** (`shopping-list-item.tsx`): 24px checkboxes (matcha), DM Sans 16px,
  checked = 2px line-through (cha) + 50% opacity + 200ms strikethrough
  animation. 16px vertical padding. Whole row tappable. Edit/delete behind `···`
  overflow (hidden until hover/focus). Category headers: 12px uppercase, hai
  color (`#A69B8F`/`#8A7F73`).
- **Quick add**: bottom-border-only input, ghost `+` button, collapsible
  qty/unit row. Duplicate-check warning in `bg-accent/10`.
- **Checked actions**: "Add to Inventory"/"Clear Checked" as text links with `·`
  separator, slide-up animation. Inventory review panel: `bg-secondary/30`,
  serif title, location badges.
- **Low stock**: `bg-accent/8` banner, accent header, warm chips.
- **Print**: Unicode checkboxes, compact spacing, wordmark footer.
- **Polish**: matcha progress bar, search hidden until 15+ items, dashed-circle
  empty state. `strikethrough` + `slide-up-reveal` keyframes in tailwind.css.

**Files:** `app/routes/shopping.tsx`, `app/components/shopping-list-item.tsx`,
`app/components/shopping-list-to-inventory.tsx`, `app/styles/tailwind.css`

---

## Phase 7: Polish & Cross-Cutting QA

Final pass across all surfaces after the six phase implementations.

### 7A: Dark Mode Audit

- [ ] Walk through every redesigned surface in dark mode
- [x] Lightened dark-mode tokens for WCAG AA contrast:
  - `--primary`: `#7FA085` → `#8CB393` (~6.5:1 vs sumi-dark bg)
  - `--muted-foreground`: `#9A8E80` → `#A69A8C` (~5.8:1)
  - `--destructive` / `--input-invalid` / `--foreground-destructive`: `#C46B58`
    → `#D07A68` (~5.2:1)
  - `--ring` updated to match primary
- [ ] Fix any remaining broken contrast or color mismatches

### 7B: Accessibility Check

- [ ] Run axe-core or Lighthouse accessibility audit on each surface
- [ ] Verify all interactive elements have visible focus indicators (ring in
      matcha)
- [x] Fix heading hierarchy: h3 → h2 in `plan/index.tsx` (empty state) and
      `shopping.tsx` (empty state). Low-stock h3 kept (sub-section label).
- [ ] Screen reader test on recipe detail page (the most complex surface)

### 7C: Responsive Spot-Check

- [ ] Test each surface at: 375px (iPhone SE), 390px (iPhone 15), 768px (iPad),
      1280px, 1920px
- [ ] Verify container widths feel appropriate at each breakpoint
- [ ] Bottom nav still works correctly with updated styling
- [ ] No horizontal overflow or text truncation issues

### 7D: Performance

- [x] Font loading: `font-display=swap` in Google Fonts URL, preconnects correct
      — no FOIT risk
- [ ] Check total font payload in DevTools Network tab (~60KB woff2 target)
- [x] Animations respect `prefers-reduced-motion: reduce` via global media query
      in tailwind.css (sets animation/transition duration to 0.01ms)
- [ ] No layout shifts from font loading (CLS score)

### 7E: Existing Feature Verification

Migrated hardcoded colors to design tokens on non-redesigned surfaces:

- [x] Timer widget — `bg-red-500`/`text-red-500` → `destructive` tokens
- [x] AI badges (recipe detail, share page, generate page) — violet → `primary`
      palette
- [x] Pantry staples onboarding — `text-amber-600` → `text-accent`

Intentionally kept as-is:

- Enhance recipe modal — violet for AI brand color (intentional distinction)
- Recipe card sparkle badges — violet decorative accent

Still needs manual visual verification:

- [ ] Settings pages (`app/routes/settings/`)
- [ ] Recipe create/edit, recipe form (ingredient DnD, image upload)
- [ ] Auth pages (`app/routes/_auth/`)
- [ ] Inline temperature, notification bell, user dropdown
- [ ] Toasts and modals across the app

### Phase 7 Definition of Done

- [ ] All surfaces (including inventory after Phase 8) pass dark mode +
      accessibility + responsive checks
- [ ] Non-redesigned pages look coherent with the new palette
- [x] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (unit tests)
- [ ] Commit final polish, wait for review

---

## Phase 8: Inventory — "The Pantry Shelf"

Redesign `app/routes/inventory/index.tsx` and
`app/components/inventory-item-card.tsx`. The inventory is the last major
surface still using the pre-redesign card-heavy layout. Goal: dramatically
increase item density (especially on mobile), bring visual consistency with the
shopping list and recipe list, and maintain all existing functionality.

### 8A: Layout & Container

- [ ] Wrap content in `container-grid` (1080px max)
- [ ] Page title: `font-serif` Crimson Pro 400, drop the item count from the
      heading (move to a subtle muted line or remove entirely)
- [ ] "+ Add Item" button: consistent with recipe list header — circular `+` on
      mobile, full button on desktop

### 8B: Location Sections

Replace heavy colored background sections with lightweight category headers
matching the shopping list pattern.

- [ ] Location headers: DM Sans 12px, uppercase, `tracking-[0.08em]`, hai color.
      32px space above, 12px below. Keep semantic color dot (amber/blue/cyan) as
      a small `size-2 rounded-full` indicator inline with the name. Item count
      as muted parenthetical.
- [ ] Drop the full-width colored background panels (`bg-amber-50/30`,
      `bg-blue-50/30`, `bg-cyan-50/30`) — the dot provides enough location
      signal without the visual weight.
- [ ] "All" tab view: show all items in a single flat list with location dot per
      item (no section grouping). Single-location tabs: grouped with headers.

### 8C: Item Row Redesign

Replace bordered cards with compact flat rows (closer to shopping list density).

- [ ] `app/components/inventory-item-card.tsx` — restyle:
  - **Row layout**: no card border, no background, no shadow. Subtle
    `border-b border-border/40` separator between items. ~48px row height.
  - **Name**: DM Sans 15px (not bold — `font-normal`), left-aligned
  - **Quantity/unit**: inline after name as muted text
    (`text-muted-foreground text-sm`), separated by `·`. If no quantity, show
    nothing (no "—").
  - **Expiry badge**: compact inline pill, same color logic (red expired, amber
    soon). Only shown when ≤7 days or expired. Positioned after qty/unit.
  - **Low-stock indicator**: small kawa dot (`size-1.5 rounded-full bg-accent`)
    next to name, replacing the "Low" pill badge. Tooltip on hover.
  - **Actions**: edit pencil + `···` overflow hidden until hover/focus
    (`opacity-0 group-hover:opacity-100 focus-within:opacity-100`), matching
    shopping list pattern. On mobile, overflow always visible (touch has no
    hover).
  - **Hover**: subtle `bg-muted/30` row highlight, no lift/shadow
  - **Quick-edit inline**: keep existing expand-in-place UX, restyle inputs to
    match shopping list (warm borders, compact `h-8` inputs)
- [ ] Remove the `sm:grid-cols-2 md:grid-cols-3` grid — use single-column list
      on all breakpoints for scannability and consistency with shopping list.
      Desktop width is constrained by `container-grid` (1080px) which prevents
      lines from getting too wide.

### 8D: Quick Add

- [ ] Restyle to match shopping list quick-add: bottom-border-only input, DM
      Sans placeholder _"Add an item..."_, ghost `+` button at right edge
- [ ] Keep duplicate-detection warning, restyle with `bg-accent/10` warm palette
- [ ] Position at top of the current location section (below header, above
      items), not as a separate floating element

### 8E: Search & Filters

- [ ] Search: `rounded-full bg-secondary/50`, warm border — match recipe list
      search styling. Hide until 15+ items (like shopping list).
- [ ] Location tabs: restyle as filter chips matching recipe list pattern —
      `rounded-full bg-secondary/50 text-xs`, active state
      `bg-primary text-primary-foreground`.
- [ ] Collapse search + filters into single row on desktop, stack on mobile

### 8F: Status Indicators

- [ ] Expiring-soon callout (`ExpiringItemsCallout`): restyle as warm card with
      `bg-accent/8` background (matching shopping list low-stock pattern).
      Accent-colored header, compact item chips showing days remaining. "Find
      recipes" CTA as text link.
- [ ] Low-stock summary: if multiple low-stock items, show a single muted line
      below the header (e.g., _"3 items running low"_) instead of relying on
      per-item badges alone
- [ ] Free plan usage banner: restyle to match warm palette, understated

### 8G: Empty States

- [ ] Zero inventory: keep pantry staples onboarding as primary flow. Restyle
      the onboarding component to match warm palette (already partially done
      with accent token migration in Phase 7).
- [ ] Empty location tab: dashed border circle pattern, warm messaging
      (consistent with recipe list and shopping list empty states)
- [ ] Search no-results: same dashed circle pattern

### Phase 8 Definition of Done

- [ ] Inventory items are dramatically more compact (~48px rows vs ~80px+ cards)
- [ ] 20-item inventory is fully visible without scrolling on desktop
- [ ] Location sections feel like natural grouping, not heavy colored panels
- [ ] Edit/overflow actions discoverable but not visually noisy
- [ ] Quick-add feels consistent with shopping list
- [ ] All existing functionality preserved: quick-edit, low-stock toggle, expiry
      tracking, duplicate detection, bulk create, pantry onboarding
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Commit, wait for review

**Files:** `app/routes/inventory/index.tsx`,
`app/components/inventory-item-card.tsx`,
`app/components/inventory-quick-add.tsx`,
`app/components/pantry-staples-onboarding.tsx`
