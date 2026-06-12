# Design System

Visual reference: typography, color, spacing, components, per-surface layouts.
For product voice and copy, see [COPYWRITING.md](./COPYWRITING.md). For product
direction and UX principles, see [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md).

## Context

Primary use is cooking: phone propped on the counter, hands busy. Tap targets
≥44px, body text ≥16px, interactions work one-handed. Hover is polish; tap is
the design.

## Distinctive Elements

1. **Young Serif titles + a thumbnail on every recipe.** Every recipe row and
   tile carries an image slot: the photo when one exists, otherwise a
   deterministic warm gradient monogram (serif initial on a same-hue gradient).
   Titles still lead; the monogram gives image-less collections rhythm and color
   without badges or chrome.
2. **Ingredient check-off.** CSS `line-through` with
   `decoration-2 decoration-muted-foreground/60` and text fade to 50% opacity. A
   pen-stroke `scaleX` animation was prototyped and dropped — not readable at
   arm's length.
3. **Flat divided lists.** Content sits directly on the cream canvas — rows
   separated by hairline dividers (`divide-y divide-border/40`) and small-caps
   section labels (`sectionLabelClass` in `app/utils/misc.tsx`), never boxed
   cards. Elevation belongs to overlays only; grouping uses quiet insets
   (`bg-muted/40 rounded-lg`, no border or shadow).

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
| Page title               | Young Serif | 1.5rem (24px)    | 1.15        | -0.02em        |
| Recipe detail title      | Young Serif | 2rem (32px)      | 1.15        | -0.02em        |
| Section heading          | Young Serif | 1.5rem (24px)    | 1.3         | -0.01em        |
| Recipe card title (grid) | Young Serif | 1.125rem (18px)  | 1.3         | -0.005em       |
| Recipe row title (list)  | Young Serif | 1.0625rem (17px) | 1.4         | 0              |
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
--copper-text:          #8C5F3A  (copper as text — AA on cream)
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
--copper-text:          #D4A87A  (light copper clears AA on charcoal)
--border:               #3D3830
--destructive:          #D07A68
--ring:                 #8CB393
```

### Copper as Structural Accent

Copper marks "where you are" and "what matters now":

- **Today's date** on the meal plan: copper dot beside the day name (mobile),
  3px copper top-border (desktop)
- **Active page** in navigation: copper indicator
- **Favorite heart fill**: copper, not red
- **"Up next" banner**: copper accent left edge

The flip side of the rule: **sage is reserved for interactive elements**
(buttons, links, checkboxes, the active tab icon) and **headings are always
ink**. If something isn't clickable and isn't "now", it doesn't get a color.

**Copper never colors text below 24px in light mode** — `#C4956A` on cream is
≈2.4:1, far short of AA. Copper marks structure (dots, edges, fills); text stays
ink/stone. If a copper _word_ is truly wanted, use `--copper-text` (`#8C5F3A`,
≥4.5:1 on cream; tracks light copper in dark mode) — never the raw accent.

---

## Spacing & Layout

**Vertical rhythm: 8px base.** Everything snaps to multiples of 8.

- Within a group: 8-12px
- Between groups: 24-32px
- Between sections: 48-64px
- Page top padding: 16px (`py-4`). The spec's 32px/48px created excessive
  whitespace in an app context
- Inset group internal padding (`bg-muted/40`): 16-24px
- Running text line-height: 1.5-1.7

**Container widths:**

- Recipe detail, settings: **880px** max
- Recipe list, Pantry: **1080px** max
- Shopping list: **480px** max
- Landing page: content within **960px**

### Shadows

**Elevation is for overlays only.** Static content — list rows, sections,
banners, buttons — sits flat on the canvas: no resting shadows, no hover-lift
shadows. Two tiers, both warm-tinted:

```css
--shadow-warm-md:
	0 2px 8px oklch(25% 0.02 60 / 0.08), 0 1px 2px oklch(25% 0.02 60 / 0.04);
--shadow-warm-lg:
	0 4px 16px oklch(25% 0.02 60 / 0.08), 0 1px 4px oklch(25% 0.02 60 / 0.05);
```

- `shadow-warm-md`: small floating layers — dropdown menus, popovers, tooltips,
  toasts, list-item action menus.
- `shadow-warm-lg`: large floating layers — dialogs, bottom sheets, the FAB
  panel, the timer widget.
- `shadow-warm` (1px tier) still exists as a token but is retired from app
  surfaces; don't introduce new usages.

### Corner Radius

```
--radius-sm: 0.25rem (4px)  -- badges, chips
--radius-md: 0.5rem (8px)   -- everything interactive inline: buttons, inputs, insets
--radius-lg: 0.75rem (12px) -- floating layers: menus, popovers
--radius-xl: 0.75rem (12px) -- dialogs, bottom sheets
```

Inline content never exceeds 8px (`rounded-md`); 12px is reserved for things
that float. `rounded-2xl` is banned on app surfaces (marketing pages excepted).

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

- **Hairline dividers**: rows in a list separate with
  `divide-y divide-border/40` — no per-row borders, backgrounds, or shadows.
  Desktop grid tiles are the one surface that keeps a 1px cedar border (hover
  warms it toward copper); they never carry shadows.
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

**Empty recipe list** (`getting-started-checklist.tsx`): a quiet inset
(`bg-muted/40`, no border/shadow). Favor import CTAs (URL paste, bulk text) over
blank-form creation. No illustrations, no Caveat.

**Passive hints** (`onboarding-nudge.tsx`): a single muted line — bold ink
lead-in, sage inline CTA (it's a link: interactive means sage, per the copper
rule above), friendly text dismiss ("Got it"). No panel, no icon disc; hidden in
print.

**Empty Pantry** (`pantry-staples-onboarding.tsx`): common usually-on-hand items
as tappable chips in a flat grid. Bulk-add so Pantry feels useful immediately.

**Empty meal plan / shopping list**: one-line prompt in stone color with a ghost
action button — one quiet state, never a grid of cards.

---

## Imagery & Monograms

Photos and monogram tiles are the warmth carriers on list surfaces. Rules:

- **Every recipe slot shows an image**: the recipe photo when present, otherwise
  the deterministic monogram from `app/utils/recipe-placeholder.ts` — a Young
  Serif initial on a same-hue diagonal gradient (amber / emerald / rose / stone,
  hashed from the title). Letters are quiet (≈40% opacity ink tones) —
  watermarks, not logos.
- **Sizes** (square, `shrink-0`, `overflow-hidden`): 64px recipe-list rows,
  56-64px "Up next" banner, 44px plan meal rows (mobile only — desktop plan
  columns are too narrow), 36-40px picker/selector rows.
- **Radius**: `rounded-lg` (12px) at 56px and above, `rounded-md` (8px) below.
  Hero/tile photos that span their container keep container rounding (none when
  full-bleed).
- **Mobile recipe detail hero**: when a photo exists it renders full-bleed above
  the title (16:10, edge-to-edge, flush under the app header). Desktop keeps the
  400px side column with border + 8px radius.
- **Where images never go**: shopping list and pantry rows (flat utility lists —
  deliberate), settings, forms (outside the upload preview).
- Thumbnails are decorative next to a visible title: `alt=""` on the `Img`,
  `role="img"` + label only when the monogram stands alone (recipe-card).

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
  // Plus: isProActive, missingIngredientIds[]
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

Image-led rows on a flat canvas: photo or monogram first, serif title beside.

**Mobile (list view)**: a full-bleed flat divided list.

- Each row: a 64px `rounded-lg` thumbnail (photo, else gradient monogram) +
  recipe title in Young Serif at 17px (wraps to 2 lines before truncating) +
  total time as a 13px stone caption when present + a small copper heart when
  favorited. **Nothing else** — no match percentages, no cook counts, no
  descriptions, no colored edges. (Pantry-match data lives in the "Nothing to
  buy" filter and on the recipe detail page, where it's actionable.)
- Rows are edge-to-edge (`max-md:-mx-4`, padding restored per row) with hairline
  dividers; 12px vertical padding; `active:bg-muted/40` press state.

**Desktop (grid view)**:

- Two columns at `md`, three at `lg`.
- **Tiles with image**: Photo fills tile top (4:3 ratio). Title in Young Serif
  below. Cook time as tiny caption.
- **Tiles without image** (the default): gradient monogram block (same-hue
  gradients — amber/emerald/rose/stone), title at 18px, description gets more
  space (`md:line-clamp-3` vs 2, `md:p-6` vs `md:p-5`).
- Tile chrome: `bg-card` + 1px cedar border at 8px radius. **No shadows, no
  hover lift** — hover warms the border toward copper, images scale 1.02x.

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

If there's an image: full-bleed **above** the title on mobile (16:10,
edge-to-edge, flush under the app header — no border, no radius); up to 400px
wide on desktop beside the title with a 1px cedar border at 8px radius.

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
for checkboxes. Once the ingredient list scrolls out of view, a quiet text pill
("Ingredients · 7/16", bottom-left, opposite the timer pill) opens the same
checkable, scaled ingredient list as a bottom sheet over the steps — glance,
dismiss, never lose your step.

**Scaled amounts read like a cook's pencil note, not a calculator.** When the
servings stepper moves off the authored count, displayed amounts round to
quantities a kitchen can measure: metric values snap to honest increments
prefixed with ≈ ("≈310 g", never "312.5 g"), and eighths no spoon set has become
qualifier phrases ("generous 1/2", "scant 2"). Author-written amounts at the
original serving count keep their exact precision, as do shopping-list
quantities (`scaleAmount` stays exact; display uses `scaleAmountKitchen`). The
same spirit as temperature conversion's nearest-5° rounding — and bare "450
degrees" steps get the same quiet badge with ≈ marking the assumed °F.

**Personal notes**: Left-bordered with copper line. Note text in Caveat on a
subtly warm background. Empty state: dashed border, DM Sans prompt "Add your
notes...". Caveat only appears when notes exist.

**Action bar**: favorite / plan / edit / share icon buttons and an overflow menu
holding Print and Enhance. Same on every breakpoint; no emerald or violet
accents. Serving scaler: simple +/- stepper in the ingredients section header.

**Ingredients/instructions are flat sections** — no card wrapper around the
ingredient list (the desktop column keeps its `md:sticky` behavior). Raw
imported text sits in a quiet `bg-muted/40` inset. There is no cooking history —
cook logging was removed entirely.

**Print view**: Young Serif titles + clean ingredient columns. No chrome, no
colors. Ingredients in a tight two-column layout (amount | name). Instructions
numbered, compact line-height. Source URL as small footer text.

---

### 4. Meal Plan

**Mobile**: Vertical day stack as a flat divided list (hairlines between days,
16px vertical padding per day). Editorial day header: weekday name in Young
Serif at 18px, always ink — the current day gets a small copper **dot** beside
"Today" (no pill, ring, or tinted box; copper text fails AA) + a 12px stone "Jun
11" caption beside it; past days dim the weekday to `text-muted-foreground/70`;
a "N meals" count sits right-aligned. Planned meals are flat rows under
small-caps meal-type labels (11px, `tracking-wider uppercase`):
cooked-checkbox + 44px `rounded-md` thumbnail (photo or monogram, mobile only) +
Young Serif title at 15px + servings stepper. Empty days and empty slots: quiet
text rows — a plus icon and a 13px muted label, **no dashed borders, no disc
icons**.

**Desktop**: 7-day grid of flat columns (no card chrome, no shadows). Young
Serif day header; every column carries a 3px top border — cedar hairline
normally, copper for today. No thumbnails (columns are too narrow).

**Week navigation**: icon-only chevron ghost buttons (aria-labels "Previous
week"/"Next week") flanking the serif week range.

**"Up next" banner**: copper-left-edged linen band, only rendered when the week
has meals; its 56-64px thumbnail shows on all breakpoints. **Empty week**: a
single quiet inline state — serif one-liner, then one outline button. Never
stacked banners.

**Adding meals**: Inline dropdown with search (a true overlay: `bg-card`,
border, `shadow-warm-lg`, 12px radius). Partitioned into "Favorites" and "All
Recipes"; each recipe row shows a 36px thumbnail, a heart icon (favorites) and
cook time — no cook count badges. Weeknight sort (Mon-Thu quick recipes first)
applied within each group. New meal fades in with element-reveal curve.

---

### 5. Shopping List

**Layout**: Single column, 480px max-width, centered.

**Items**:

- Large checkboxes (24px), sage fill when checked.
- Item name in DM Sans 16px. Quantity/unit as a small caption below.
- Checked items: standard `line-through` (2px stone color,
  `decoration-2 decoration-muted-foreground/60`). Text fades to 50% opacity.
- 10px vertical padding per item, tighter than default for efficient scrolling
  through long lists. Hairline dividers between rows (`divide-border/40`).

**Progress**: Header counter: "Shopping List (3/10)". No progress bar.

**Sorting**: Checked status first, then alphabetically. No visible category
headers. Category grouping was tried and removed. Categories stored for Pantry
updates but don't affect display.

**Quick add**: Inline input at top on desktop (DM Sans placeholder "Add an
item...", ghost + button). On mobile, a floating action button (FAB) in the
bottom-right opens a **bottom sheet**: full-width, anchored above the tab bar at
`bottom-[calc(4rem+env(safe-area-inset-bottom))]`,
`rounded-t-xl border-t shadow-warm-lg` over a light scrim, with a labeled header
and close button. The FAB hides while the sheet is open. Same pattern on Pantry.

**Checked item actions**: Subtle footer slides up when items are checked:
"Remember for next time" and "Clear checked" as text links.

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
- **Page title**: Young Serif, `text-2xl`, ink. One title per page.
- **Body text**: DM Sans 400, 16px, line-height 1.65.
- **Spacing**: 8px grid. 16px top padding (`py-4`). 24-32px between content
  groups.
- **Lists**: flat rows + `divide-y divide-border/40`. Never per-row boxes.
- **Imagery**: recipe-shaped rows get a thumbnail (photo, else the gradient
  monogram) per the Imagery & Monograms sizes. Utility lists (shopping, pantry,
  settings) stay text-only.
- **Grouping**: small-caps `sectionLabelClass` headers; when containment is
  genuinely needed, a quiet inset (`bg-muted/40 rounded-lg`, no border/shadow).
- **Overlays** (the only elevated things): `bg-card`, 12px radius,
  `shadow-warm-md` (menus/popovers) or `shadow-warm-lg` (dialogs/sheets).
- **Interactive elements**: Sage for primary actions, cedar borders on inputs,
  8px radius, 200ms transitions, `active:scale-[0.98]`.
- **Warmth cues**: Cream canvas, serif headings, copper "now" markers, cedar
  hairlines, paper grain. Avoid cool greys and pure white.

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

Two active tiers, warm-tinted, overlays only (see Shadows above):

- `shadow-warm-md`: menus, popovers, tooltips, toasts
- `shadow-warm-lg`: dialogs, sheets, FAB panel, timer widget
- `shadow-warm`: retired from app surfaces (token kept for compatibility)

UI primitives use the warm tiers — never standard `shadow-lg`.
