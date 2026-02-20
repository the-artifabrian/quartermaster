# Design System Implementation Plan

Step-by-step overhaul based on [docs/design-system.md](./design-system.md). Each
phase builds on the previous one. Commit after each phase, review before moving
to the next.

---

## Phase 1: Foundation (Design Tokens & Shared Primitives)

Everything else depends on this. Changing tokens first means the whole app
shifts palette/typography in one pass, and surface-specific work is purely
structural.

### 1A: Color Palette

Replace all CSS variable values in `app/styles/tailwind.css`. The variable
_names_ stay the same so component classes don't break — only the values behind
them change.

- [x] Replace `:root` light-mode variables with design system hex values
  - `--background` → `#F6F1EB` (washi)
  - `--foreground` → `#2D2926` (sumi)
  - `--card` → `#FDFAF6` (shiro)
  - `--card-foreground` → `#2D2926`
  - `--primary` → `#4E7A54` (matcha)
  - `--primary-foreground` → `#FDFAF6`
  - `--secondary` → `#E8E0D4` (kinari)
  - `--secondary-foreground` → `#4A4139`
  - `--muted` → `#EDE7DE`
  - `--muted-foreground` → `#6F6358` (cha)
  - `--accent` → `#C4956A` (kawa)
  - `--accent-foreground` → `#2D2926`
  - `--border` → `#DED6CA` (sugi)
  - `--destructive` → `#B85C4A` (beni)
  - `--ring` → `#4E7A54`
- [x] Replace `.dark` variables with dark-mode hex values
- [x] Update shadow **values** in `--shadow-warm` / `--shadow-warm-md` /
      `--shadow-warm-lg` to the new lighter values from the design system. **Keep
      the existing names** — renaming would touch 31 files for zero visual
      benefit. The mapping is: `shadow-warm` = rest, `shadow-warm-md` = hover,
      `shadow-warm-lg` = elevated.
- [x] Update `--radius` values: base `0.5rem`, sm `0.25rem`, lg `0.75rem`
- [ ] Verify: spin up dev server, spot-check a few pages in light mode + dark
      mode. Colors should feel warmer/earthier. No broken contrast on primary
      text.

**Files:** `app/styles/tailwind.css`

### 1B: Typography

Add Crimson Pro and Caveat fonts. Register Tailwind utilities for the three font
families.

- [x] Add Google Fonts `<link>` tags in `app/root.tsx` (alongside existing DM
      Sans preconnect) — combined into single request URL for all three families
  - `Crimson Pro:wght@300;400;600`
  - `Caveat:wght@400;700`
  - Add `font-display=swap` to both
- [x] In `app/styles/tailwind.css` `@theme inline`, add:
  - `--font-serif: 'Crimson Pro', Georgia, serif`
  - `--font-handwritten: 'Caveat', cursive`
  - (Keep existing `--font-sans: 'DM Sans', system-ui, sans-serif`)
- [ ] Verify: `font-serif` and `font-handwritten` utility classes work in dev
      tools
- [ ] **Note:** `font-serif` is already used in 12 files (recipe detail, recipe
      list, landing, inventory, shopping, plan, upgrade, share, etc.). Once the
      variable value changes from the default serif to Crimson Pro, those files
      get it automatically. Later phases should audit those usages for correct
      weights/sizes rather than re-adding the class.

**Files:** `app/root.tsx`, `app/styles/tailwind.css`

### 1C: Animation Curves

Define the five named animation curves as CSS custom properties and Tailwind
utilities so surfaces can reference them by name.

- [x] Add CSS custom properties in `:root` and register in `@theme inline`:
  - `--ease-page-settle: cubic-bezier(0.22, 0.68, 0.35, 1.0)`
  - `--ease-hover-lift: cubic-bezier(0.34, 0.01, 0.21, 1)`
  - `--ease-reveal: cubic-bezier(0.16, 0.85, 0.45, 1)`
  - `--ease-micro: cubic-bezier(0.33, 1, 0.68, 1)`
  - `--ease-exit: cubic-bezier(0.55, 0.0, 0.68, 0.19)`
- [x] Replace existing animation keyframes (`slide-top`, `fade-up`, etc.) with
      updated durations/curves from the design system
- [x] Add a `fade-up-reveal` keyframe that uses `--ease-reveal` at 280ms
      (replaces generic `fade-up`)

**Files:** `app/styles/tailwind.css`

### 1D: Container Width Utilities

Create container variants for the four width tiers so surfaces can use them
directly.

- [x] **Keep the existing `@utility container`** (1400px max) unchanged for now
      — it's used in 37 files and migrating all at once is risky. Instead, add
      four new width-specific utilities alongside it:
  - `.container-narrow` → `max-width: 480px` (shopping list)
  - `.container-content` → `max-width: 880px` (recipe detail, settings)
  - `.container-grid` → `max-width: 1080px` (recipe list, inventory)
  - `.container-landing` → `max-width: 960px` (landing page content)
  - All share: `margin-inline: auto; padding-inline: 1rem` (2rem at `sm`)
- [ ] Each surface phase (2-6) will swap `container` → the appropriate
      width-specific class in the files it touches. Non-redesigned pages keep
      `container` (1400px) until Phase 7 or a future pass.

**Files:** `app/styles/tailwind.css`

### 1E: Shared Components

Create the small reusable pieces referenced across multiple surfaces.

- [x] Create `app/components/page-container.tsx` — thin wrapper that accepts a
      `width` prop (`narrow | content | grid | landing`) and applies the
      corresponding container class
- [x] Create `app/components/divider.tsx` — the hand-drawn SVG horizontal rule.
      A single `<svg>` with a slightly irregular path, rendered at full
      container width, 1px stroke in `sugi` color. Two variants: `subtle`
      (standard section divider) and `accent` (slightly thicker, for recipe
      title underline)
- [x] **No `HandwrittenText` component** — Caveat is used in only 2 places
      (personal recipe notes in Phase 4D, and landing page artifacts in Phase
      2B). Apply `font-handwritten` directly with the appropriate size at each
      call site. A wrapper component for 2 usages would be over-engineering.

**Files:** `app/components/page-container.tsx`, `app/components/divider.tsx`

### 1F: Restyle Shared shadcn/ui Components

Update the existing primitives to match the new design tokens. These are _style
only_ changes — no API or behavior changes.

- [x] `app/components/ui/button.tsx` — update border-radius to use new
      `--radius` values; verify color variants use updated palette correctly;
      reduce shadow to `shadow-rest`
- [x] `app/components/ui/input.tsx` — new radius, warm border color, verify
      focus ring uses matcha
- [x] `app/components/ui/checkbox.tsx` — ensure checked state uses matcha fill;
      size bump to 20px default (24px in cooking contexts is handled
      per-surface)
- [x] `app/components/ui/textarea.tsx` — same treatment as input
- [x] `app/components/ui/sonner.tsx` (Toast) — warm background, subtle shadow,
      verify it uses the updated card/border tokens
- [x] `app/components/ui/dropdown-menu.tsx` — updated shadow + radius. **Also
      fix** `stroke="black"` on the SVG checkmark indicator — replace with
      `stroke="currentColor"` so it works in dark mode.
- [x] `app/components/ui/popover.tsx` — updated shadow + radius

**Files:** `app/components/ui/*.tsx`

### 1G: Header & Navigation

The header is visible on every page. Restyle it to match the new aesthetic
before moving to individual surfaces.

- [x] `app/root.tsx` header: apply `font-serif` to logo text; reduce visual
      weight of nav links (use updated muted/primary colors); update backdrop
      blur/border to use new sugi border color
- [x] `app/components/bottom-nav.tsx`: update active pill color to use matcha
      palette; update icon/text colors to cha/matcha; refine sliding pill
      indicator background
- [x] `app/root.tsx`: update `<meta name="theme-color">` from `#52a868` to
      `#4E7A54` (matcha) — affects browser chrome color on mobile
- [ ] Verify: header looks correct on all pages in light + dark mode, mobile +
      desktop

**Files:** `app/root.tsx`, `app/components/bottom-nav.tsx`

### Phase 1 Definition of Done

- [x] Dev server runs without errors
- [x] `npm run typecheck` passes
- [ ] Spot-check 5+ pages in light mode — palette is warm/earthy, text is
      readable
- [ ] Spot-check same pages in dark mode — no broken contrast, mood is "midnight
      kitchen"
- [ ] Fonts load correctly (Crimson Pro, Caveat visible in DevTools Network tab)
- [ ] Commit with descriptive message, wait for review

---

## Phase 2: Landing Page — "The First Page of a Journal"

Complete redesign of `app/routes/_marketing/index.tsx`. This is the first
impression.

### 2A: Hero Section

- [ ] Replace current hero content with the single-question design:
  - Crimson Pro 300 (decorative), `text-[2.5rem] md:text-[3.5rem]`
  - _"What are we making this week?"_
  - Subtitle in DM Sans, cha color
  - Two CTAs: "Start cooking" (matcha primary) + "See how it works" (ghost)
- [ ] Full viewport height (`min-h-svh`), vertically centered, generous
      breathing room
- [ ] Subtle entrance animation: hero text fades in with page-settle curve,
      320ms

### 2B: Artifacts Section

- [ ] Build three static artifact components (inline in the route file or
      extracted if large):
  1. **Recipe card artifact** — styled card at 2° rotation with shadow, showing
     a sample recipe title (Crimson Pro), a few ingredients, a placeholder image
     area
  2. **Week view artifact** — 7-day row with a few meal names in Caveat,
     checkbox-style marks
  3. **Shopping list artifact** — narrow card with items, some struck through,
     torn-paper-edge effect (clip-path or SVG border)
- [ ] Each artifact fades up on scroll (IntersectionObserver or CSS
      `animation-timeline: view()` if supported, with JS fallback)
- [ ] Staggered left-right-left positioning on desktop; stacked centered on
      mobile
- [ ] Use `container-landing` (960px max)

### 2C: Closing Section

- [ ] "Your recipes deserve a home." in Crimson Pro 400
- [ ] Single CTA button
- [ ] Generous vertical padding (64-80px above/below)

### 2D: Cleanup

- [ ] Remove old feature grid sections, "Built for Kitchen" grid, old hero
      gradient
- [ ] Preserve: JSON-LD schema, meta tags, `getUserId` redirect logic, sitemap
      export
- [ ] Responsive check at 375px, 768px, 1280px
- [ ] Dark mode check (artifacts should still feel warm)

### Phase 2 Definition of Done

- [ ] Landing page feels quiet, confident, and distinct from a SaaS template
- [ ] All three artifacts render correctly at mobile + desktop
- [ ] No layout shifts during scroll animations
- [ ] JSON-LD and meta tags intact
- [ ] Commit, wait for review

**Files:** `app/routes/_marketing/index.tsx`

---

## Phase 3: Recipe List — "The Recipe Box"

Redesign recipe browsing in `app/routes/recipes/index.tsx` and
`app/components/recipe-card.tsx`.

### 3A: Recipe Card Redesign

- [ ] `app/components/recipe-card.tsx` — Restructure the card:
  - **With photo**: 4/3 aspect image with 1px sugi border, 6px radius. Title in
    `font-serif font-semibold` (Crimson Pro 600). Cook time caption in cha
    color. Reduce badge visual weight (smaller, less saturated).
  - **Without photo**: shorter card, no forced image area. Larger serif title.
    Subtle initial-letter motif using existing `getRecipePlaceholder()` logic
    but with serif font and lighter color
  - **Hover**: 2px lift via `shadow-hover`, border warms
    (`hover:border-accent/20`), image scales 1.02x. Use `--ease-hover-lift`
    180ms.
  - Match ring: keep but reduce visual weight (smaller size, lower opacity
    background)
- [ ] `app/components/recipe-card.tsx` — Add a `variant` prop: `'card' | 'row'`
  - `card` = current vertical layout (desktop grid)
  - `row` = horizontal layout for mobile (64px square photo left, content right)

### 3B: Grid & Layout

- [ ] `app/routes/recipes/index.tsx` — Replace `RecipeCardGrid` usage:
  - Mobile (`< md`): single-column list using `row` variant, 16px gap
  - Desktop (`md`): 2-column grid, `lg`: 3-column grid, using `card` variant
  - Grid uses `items-start` (not `items-stretch`) to allow natural height
    variation
- [ ] Wrap content in `container-grid` (1080px max)
- [ ] Page title in `font-serif` (Crimson Pro 400)

### 3C: Search & Filters

- [ ] Restyle search input: warm background, DM Sans placeholder _"Search
      recipes..."_
- [ ] Restyle filter chips: kinari background, rounded-full, cha text, smaller
      size. Active state: matcha background with primary-foreground text
- [ ] Result count + clear link: cha color, understated

### 3D: Recipe Placeholders

- [ ] `app/utils/recipe-placeholder.ts` — Replace the 6 hardcoded Tailwind
      color themes (`bg-orange-50`, `text-emerald-400`, etc.) with colors from
      the design system palette. Use warm, muted tones derived from the material
      palette (e.g., variations on kinari, sugi, kawa) instead of the current
      rainbow of orange/emerald/amber/rose/sky/purple. The initial letter should
      use `font-serif` for the serif motif described in the design system.

### 3E: Empty & Onboarding States

- [ ] `app/components/getting-started-checklist.tsx` — restyle with warm
      palette, DM Sans (no Caveat), dashed border empty-state pattern
- [ ] Match empty state: warm messaging, no handwritten font

### Phase 3 Definition of Done

- [ ] Recipe cards feel like index cards, not SaaS cards
- [ ] Mobile row layout is scannable and tappable at 375px
- [ ] Desktop grid has natural height variation (visible with mix of
      photo/no-photo recipes)
- [ ] Search and filters feel warm, not clinical
- [ ] `npm run typecheck` passes
- [ ] Commit, wait for review

**Files:** `app/components/recipe-card.tsx`, `app/routes/recipes/index.tsx`,
`app/components/getting-started-checklist.tsx`,
`app/components/match-progress-ring.tsx`

---

## Phase 4: Recipe Detail — "The Open Cookbook"

The soul of the app. Redesign `app/routes/recipes/$recipeId.tsx` and its
sub-components.

### 4A: Hero Area

- [ ] `app/routes/recipes/$recipeId.tsx` — Recipe title in `font-serif` Crimson
      Pro 400, `text-[2.25rem]`
- [ ] Add `<Divider variant="accent" />` below title
- [ ] `app/components/recipe-metadata-card.tsx` — restyle: remove card border,
      display as inline text row in cha color. Prep/cook/total time + source URL
      as a quiet metadata line, not a card.
- [ ] Image: on desktop, position beside title area at up to 400px width. 1px
      sugi border, 6px radius. On mobile, full-width below title with 16px
      horizontal margin.
- [ ] Wrap in `container-content` (880px max)

### 4B: Ingredients List

- [ ] `app/components/recipe-ingredient-list.tsx`:
  - Line spacing 1.7, amounts in `font-medium`
  - Heading rows (`isHeading`): `font-serif` small-caps with subtle underline
  - Checkboxes bumped to 24px, matcha fill when checked
  - Checked items: 40% opacity + line-through in cha color
  - Desktop: sticky column (`md:sticky md:top-20`)

### 4C: Instructions List

- [ ] `app/components/recipe-instructions-list.tsx`:
  - Step numbers in `font-serif` Crimson Pro 400, oversized (1.5rem), cha color
  - Step text in DM Sans, line-height 1.75, 24px bottom margin between steps
  - Checked steps: 40% opacity + subtle line-through
  - Mobile: base font bumped to 17px (`text-[1.0625rem]`)

### 4D: Personal Notes

- [ ] Notes section in `$recipeId.tsx`:
  - **Has notes**: left border 3px kawa, warm background (`bg-accent/5`), text
    in `font-handwritten` (Caveat 400), 1.125rem
  - **Empty state**: dashed border, DM Sans prompt _"Add your notes..."_ in cha
    color (Caveat appears only after notes are written)

### 4E: Action Bar & Cooking Mode

- [ ] `app/components/recipe-action-bar.tsx`:
  - Mobile floating bar: kinari background, `shadow-elevated`, rounded corners
  - "I Made This" as primary action in matcha
  - Serving scaler: simple +/- stepper styling
- [ ] `app/components/recipe-i-made-this-modal.tsx` — warm palette, updated
      button colors
- [ ] Cooking log entries: `app/components/recipe-cooking-log-entry.tsx` —
      restyle with cha color metadata

### Phase 4 Definition of Done

- [ ] Recipe page feels like a cookbook spread, not a database record
- [ ] Title in serif is readable at arm's length on mobile (17px+ body text)
- [ ] Ingredients + instructions two-column layout works on desktop, stacks
      cleanly on mobile
- [ ] Personal notes in Caveat look like margin annotations, not gimmicky
- [ ] Print view (`Ctrl+P`) still produces a clean output
- [ ] `npm run typecheck` passes
- [ ] Commit, wait for review

**Files:** `app/routes/recipes/$recipeId.tsx`,
`app/components/recipe-ingredient-list.tsx`,
`app/components/recipe-instructions-list.tsx`,
`app/components/recipe-metadata-card.tsx`,
`app/components/recipe-action-bar.tsx`,
`app/components/recipe-i-made-this-modal.tsx`,
`app/components/recipe-cooking-log-entry.tsx`,
`app/routes/share.$recipeId.tsx` (public share page — mirrors recipe detail
styling)

---

## Phase 5: Meal Plan — "The Week Ahead"

Redesign `app/routes/plan/index.tsx`.

### 5A: Mobile Layout

- [ ] Vertical day stack: each day is a row, no forced equal-height cards
- [ ] Day name in `font-serif` Crimson Pro 600
- [ ] Today: kawa underline, slightly larger text, warm background
      (`bg-accent/5`)
- [ ] Past days: 80% opacity. Future days: full contrast
- [ ] Empty days: muted DM Sans _"Nothing planned"_ + ghost `+` button
- [ ] Meal entries: DM Sans, 32px circular recipe thumbnails

### 5B: Desktop Layout

- [ ] Compact 7-day grid (`grid-cols-7` at `lg`, `grid-cols-4` + `grid-cols-3`
      rows at `md`)
- [ ] Each day: warm shiro card, natural height variation, generous internal
      padding (20px), Crimson Pro day header
- [ ] Today's card: subtle kawa top-border (`border-t-2 border-accent`)
- [ ] Cards feel like index cards on a table, not calendar cells — warm shadows,
      rounded corners, warm border on hover

### 5C: Tonight Banner

- [ ] Redesign as warm card: subtle gradient (washi → kinari)
- [ ] Has meal: recipe photo, time, "Let's cook" link
- [ ] Empty: DM Sans suggestion with recipe from favorites
- [ ] Applies to current-week view only

### 5D: Interactions

- [ ] Recipe selector (`app/components/recipe-selector.tsx`): warm styling
      consistent with the new palette
- [ ] Add-recipe animation: element-reveal curve (280ms fade-in)
- [ ] Week navigation: restyle date range display in Crimson Pro
- [ ] Action buttons (Save Template, Copy Week, etc.): updated button styles

### Phase 5 Definition of Done

- [ ] Desktop: whole week visible at a glance, styled as index cards
- [ ] Mobile: vertical stack scrolls naturally, today is visually prominent
- [ ] Tonight banner feels like a friendly nudge
- [ ] Adding a recipe feels like penciling it in (subtle animation)
- [ ] `npm run typecheck` passes
- [ ] Commit, wait for review

**Files:** `app/routes/plan/index.tsx`, `app/components/recipe-selector.tsx`,
`app/components/meal-slot-card.tsx`, `app/components/today-banner.tsx`,
`app/components/template-modal.tsx`

---

## Phase 6: Shopping List — "The Scrap of Paper"

Redesign `app/routes/shopping.tsx`.

### 6A: Layout & Container

- [ ] Wrap content in `container-narrow` (480px max)
- [ ] Page title in `font-serif` Crimson Pro 400

### 6B: Item Styling

The main item UI lives in `app/components/shopping-list-item.tsx`
(ShoppingListItemCard), not in the route file itself.

- [ ] `app/components/shopping-list-item.tsx` — restyle the item card:
  - Checkboxes: 24px, matcha fill when checked
  - Item name: DM Sans 16px, quantity/unit as subtle caption
  - Checked items: 2px line-through in cha color, 50% opacity. Animated
    left-to-right (200ms, `--ease-micro`)
  - Generous vertical padding (16px per item) for easy touch targets
  - Inline edit mode: warm input styling consistent with quick-add
  - Delete double-check: warm destructive styling
- [ ] Category headers: DM Sans 12px, uppercase, `tracking-wider`, hai color.
      32px space above, 12px below.

### 6C: Quick Add

- [ ] Restyle input: bottom-border only (no full border), DM Sans placeholder
      _"Add an item..."_
- [ ] Ghost `+` icon button at right edge for discoverability
- [ ] Preserve existing duplicate-check warning logic, just restyle the warning
      banner

### 6D: Checked Item Actions & Inventory Review

- [ ] "Add to Inventory" / "Clear Checked" as understated text-style
      links/buttons
- [ ] Appear with subtle slide-up animation when checked items exist
- [ ] `app/components/shopping-list-to-inventory.tsx` (ShoppingListToInventory)
      — restyle the review panel: location badges, expiry date pickers, expand/
      collapse rows, select-all toggle. Warm palette, consistent with new card
      and input styling.

### 6E: Low Stock & Generate

- [ ] Restyle low-stock nudge banner: warm amber tones, updated button styles
- [ ] Restyle generate button / week selector: consistent with new palette

### 6F: Print View

- [ ] Verify print styles still produce a clean single-column list
- [ ] Unicode checkboxes (☐/☑), compact spacing
- [ ] Minimal branding at bottom

### Phase 6 Definition of Done

- [ ] Shopping list feels narrow, focused, and tactile
- [ ] Checking off items is satisfying (animation + opacity shift)
- [ ] Quick-add is discoverable on mobile (visible submit button)
- [ ] Print produces a clean, usable list
- [ ] `npm run typecheck` passes
- [ ] Commit, wait for review

**Files:** `app/routes/shopping.tsx`, `app/components/shopping-list-item.tsx`,
`app/components/shopping-list-to-inventory.tsx`

---

## Phase 7: Polish & Cross-Cutting QA

Final pass across all surfaces after the five phase implementations.

### 7A: Dark Mode Audit

- [ ] Walk through every redesigned surface in dark mode
- [ ] Verify contrast ratios on cha-dark text (`#9A8E80`) against sumi-dark bg
      (`#1A1816`) — should be ~5.5:1
- [ ] Verify matcha-dark (`#7FA085`) on sumi-dark — should be ~6.3:1
- [ ] Fix any broken contrast or color mismatches

### 7B: Accessibility Check

- [ ] Run axe-core or Lighthouse accessibility audit on each surface
- [ ] Verify all interactive elements have visible focus indicators (ring in
      matcha)
- [ ] Verify heading hierarchy is correct after serif font changes
- [ ] Screen reader test on recipe detail page (the most complex surface)

### 7C: Responsive Spot-Check

- [ ] Test each surface at: 375px (iPhone SE), 390px (iPhone 15), 768px (iPad),
      1280px, 1920px
- [ ] Verify container widths feel appropriate at each breakpoint
- [ ] Bottom nav still works correctly with updated styling
- [ ] No horizontal overflow or text truncation issues

### 7D: Performance

- [ ] Verify font loading: no FOIT, swap works correctly
- [ ] Check total font payload in DevTools Network tab (~60KB woff2 target)
- [ ] Animations respect `prefers-reduced-motion: reduce`
- [ ] No layout shifts from font loading (CLS score)

### 7E: Existing Feature Verification

Ensure non-redesigned surfaces still work with the new palette:

- [ ] Inventory page (`app/routes/inventory/`)
- [ ] Settings pages (`app/routes/settings/`)
- [ ] Recipe create/edit (`app/routes/recipes/new.tsx`, `$recipeId_.edit.tsx`)
- [ ] Recipe form (`app/components/recipe-form.tsx`) — ingredient DnD, image
      upload
- [ ] Auth pages (`app/routes/_auth/`) — login, signup, onboarding
- [ ] Share page (`app/routes/share.$recipeId.tsx`)
- [ ] Timer widget (`app/components/timer-widget.tsx`)
- [ ] Enhance recipe modal (`app/components/enhance-recipe-modal.tsx`)
- [ ] Inline temperature (`app/components/inline-temperature.tsx`)
- [ ] Pantry staples onboarding (`app/components/pantry-staples-onboarding.tsx`)
- [ ] Notification bell (`app/components/notification-bell.tsx`)
- [ ] User dropdown (`app/components/user-dropdown.tsx`)
- [ ] Toasts and modals across the app

### Phase 7 Definition of Done

- [ ] All five surfaces pass dark mode + accessibility + responsive checks
- [ ] Non-redesigned pages look coherent with the new palette (no jarring
      mismatches)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (unit tests)
- [ ] Commit final polish, wait for review
