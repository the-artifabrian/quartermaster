# UI/UX Redesign: Warm & Cozy Quartermaster

## Context

Quartermaster is functional and feature-complete, but visually it looks like a developer tool — cold dark sage green, system fonts, flat layouts, loud gradient placeholders. Before monetization (Phase 14), the app needs to look like something worth paying for. The redesign shifts to a **warm light mode** with **cozy cookbook vibes**: cream backgrounds, friendly serif headings, soft rounded corners, warm shadows, and more generous spacing. Dark mode remains as a secondary option.

## Design Direction

- **Theme**: Warm light mode primary (cream/warm white), warm dark mode secondary
- **Typography**: Fraunces (serif, variable) for headings, DM Sans for body
- **Colors**: Warm olive-sage primary (shifted from cold mint), golden amber accent (promoted from underused peach), cream backgrounds
- **Shape**: Larger border radius (12px base), warm-tinted shadows, pill-style navigation
- **Feel**: Like a well-designed cookbook — approachable, inviting, tactile

---

## Phase 1: Foundation — Colors, Typography, Shadows (3 files)

Everything depends on this phase. After it lands, the entire app will already feel warmer.

### 1A. Color System Overhaul

**File: `app/styles/tailwind.css`**

**Critical fix first**: Line 227 `border-color: hsl(var(--border))` is wrong — colors are OKLch. Change to `border-color: var(--color-border);`

Replace `:root` and `.dark` color blocks. Key shifts:
- Background hue: 120→75 (cool gray→warm cream)
- Primary hue: 155→145 (cold mint sage→warm olive sage)
- Accent hue: 45→65 (underused peach→prominent golden amber)
- All neutral hues shift to 55-75 range (warm grays/browns instead of cool greens)

**Light mode `:root`** values:
```
--background: oklch(97.5% 0.008 75)       /* warm cream */
--foreground: oklch(20% 0.015 55)          /* warm near-black */
--card: oklch(99.5% 0.004 75)              /* warm white */
--primary: oklch(45% 0.10 145)             /* warm olive sage */
--primary-foreground: oklch(98% 0.005 75)
--secondary: oklch(93% 0.02 75)            /* warm beige */
--muted: oklch(94% 0.01 75)
--muted-foreground: oklch(50% 0.03 55)
--accent: oklch(72% 0.14 70)               /* golden amber */
--accent-foreground: oklch(20% 0.015 55)
--border: oklch(90% 0.01 75)
--ring: oklch(45% 0.10 145)
```

**Dark mode `.dark`** values (warm charcoal, not cold green):
```
--background: oklch(18% 0.01 55)
--foreground: oklch(93% 0.008 75)
--card: oklch(22% 0.012 55)
--primary: oklch(62% 0.10 145)             /* lighter olive for contrast */
--secondary: oklch(28% 0.02 55)
--muted: oklch(25% 0.01 55)
--accent: oklch(65% 0.12 70)
--border: oklch(30% 0.01 55)
```

Bump base radius: `--radius: 0.75rem` (was 0.5rem)

Add warm shadow custom properties in `:root`:
```
--shadow-warm: 0 1px 3px oklch(20% 0.01 55 / 0.08), 0 1px 2px oklch(20% 0.01 55 / 0.06);
--shadow-warm-md: 0 4px 6px oklch(20% 0.01 55 / 0.07), 0 2px 4px oklch(20% 0.01 55 / 0.06);
--shadow-warm-lg: 0 10px 15px oklch(20% 0.01 55 / 0.07), 0 4px 6px oklch(20% 0.01 55 / 0.05);
```

Register shadows in `@theme inline` block as:
```
--shadow-warm: 0 1px 3px oklch(20% 0.01 55 / 0.08), 0 1px 2px oklch(20% 0.01 55 / 0.06);
--shadow-warm-md: 0 4px 6px oklch(20% 0.01 55 / 0.07), 0 2px 4px oklch(20% 0.01 55 / 0.06);
--shadow-warm-lg: 0 10px 15px oklch(20% 0.01 55 / 0.07), 0 4px 6px oklch(20% 0.01 55 / 0.05);
```
This enables `shadow-warm`, `shadow-warm-md`, `shadow-warm-lg` as Tailwind utility classes.

Add `fade-up` keyframe animation in `@theme` block:
```
--animate-fade-up: fade-up 0.4s ease-out;

@keyframes fade-up {
  from {
    transform: translateY(8px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
```

Add base layer rule for serif headings:
```css
@layer base {
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-serif);
  }
}
```

### 1B. Typography — Google Fonts

**File: `app/root.tsx`**

Add to `links` export (before stylesheet):
- Preconnect to `fonts.googleapis.com` and `fonts.gstatic.com`
- Stylesheet: `Fraunces:ital,opsz,wght@0,9..144,300..900` + `DM+Sans:opsz,wght@9..40,300..700` with `display=swap`

**File: `app/styles/tailwind.css`**

Add in `@theme` block:
```
--font-sans: 'DM Sans', system-ui, sans-serif;
--font-serif: 'Fraunces', Georgia, serif;
```

### 1C. shadcn config

**File: `components.json`** — Change `baseColor` from `"slate"` to `"stone"`.

---

## Phase 2: Base Component Restyling (9 files)

All pages use these — restyling them transforms everything at once.

### 2A. Button — `app/components/ui/button.tsx`
- `rounded-md` → `rounded-lg` everywhere
- `transition-colors` → `transition-all duration-200`
- Default variant: add `shadow-warm hover:shadow-warm-md active:scale-[0.98]`
- Outline variant: `hover:bg-accent/10 hover:border-accent/50`
- Ghost variant: `hover:bg-accent/10`

### 2B. Input — `app/components/ui/input.tsx`
- `rounded-md` → `rounded-lg`
- Add `transition-all duration-200 hover:border-muted-foreground/30`
- Warm focus: `focus-visible:border-accent focus-visible:ring-accent/20`

### 2C. Textarea — `app/components/ui/textarea.tsx`
- Same changes as Input

### 2D. Dropdown Menu — `app/components/ui/dropdown-menu.tsx`
- Content: `rounded-md` → `rounded-xl`, add `shadow-warm-lg`
- Items: `rounded-sm` → `rounded-lg`, `focus:bg-accent` → `focus:bg-accent/10`

### 2E. Forms wrapper — `app/components/forms.tsx`
- ErrorList: `text-[10px]` → `text-xs` for readability

### 2F. Sonner toaster — `app/components/ui/sonner.tsx`
- Toast class: add `rounded-xl shadow-warm-lg`

### 2G. Checkbox — `app/components/ui/checkbox.tsx`
- Slightly rounder, use primary color for check state

### 2H. Tooltip — `app/components/ui/tooltip.tsx`
- Add `rounded-lg shadow-warm`

### 2I. Input OTP — `app/components/ui/input-otp.tsx`
- `first:rounded-l-md` → `first:rounded-l-lg`, `last:rounded-r-md` → `last:rounded-r-lg`

---

## Phase 3: Navigation & Shell Redesign (5 files)

### 3A. Header & Navigation — `app/root.tsx`
- **Sticky header**: wrap in `bg-card/80 backdrop-blur-sm border-b border-border/50 sticky top-0 z-40`
- **Logo**: Change `text-primary` to `text-foreground`, add `font-serif italic` to "Quartermaster"
- **Desktop nav**: Replace underline active state with pill background. Active: `bg-primary/10 text-primary rounded-full px-4 py-1.5`. Inactive: `text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full px-4 py-1.5`
- **Theme switch**: Move into user dropdown or footer (declutter bottom area)

### 3B. Bottom Nav (mobile) — `app/components/bottom-nav.tsx`
- `bg-background` → `bg-card/95 backdrop-blur-sm`
- Add subtle top shadow
- Active indicator: pill background `bg-primary/10 rounded-xl` instead of top bar

### 3C. User Dropdown — `app/components/user-dropdown.tsx`
- Trigger: `bg-card border border-border/50 rounded-full shadow-warm hover:bg-muted/50`
- Avatar: add `ring-2 ring-accent/20`

### 3D. Notification Bell — `app/components/notification-bell.tsx`
- Badge: `bg-accent text-accent-foreground` (warm, not destructive red)
- Dropdown: `rounded-xl shadow-warm-lg`
- Unread items: `bg-accent/5` instead of `bg-accent/50`

### 3E. Page Header Pattern (multiple route files)
Replace `bg-muted/30` header background across all pages with:
```
bg-gradient-to-b from-card to-background border-b border-border/50
```
Affects: `recipes/index.tsx`, `inventory/index.tsx`, `plan/index.tsx`, `discover/index.tsx`, `plan/shopping-list.tsx`, `plan/prep-list.tsx`

---

## Phase 4: Page-Level Layout Redesigns (14 files)

### 4A. Recipe Cards — `app/components/recipe-card.tsx`, `recipe-match-card.tsx`
- **Kill loud gradients**: Replace 10 vibrant gradient pairs with warm muted ones (`from-secondary to-muted`). Large serif initial letter in `text-accent/40` instead of bold white.
- Card: `ring-1` → `border border-border/60 shadow-warm`, `rounded-lg` → `rounded-xl`
- Hover: `hover:shadow-warm-md hover:-translate-y-0.5 transition-all duration-200`
- Content area: `p-4` → `p-5`
- Tag pills: `bg-accent/10 text-accent-foreground border border-accent/20 rounded-full`
- Match badges (match card): keep color coding but use warmer tones

### 4B. Recipe List — `app/routes/recipes/index.tsx`
- Search/filter area: `bg-card border border-border/50 shadow-warm rounded-2xl`
- Tag pills — selected: `bg-accent text-accent-foreground shadow-sm`; unselected: `bg-card border border-border hover:border-accent/50`
- Time dropdown: style with `rounded-lg bg-card`

### 4C. Recipe Detail — `app/routes/recipes/$recipeId.tsx` (biggest overhaul)
- **Hero layout**: Move image above title, `aspect-[2/1]` wider hero, `rounded-2xl` on desktop
- **Title**: `text-4xl font-serif tracking-tight`
- **Action bar**: Wrap Favorite/I Made This/Keep Awake/Edit in a floating pill bar: `bg-card/90 backdrop-blur-sm rounded-full border shadow-warm inline-flex gap-1`. Icon-only on mobile, icon+text on desktop.
- **Meta info**: `bg-card border rounded-2xl shadow-warm` with `text-accent` icons for servings/prep/cook time
- **Ingredients panel**: `bg-card border rounded-2xl shadow-warm p-6`. Items as `rounded-lg hover:bg-accent/5`. Replace bullets with small `text-accent` dots.
- **Instruction steps**: Numbered circles → `bg-accent/10 text-accent border border-accent/20` (checked: `bg-muted line-through`). More vertical spacing.
- **Tags**: bordered pill style `bg-accent/10 border border-accent/20 rounded-full`
- **Cook log & history**: `bg-card rounded-2xl border shadow-warm`

### 4D. Inventory — `app/routes/inventory/index.tsx`, `inventory-item-card.tsx`, `inventory-location-tabs.tsx`
- **Cards**: Replace `border-l-4` colored left border with full warm card (`bg-card rounded-xl border shadow-warm`). Location shown as colored badge: `bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200 rounded-full px-2 py-0.5 text-xs`
- **Status badges**: Warm-tinted with dark mode — "Low": `bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200`, "Expired": `bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200`
- **Location tabs**: Pill-style segmented control: `bg-muted rounded-full p-1 inline-flex`. Active: `bg-primary text-primary-foreground rounded-full shadow-sm`
- **Section headers**: Add `font-serif`

### 4E. Meal Plan — `app/routes/plan/index.tsx`, `meal-plan-calendar.tsx`, `meal-slot-card.tsx`, `meal-plan-waste-alerts.tsx`
- **Grid**: Add `gap-2 p-2` for breathing room
- **Today column**: `bg-accent/5 ring-1 ring-accent/20 rounded-xl`
- **Day headers**: Today gets `bg-accent/10 rounded-full px-3 py-1`
- **Meal type headers**: Color-coded warmly — Breakfast: `bg-amber-50/80 text-amber-800 dark:bg-amber-950/80 dark:text-amber-200`, Lunch: `bg-green-50/80 text-green-800 dark:bg-green-950/80 dark:text-green-200`, Dinner: `bg-orange-50/80 text-orange-800 dark:bg-orange-950/80 dark:text-orange-200`, Snack: `bg-purple-50/80 text-purple-800 dark:bg-purple-950/80 dark:text-purple-200`
- **Empty slots**: `bg-muted/30 border-dashed hover:bg-accent/5 hover:border-accent/40 rounded-xl`
- **Week nav arrows**: `bg-card rounded-full border shadow-warm`
- **Waste alerts**: Update `bg-muted/30` container to warm card style

### 4F. Discover — `app/routes/discover/index.tsx`
- "Use It Before You Lose It" section: `bg-accent/5 rounded-2xl p-6 border border-accent/10`
- Stats numbers: `font-serif font-bold text-lg`
- Filter toggle when active: `bg-accent text-accent-foreground`

### 4G. Landing Page — `app/routes/_marketing/index.tsx` (full overhaul)
- **Hero**: Much larger heading `text-5xl md:text-6xl xl:text-7xl font-serif`. Warm subtitle color. CTA: `size="lg" rounded-full px-8 shadow-warm-md` with arrow icon
- **Feature cards**: `bg-card rounded-2xl border shadow-warm hover:shadow-warm-md hover:-translate-y-1 transition-all duration-300 p-8`. Icons: `text-accent`
- **How It Works**: Numbered circles `bg-accent/10 text-accent`. Add connecting vertical line between steps.
- **Final CTA**: Warm gradient panel `bg-gradient-to-r from-primary/5 to-accent/5 rounded-3xl p-12`

### 4H. Settings — `app/routes/settings/profile/index.tsx`
- Group links into card sections (Account, Household, Connections, Data, Danger Zone)
- Each group: `bg-card rounded-xl border shadow-warm p-4`
- Each link: `rounded-lg px-4 py-3 hover:bg-accent/5`
- Profile photo: `ring-4 ring-accent/20`

### 4I. Shopping List — `app/routes/plan/shopping-list.tsx`, `shopping-list-item.tsx`
- Form card: `rounded-2xl border-border/50 shadow-warm`
- Category headers: `font-serif capitalize` instead of `uppercase text-muted-foreground`
- Checkbox: accent color when checked `border-accent bg-accent`
- Checked item text: `text-muted-foreground/60` gentler strikethrough

### 4J. Recipe Form — `app/components/recipe-form.tsx`, `ingredient-fields.tsx`
- Section cards: `bg-card rounded-2xl border-border/50 shadow-warm`
- Section headings: `font-serif`
- Tag pills: selected `bg-accent text-accent-foreground shadow-sm`
- Photo upload: `border-2 border-dashed border-border/60 bg-muted/30`
- Ingredient rows: Replace `bg-muted/30` zebra striping with `bg-muted/20` for warmer tone

### 4K. Pantry Onboarding — `app/components/pantry-staples-onboarding.tsx`
- Wrap in `bg-card rounded-2xl border shadow-warm`
- Section titles: `font-serif`

---

## Phase 5: Micro-Interactions & Polish (across all changed files)

### 5A. Hover & Transitions
- All cards: `hover:-translate-y-0.5 transition-all duration-200` (subtle lift)
- All buttons: `active:scale-[0.98]` (tactile press)
- Tag pills: `transition-all duration-150`
- Nav links: `transition-all duration-200`

### 5B. Empty States (all route files)
- Icon container: `bg-accent/10 rounded-2xl` (was `bg-muted/50 rounded-full`)
- Icon color: `text-accent/50` (was `text-muted-foreground`)
- Heading: `font-serif`
- Add `animate-fade-up` for gentle entrance

### 5C. Cooking Timer — `app/components/cooking-timer.tsx`
- Timer display: `font-serif tabular-nums`
- Container: `bg-card rounded-2xl shadow-warm-lg border`
- Alarm: `ring-2 ring-accent animate-pulse`

### 5D. Progress Bar — `app/components/progress-bar.tsx`
- Color: accent instead of primary (warm loading indicator)

---

## Files Summary (~35 files)

| Phase | Files |
|-------|-------|
| 1 (Foundation) | `tailwind.css`, `root.tsx`, `components.json` |
| 2 (Components) | `button.tsx`, `input.tsx`, `textarea.tsx`, `dropdown-menu.tsx`, `forms.tsx`, `sonner.tsx`, `checkbox.tsx`, `tooltip.tsx`, `input-otp.tsx` |
| 3 (Navigation) | `root.tsx`, `bottom-nav.tsx`, `user-dropdown.tsx`, `notification-bell.tsx`, + page headers in 6 route files |
| 4 (Pages) | `recipe-card.tsx`, `recipe-match-card.tsx`, `recipes/index.tsx`, `recipes/$recipeId.tsx`, `inventory/index.tsx`, `inventory-item-card.tsx`, `inventory-location-tabs.tsx`, `plan/index.tsx`, `meal-plan-calendar.tsx`, `meal-slot-card.tsx`, `meal-plan-waste-alerts.tsx`, `discover/index.tsx`, `_marketing/index.tsx`, `settings/profile/index.tsx`, `plan/shopping-list.tsx`, `shopping-list-item.tsx`, `recipe-form.tsx`, `ingredient-fields.tsx`, `pantry-staples-onboarding.tsx` |
| 5 (Polish) | `cooking-timer.tsx`, `progress-bar.tsx`, + touch-ups across Phase 4 files |

## Implementation Notes

1. **Phase ordering is critical.** Phase 1 must go first — every file references the CSS custom properties. Phases 2-3 can run in parallel. Phase 4 depends on 2-3. Phase 5 is polish applied during or after Phase 4.
2. **Test after Phase 1.** Just swapping colors+fonts will already transform the app. Check both light and dark modes, verify WCAG AA contrast.
3. **Font loading**: ~80KB total with `display=swap`. Preconnect links minimize flash.
4. **No schema/API changes.** This is purely visual — all Prisma queries, loaders, actions, and Conform forms stay untouched.
5. **Print styles**: Verify shopping list `print:` variants still work after warm styling.
6. **Color tuning**: The specific OKLch values may need visual tweaking once rendered. The hue directions (75 for warm neutrals, 145 for warm olive sage, 70 for golden amber) are the important anchors.

## Verification

After each phase:
- `npm run dev` — visual inspection across all major pages in both themes
- `npm run typecheck` — no type errors from template changes
- `npm run lint` — no lint issues
- `npm test` — existing 291 tests pass (no logic changes)
- Manual check: light mode, dark mode, mobile responsive, print view for shopping list
