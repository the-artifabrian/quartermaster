# Design System

Visual reference: typography, color, spacing, components, per-surface layouts.
For product voice and copy, see [COPYWRITING.md](./COPYWRITING.md). For product
direction and UX principles, see [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md).

## Context

Primary use is cooking: phone propped on the counter, hands busy. Tap targets
≥44px, body text ≥16px, interactions work one-handed. Hover is polish; tap is
the design.

## Distinctive Elements

1. **Young Serif titles on every recipe.** Since most recipes have no photos,
   the titles carry the visual identity.
2. **Ingredient check-off.** CSS `line-through` with
   `decoration-2 decoration-muted-foreground/60` and text fade to 50% opacity. A
   pen-stroke `scaleX` animation was prototyped and dropped — not readable at
   arm's length.

---

## Typography

Three faces:

**Young Serif** (400 only): headings, recipe titles. Differentiate by size, not
weight — never apply `font-semibold`, `font-bold`, or `font-light` to
`font-serif` elements. Loaded via Google Fonts.

**DM Sans** (300–700): body text, labels, metadata, navigation, all functional
UI.

**Caveat** (400, 700): personal recipe notes and landing-page artifacts only.
Represents the user's voice, not the app's. Loaded via Google Fonts.

### Type Scale

| Use                      | Font        | Size             | Line height | Letter spacing |
| ------------------------ | ----------- | ---------------- | ----------- | -------------- |
| Landing hero             | Young Serif | 2.5rem (40px)    | 1.2         | -0.02em        |
| Page title               | Young Serif | 2.25rem (36px)   | 1.15        | -0.02em        |
| Recipe detail title      | Young Serif | 2rem (32px)      | 1.15        | -0.02em        |
| Section heading          | Young Serif | 1.5rem (24px)    | 1.3         | -0.01em        |
| Recipe card title (grid) | Young Serif | 1.125rem (18px)  | 1.3         | -0.005em       |
| Recipe card title (list) | Young Serif | 1rem (16px)      | 1.4         | 0              |
| Ingredient amount/unit   | DM Sans 400 | 1rem (16px)      | 1.65        | 0              |
| Body text                | DM Sans 400 | 1rem (16px)      | 1.65        | 0              |
| Small body               | DM Sans 400 | 0.875rem (14px)  | 1.5         | 0              |
| UI label                 | DM Sans 500 | 0.875rem (14px)  | 1.4         | 0              |
| Caption/meta             | DM Sans 400 | 0.8125rem (13px) | 1.45        | 0              |
| Tiny label               | DM Sans 500 | 0.75rem (12px)   | 1.3         | 0              |
| Recipe personal note     | Caveat 400  | 1.125rem (18px)  | 1.4         | 0              |
| Landing artifact label   | Caveat 700  | 1.25rem (20px)   | 1.35        | 0              |

Recipe detail title is intentionally larger than other page titles for
arm's-length readability. Ingredient amounts use DM Sans (serif amounts looked
too heavy on mobile).

---

## Color Palette

Material origins, not brand colors.

| Name      | Hex       | Origin        | Role                                   |
| --------- | --------- | ------------- | -------------------------------------- |
| Cream     | `#F6F1EB` | Aged paper    | Page background                        |
| Paper     | `#FDFAF6` | Clean paper   | Card surfaces, elevated areas          |
| Ink       | `#2D2926` | Writing ink   | Primary text                           |
| Stone     | `#6F6358` | Worn stone    | Secondary/muted text                   |
| Cedar     | `#DED6CA` | Raw wood      | Borders, dividers                      |
| Linen     | `#E8E0D4` | Natural linen | Secondary backgrounds, hover states    |
| Sage      | `#4E7A54` | Garden herb   | Primary actions, success, links        |
| Sage deep | `#3A6040` | Deeper sage   | Hover/pressed states                   |
| Copper    | `#C4956A` | Aged copper   | Warm accent, highlights, active states |
| Clay      | `#B85C4A` | Fired clay    | Destructive actions, errors            |
| Ash       | `#A69B8F` | Wood ash      | Disabled states, placeholders          |

### Dark mode

| Name         | Hex       | Role                |
| ------------ | --------- | ------------------- |
| Charcoal     | `#1A1816` | Page background     |
| Smoke        | `#2A2620` | Card surfaces       |
| Parchment    | `#E2DBD1` | Primary text        |
| Sandstone    | `#B5A99B` | Muted text          |
| Dark cedar   | `#3D3830` | Borders             |
| Light sage   | `#8CB393` | Primary actions     |
| Light copper | `#D4A87A` | Accent              |
| Light clay   | `#D07A68` | Destructive actions |

Dark palette is defined independently; don't derive it from the light palette.
Target warm, low-contrast rather than inverted-light.

### CSS Variables

Semantic names stay the same; component code doesn't change when colors are
updated.

```
Light:
--background:           #F6F1EB  (cream)
--foreground:           #2D2926  (ink)
--card:                 #FDFAF6  (paper)
--card-foreground:      #2D2926  (ink)
--primary:              #4E7A54  (sage)
--primary-foreground:   #FDFAF6  (paper)
--secondary:            #E8E0D4  (linen)
--secondary-foreground: #4A4139  (dark stone)
--muted:                #EDE7DE
--muted-foreground:     #6F6358  (stone)
--accent:               #C4956A  (copper)
--accent-foreground:    #2D2926  (ink)
--border:               #DED6CA  (cedar)
--destructive:          #B85C4A  (clay)
--ring:                 #4E7A54  (sage)

Dark:
--background:           #1A1816
--foreground:           #E2DBD1
--card:                 #2A2620
--card-foreground:      #E2DBD1
--primary:              #8CB393
--primary-foreground:   #1A1816
--secondary:            #2E2B26
--secondary-foreground: #D4CCC0
--muted:                #302C26
--muted-foreground:     #B5A99B
--accent:               #D4A87A
--accent-foreground:    #1A1816
--border:               #3D3830
--destructive:          #D07A68
--ring:                 #8CB393
```

### Copper as Structural Accent

Copper marks "where you are" and "what matters now":

- **Today's date** on the meal plan: 3px copper top-border
- **Active page** in navigation: copper indicator
- **Favorite heart fill**: copper, not red
- **"Up next" banner**: copper accent border

---

## Spacing & Layout

**Vertical rhythm: 8px base.** Everything snaps to multiples of 8.

- Within a group: 8-12px
- Between groups: 24-32px
- Between sections: 48-64px
- Page top padding: 16px (`py-4`). The spec's 32px/48px created excessive
  whitespace in an app context
- Card internal padding: 20-24px
- Running text line-height: 1.5-1.7

**Container widths:**

- Recipe detail, settings: **880px** max
- Recipe list, Pantry: **1080px** max
- Shopping list: **480px** max
- Landing page: content within **960px**

### Shadows

Minimal. Paper on a surface, not floating cards.

```css
--shadow-warm: 0 1px 2px oklch(25% 0.02 60 / 0.06);
--shadow-warm-md:
	0 2px 8px oklch(25% 0.02 60 / 0.08), 0 1px 2px oklch(25% 0.02 60 / 0.04);
--shadow-warm-lg:
	0 4px 16px oklch(25% 0.02 60 / 0.08), 0 1px 4px oklch(25% 0.02 60 / 0.05);
```

### Corner Radius

```
--radius:    0.5rem (8px)   -- cards, inputs
--radius-sm: 0.25rem (4px)  -- badges, chips
--radius-lg: 0.75rem (12px) -- modals, large containers
```

---

## Animation

All animations use transform/opacity only (GPU-composited). Respect
`prefers-reduced-motion`. Two curves:

| Use                              | Curve                                 | Duration  |
| -------------------------------- | ------------------------------------- | --------- |
| Entering, revealing, interacting | `cubic-bezier(0.16, 0.85, 0.45, 1)`   | 150-300ms |
| Exiting, dismissing              | `cubic-bezier(0.55, 0.0, 0.68, 0.19)` | 200ms     |

Use the shorter end (150ms) for small state changes (checkboxes, toggles) and
the longer end (280-300ms) for page-level reveals and list staggers.

**List stagger:** 40ms between items, max 6 animated (rest appear instantly).

---

## Texture & Details

- **Paper grain overlay**: CSS `feTurbulence` on the root layout wrapper. Makes
  the cream background feel like a surface. 5-6% opacity in light mode, 7-8% in
  dark mode (grain needs more contrast against charcoal). Below 5% the effect is
  imperceptible; drop it rather than ship a placebo.

  ```css
  .paper-grain::before {
  	content: '';
  	position: fixed;
  	inset: 0;
  	z-index: 50;
  	pointer-events: none;
  	opacity: 0.06;
  	background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  ```

- **Card borders**: 1px solid cedar. On hover, border warms slightly (shift
  toward copper at 20% opacity).
- **Image treatment**: 6px radius, 1px cedar border. Prefer slight letterboxing
  over aggressive cropping.
- **Dividers**: Clean `<hr>` in cedar color. No hand-drawn SVG lines.
- **Empty states**: DM Sans in stone color, dashed borders (6px dash / 8px gap).
  No Caveat font; handwriting is reserved for personal notes.

### Navigation

**Header**: "Quartermaster" wordmark on the left in DM Sans 500. User initials
circle on the right (first letter of name/username, `bg-accent/20` background).
On landing page (logged out): wordmark left, "Log In" button right.

**Bottom tab bar (mobile)**: Four tabs: Recipes, Pantry, Plan, Shop. DM Sans
tiny label (12px) below icons. Active tab: sage icon fill + copper dot or
underline indicator below. Inactive: stone color.

**No back links**: Sub-pages (recipe detail, import, generate, quick entry, bulk
import) do not render "Back to recipes" links. The bottom tab bar handles
navigation; inline back links waste vertical space on mobile.

### Empty States & Onboarding

**Empty recipe list** (`getting-started-checklist.tsx`): DM Sans, dashed-border
card. Favor import CTAs (URL paste, bulk text) over blank-form creation. No
illustrations, no Caveat.

**Empty Pantry** (`pantry-staples-onboarding.tsx`): common usually-on-hand items
as tappable chips in a flat grid. Bulk-add so Pantry feels useful immediately.

**Empty meal plan / shopping list**: one-line prompt in stone color with a ghost
action button.

---

## Data Shapes (from actual loaders)

**Recipe list item** (from `recipes/index.tsx` loader):

```ts
{
  id: string
  title: string                    // "Miso-Glazed Salmon"
  description: string | null       // "A weeknight favorite with..."
  prepTime: number | null          // 15 (minutes)
  cookTime: number | null          // 25
  isFavorite: boolean
  isAiGenerated: boolean
  servings: number | null          // 4
  image: { objectKey: string } | null
  cookingLogs: [{ cookedAt: Date }]  // most recent cook
  _count: { cookingLogs: number }    // total times cooked
  matchPercentage?: number           // 0-100, from recipe-matching
}
```

**Recipe detail** (from `recipes/$recipeId.tsx` loader):

```ts
{
  id, title, description, servings, prepTime, cookTime,
  isFavorite, isAiGenerated, sourceUrl, rawText, notes,
  image: { objectKey, altText } | null,
  ingredients: [{
    id, name, amount, unit, notes, isHeading  // isHeading = section divider
  }],
  instructions: [{ id, content }],
  // Plus: cookingLogs[], isProActive, missingIngredientIds[]
}
```

**Meal plan entry** (from `plan/index.tsx` loader):

```ts
{
  id, date: Date, mealType: 'breakfast'|'lunch'|'dinner'|'snack',
  servings: number | null, cooked: boolean,
  recipe: { id, title, prepTime, cookTime, image }
}
```

**Shopping list item** (from `shopping.tsx` loader):

```ts
{
  id, name: string, quantity: string | null,
  unit: string | null, checked: boolean,
  category: 'produce'|'dairy'|'meat'|'pantry'|'frozen'|'bakery'|'household'|'other'
}
```

**Pantry item** (from `inventory/index.tsx` loader):

```ts
{
  id, name: string,
  householdId: string
}
```

---

## Surface Designs

### 1. Landing Page

**Hero (full viewport height)**: Cream background. "What are we making this
week?" centered in Young Serif at 40px. Below: short tagline in DM Sans, muted
stone color. "Start cooking" button (sage) and "See how it works" (text link).
30-40% of the viewport is whitespace.

**Artifacts section**: Three stylized representations, not screenshots or
wireframes:

1. **A recipe page.** Young Serif title, short ingredient list, metadata. Slight
   angle (2–3deg rotation, warm shadow).
2. **A week view.** Days of the week with a few meals in Caveat, fridge-note
   aesthetic.
3. **A shopping list.** A few items with line-through strikethrough. Torn-edge
   clip-path at the bottom.

Each artifact has a Caveat 700 label in copper ("Tonight's dinner", "This week",
"Shopping list") and fades up on scroll via `IntersectionObserver` (element
reveal, 280ms). Natural stagger from scroll position rather than explicit
delays. `ScrollReveal` uses CSS-first `opacity-0` class to avoid hydration
flash, with `prefers-reduced-motion` check that skips animation entirely.

**Close**: Simple final CTA section. Below, a shared marketing footer (from
`_marketing.tsx` layout) renders links to About, Support, Privacy, and Terms --
muted text, cedar top border, centered. All `_marketing/` pages share this
footer. The upgrade page (`upgrade.tsx`) is outside `_marketing/` and has its
own back-nav instead.

---

### 2. Recipe List

Titles carry the visual weight in place of photos. Let them breathe.

**Mobile (list view)**:

- Recipe title in Young Serif at 16-17px. Allow wrapping to 2 lines before
  truncating.
- Description (if present) below in small DM Sans, muted, 1 line max.
- Metadata (cook time, Pantry fit, or "needs X things") as tiny captions in
  stone color. Prefer concrete missing-ingredient counts over match percentages.
  If a percentage appears, keep it visually quiet and do not imply the recipe
  can definitely be cooked without shopping.
- 16px vertical padding per row. Subtle 1px cedar bottom border between rows.
- Favorite: small copper heart to the right of the title.
- If a recipe has an image: small thumbnail (48-56px) on the left.

**No-image treatment**: Mobile list cards use a thin (3px) colored left border
for visual variation. Desktop grid cards keep colored letter backgrounds as
placeholder art. No-image cards get extra padding (`md:p-6` vs `md:p-5`) and an
additional line of description (`md:line-clamp-3` vs 2) to fill the space.

**Desktop (grid view)**:

- Two columns at `md`, three at `lg`.
- **Cards with image**: Photo fills card top (4:3 ratio), 1px cedar border.
  Title in Young Serif below. Cook time as tiny caption.
- **Cards without image** (the default): Title in Young Serif at 18px, generous
  padding, description gets more space.
- Hover: shadow-hover transition, 180ms. Border warms slightly. If image, it
  scales 1.02x.

**Search and filters**: Search input at top, DM Sans placeholder. Filter pills
(time, favorites, "Nothing to buy") below. Linen background, rounded.

**"AI Generated" indicator**: Heavily demoted: small muted sparkles icon
(`text-muted-foreground/50`) in the metadata row. No text, no badge.

---

### 3. Recipe Detail

The surface users spend the most time on while cooking. Optimized for
arm's-length readability.

**Hero area**: Title in Young Serif at 2rem. Below it, a clean `<hr>` in cedar.
Then metadata: prep, cook, total time in small DM Sans, muted.

If there's an image: up to 400px wide on desktop beside the title, full-width
with 16px horizontal margin on mobile. 1px cedar border, 6px radius.

**Two-column body (desktop)**:

- **Left (sticky): Ingredients.** Generous line spacing (1.7). Both amounts and
  ingredient names in DM Sans. Section headings (`isHeading` rows) in DM Sans
  500, uppercase at 12px with a subtle underline -- clearly distinct from
  checkable items (no checkbox). Checkboxes: 24px, sage fill when checked.
- **Right: Instructions.** Step numbers in Young Serif, oversized. Step text in
  DM Sans, line-height 1.75. Steps separated by subtle border dividers. Checked
  steps dim to 40% opacity with subtle strikethrough. Checking a step
  auto-scrolls to center the next unchecked step.

**Mobile (single column)**: Ingredients first (collapsible, starts expanded),
then instructions. 17px base text for arm's-length reading. Full-row tap targets
for checkboxes.

**Personal notes**: Left-bordered with copper line. Note text in Caveat on a
subtly warm background. Empty state: dashed border, DM Sans prompt "Add your
notes...". Caveat only appears when notes exist.

**Action bar**: Inline icon row below the description, shared by mobile and
desktop. Mobile shows icon-only buttons (cook in emerald, favorite, edit, share,
enhance) with an overflow menu for less common actions; desktop adds a text "I
Made This" button and print. Serving scaler: simple +/- stepper in the
ingredients card header.

**Print view**: Young Serif titles + clean ingredient columns. No chrome, no
colors. Ingredients in a tight two-column layout (amount | name). Instructions
numbered, compact line-height. Source URL as small footer text.

---

### 4. Meal Plan

**Mobile**: Vertical day stack. Day name in Young Serif. Today highlighted with
copper pill background and subtle ring. Meals in DM Sans, text-only, no
thumbnails. Empty days: ghost "+" button. Past days faded (80% opacity).

**Desktop**: 7-day grid. Each day is a warm card with Young Serif day header and
generous padding. Today's card: 3px copper top-border.

**"Up next" banner**: Warm card at top (linen background). Tonight's meal with
time and "Cook" action. Nothing planned: simple DM Sans suggestion.

**Adding meals**: Inline dropdown with search, same on mobile and desktop. Opens
below the meal slot, scrollable list partitioned into "Favorites" and "All
Recipes" sections (headers shown when both groups exist). Each recipe shows a
heart icon (favorites), cook count badge, and cook time. Weeknight sort (Mon-Thu
quick recipes first) applied within each group. New meal fades in with
element-reveal curve.

---

### 5. Shopping List

**Layout**: Single column, 480px max-width, centered.

**Items**:

- Large checkboxes (24px), sage fill when checked.
- Item name in DM Sans 16px. Quantity/unit as a small caption below.
- Checked items: standard `line-through` (2px stone color,
  `decoration-2 decoration-muted-foreground/60`). Text fades to 50% opacity.
- 10px vertical padding per item, tighter than default for efficient scrolling
  through long lists.

**Progress**: Header counter: "Shopping List (3/10)". No progress bar.

**Sorting**: Checked status first, then alphabetically. No visible category
headers. Category grouping was tried and removed. Categories stored for Pantry
updates but don't affect display.

**Quick add**: Inline input at top on desktop (DM Sans placeholder "Add an
item...", ghost + button). On mobile, a floating action button (FAB) in the
bottom-right opens a small dialog with name input and optional qty/unit fields,
designed for one-handed use at the store.

**Checked item actions**: Subtle footer slides up when items are checked:
"Remember for next time" and "Clear checked" as text links.

**Print view**: Unicode checkboxes, compact spacing, no chrome. Should fit one
page for a typical weekly shop.

---

### 6. Pantry

The densest, most utilitarian surface.

**Layout**: Single column, 1080px max. Search input at top (shown when 15+
items). Always-visible quick-add input below search.

**Items**: Flat alphabetical list, DM Sans 16px. Item name left-aligned.
Overflow dots at right. Minimal row height.

**Swipe-to-delete**: on mobile, swiping left reveals an 80px destructive-red
delete button. `touch-action: pan-y` for native scroll vs swipe discrimination,
10px dead zone, rubber-band resistance past bounds. Only one row open at a time.
Overflow menu remains as the desktop and accessibility fallback.

**What makes it different from the shopping list**: Pantry is dense and
scannable (you're checking what you usually keep around). Shopping list is
spacious and interactive (you're checking items off). Pantry rows are tighter
(12px vertical padding vs shopping's 10px). No checkboxes, no strikethrough.

---

## Building New Surfaces

When adding a screen not described above, start from these defaults:

- **Container**: Pick the closest width from the set (480 / 880 / 1080px). When
  nothing fits, use 880px.
- **Page title**: Young Serif, 2.25rem (36px). One title per page.
- **Body text**: DM Sans 400, 16px, line-height 1.65.
- **Spacing**: 8px grid. 16px top padding (`py-4`). 24-32px between content
  groups.
- **Cards**: Paper background, 1px cedar border, 8px radius, 20-24px internal
  padding. Minimal shadow (shadow-rest).
- **Interactive elements**: Sage for primary actions, cedar borders on inputs,
  200ms transitions.
- **Warmth cues**: Paper background, `shadow-warm*` tokens, cedar borders. Avoid
  cool greys and pure white.

---

## Voice & Copy

See [COPYWRITING.md](./COPYWRITING.md). Design-specific notes:

- Empty states: one sentence, one clear action.
- Avoid gradient hero banners, stock illustrations, oversized feature grids,
  floating chat widgets. The language is paper and ink.

---

## Implementation Notes

### Fonts

Young Serif and Caveat loaded via Google Fonts `<link>` tags in `root.tsx`
alongside DM Sans. `font-display: swap`. ~45KB combined (woff2).

### CSS architecture

- Colors use hex values in CSS variables. Semantic names (`--primary`,
  `--accent`, etc.) stay the same. Component code doesn't change between themes.
- Shadow definitions use `oklch` intentionally for warm-tinted transparency;
  palette variables are hex.
- No generic type scale tokens; all sizing uses standard Tailwind classes
  directly. Purpose-driven sizes from the type scale table above.
- `prefers-reduced-motion`: global CSS rule sets
  `animation-duration: 0.01ms !important` and
  `transition-duration: 0.01ms !important`. `ScrollReveal` also checks via JS
  and skips animation entirely.

### Shadow tokens

Three tiers, all warm-tinted:

- `shadow-warm`: resting state (cards, containers)
- `shadow-warm-md`: hover state (card hover, elevated interactions)
- `shadow-warm-lg`: elevated state (modals, FAB dialogs)

UI primitives (dropdowns, dialogs) use standard `shadow-lg`.
