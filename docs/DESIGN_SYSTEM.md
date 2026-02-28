# Quartermaster Design System

## Identity

A well-used cookbook that happens to live on a screen. Not a food app, not a
productivity tool — a personal cooking reference built for people who actually
cook.

The design works through typography and warmth, not photography. Most recipes
won't have images. That's fine — the best cookbooks are beautiful without a
single photo. Typography is the visual identity.

One test for every decision: _does this feel like something you'd keep on the
kitchen counter, or something you'd forget you downloaded?_

**Designed for the kitchen.** The primary use context is cooking — phone propped
on the counter, hands busy or messy, reading at arm's length. This means
generous touch targets, text sized for distance, and interactions that work
one-handed. Hover states are polish; tap behavior is the real design.

### What Makes This Distinctive

Two things. Everything else is good execution.

1. **Warm serif recipe titles everywhere** — In a sea of sans-serif apps, Young
   Serif titles on every recipe make Quartermaster instantly recognizable. Since
   most recipes don't have photos, the titles carry the visual identity. A recipe
   list should read like a beautiful table of contents.
2. **Ingredient check-off** — Standard CSS `line-through` with 2px stone-color
   line and text fade to 50% opacity. Pen-stroke `scaleX` animation was
   prototyped but wasn't visible enough in practice — the standard treatment
   reads clearly at arm's length and feels satisfying without being showy.

---

## Typography

Three voices:

**Young Serif** (Display) — Warm, slightly rounded, approachable. Used for all
headings and recipe titles. Only has one weight (400), which forces
consistency — differentiate by size, not by weight. Never apply `font-semibold`,
`font-bold`, or `font-light` to `font-serif` elements.

```
Google Fonts: Young Serif 400
```

**DM Sans** (Sans-serif) — The workhorse. Body text, labels, metadata,
navigation, everything functional. The constant serif/sans switching between
titles and body text is what makes pages feel like a printed cookbook annotated
by hand.

```
Already loaded: DM Sans 300-700
```

**Caveat** (Handwritten) — Strictly two contexts: **personal recipe notes** and
**landing page artifacts**. Nowhere else. The principle: Caveat represents the
user's voice, not the app's. Notes and personal annotations get Caveat because
they're things the user wrote. A search placeholder or empty state in Caveat
would be the app pretending to be handwritten — that becomes a gimmick by the
third time you see it.

```
Google Fonts: Caveat 400, 700
```

### Type Scale

| Use | Font | Size | Line height | Letter spacing |
|-|-|-|-|-|
| Landing hero | Young Serif | 2.5rem (40px) | 1.2 | -0.02em |
| Page title | Young Serif | 2.25rem (36px) | 1.15 | -0.02em |
| Recipe detail title | Young Serif | 2rem (32px) | 1.15 | -0.02em |
| Section heading | Young Serif | 1.5rem (24px) | 1.3 | -0.01em |
| Recipe card title (grid) | Young Serif | 1.125rem (18px) | 1.3 | -0.005em |
| Recipe card title (list) | Young Serif | 1rem (16px) | 1.4 | 0 |
| Ingredient amount/unit | DM Sans 400 | 1rem (16px) | 1.65 | 0 |
| Body text | DM Sans 400 | 1rem (16px) | 1.65 | 0 |
| Small body | DM Sans 400 | 0.875rem (14px) | 1.5 | 0 |
| UI label | DM Sans 500 | 0.875rem (14px) | 1.4 | 0 |
| Caption/meta | DM Sans 400 | 0.8125rem (13px) | 1.45 | 0 |
| Tiny label | DM Sans 500 | 0.75rem (12px) | 1.3 | 0 |
| Recipe personal note | Caveat 400 | 1.125rem (18px) | 1.4 | 0 |
| Landing artifact label | Caveat 700 | 1.25rem (20px) | 1.35 | 0 |

**Recipe detail title** is intentionally larger than other page titles — it
needs to work at arm's length while cooking. Reduced from the spec's 2.5rem to
2rem for better proportion with the rest of the page.

**Ingredient amounts** use DM Sans like ingredient names — serif amounts were
prototyped but looked too heavy on mobile and created visual disconnect. The
consistent sans-serif treatment scans better in practice.

---

## Color Palette

Kitchen and paper surfaces, not brand colors. Every color has a material origin.

| Name | Hex | Origin | Role |
|-|-|-|-|
| Cream | `#F6F1EB` | Aged paper | Page background |
| Paper | `#FDFAF6` | Clean paper | Card surfaces, elevated areas |
| Ink | `#2D2926` | Writing ink | Primary text |
| Stone | `#6F6358` | Worn stone | Secondary/muted text |
| Cedar | `#DED6CA` | Raw wood | Borders, dividers |
| Linen | `#E8E0D4` | Natural linen | Secondary backgrounds, hover states |
| Sage | `#4E7A54` | Garden herb | Primary actions, success, links |
| Sage deep | `#3A6040` | Deeper sage | Hover/pressed states |
| Copper | `#C4956A` | Aged copper | Warm accent, highlights, active states |
| Clay | `#B85C4A` | Fired clay | Destructive actions, errors |
| Ash | `#A69B8F` | Wood ash | Disabled states, placeholders |

### Dark mode

| Name | Hex | Role |
|-|-|-|
| Charcoal | `#1A1816` | Page background |
| Smoke | `#2A2620` | Card surfaces |
| Parchment | `#E2DBD1` | Primary text |
| Sandstone | `#B5A99B` | Muted text |
| Dark cedar | `#3D3830` | Borders |
| Light sage | `#8CB393` | Primary actions |
| Light copper | `#D4A87A` | Accent |
| Light clay | `#D07A68` | Destructive actions |

Dark mode serves a different emotional register than light. The material
metaphors (aged paper, writing ink, worn stone) are inherently about light
surfaces — don't try to replicate them in dark mode. Instead, dark mode should
feel like cooking at night: warm, low-contrast, comfortable. Functional and
not blinding at midnight, not a second visual identity to maintain.

### CSS Variables

Semantic names stay the same — component code doesn't change when colors are
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

Copper marks "where you are" and "what matters now." Give it a consistent job
instead of scattering it as a generic accent:

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
- Page top padding: 16px (`py-4`) — the spec's 32px/48px created excessive
  whitespace in an app context
- Card internal padding: 20-24px
- Running text line-height: 1.5-1.7

**Container widths:**

- Recipe detail, settings: **880px** max
- Recipe list, inventory: **1080px** max
- Shopping list: **480px** max
- Landing page: content within **960px**

### Shadows

Minimal. Paper on a surface, not floating cards.

```css
--shadow-rest: 0 1px 2px oklch(25% 0.02 60 / 0.06);
--shadow-hover:
	0 2px 8px oklch(25% 0.02 60 / 0.08), 0 1px 2px oklch(25% 0.02 60 / 0.04);
--shadow-elevated:
	0 4px 16px oklch(25% 0.02 60 / 0.08), 0 1px 4px oklch(25% 0.02 60 / 0.05);
```

### Corner Radius

```
--radius:    0.5rem (8px)   — cards, inputs
--radius-sm: 0.25rem (4px)  — badges, chips
--radius-lg: 0.75rem (12px) — modals, large containers
```

---

## Animation

All animations use transform/opacity only (GPU-composited). Respect
`prefers-reduced-motion`. Two curves:

| Use | Curve | Duration |
|-|-|-|
| Entering, revealing, interacting | `cubic-bezier(0.16, 0.85, 0.45, 1)` | 150-300ms |
| Exiting, dismissing | `cubic-bezier(0.55, 0.0, 0.68, 0.19)` | 200ms |

Use the shorter end (150ms) for small state changes (checkboxes, toggles) and
the longer end (280-300ms) for page-level reveals and list staggers.

**List stagger:** 40ms between items, max 6 animated (rest appear instantly).

### Ingredient Check-Off

Checked ingredients and shopping list items use standard CSS `line-through` with
`decoration-2 decoration-muted-foreground/60` (2px stone-color line). Text fades
to 50% opacity. Pen-stroke `scaleX` animation was prototyped but the effect
wasn't visible enough at normal reading distance — the standard treatment is
cleaner and more reliable across browsers.

---

## Texture & Details

- **Paper grain overlay**: CSS `feTurbulence` on the root layout wrapper.
  Intended to make the cream background feel like a surface instead of a hex
  code. Below 5% opacity the effect is imperceptible on most screens — if it's
  not visible, it's rendering cost for nothing. Use 5-6% in light mode, 7-8%
  in dark mode (grain needs more contrast against charcoal). If it still reads
  as invisible on target devices, drop it entirely rather than shipping a
  placebo.

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
- **Dividers**: Clean `<hr>` in cedar color. No hand-drawn SVG lines — a simple
  rule is more honest than a manufactured "organic" wobble.
- **Empty states**: DM Sans in stone color, dashed borders (6px dash / 8px gap).
  No Caveat font — handwriting is reserved for personal notes.

### Navigation

**Header**: "Quartermaster" wordmark on the left in DM Sans 500. User initials
circle on the right (first letter of name/username, `bg-accent/20` background).
Clean, minimal — the header shouldn't compete with page content. On landing page
(logged out): wordmark left, "Log In" button right.

**Bottom tab bar (mobile)**: Four tabs — Recipes, Inventory, Plan, Shop. DM Sans
tiny label (12px) below icons. Active tab: sage icon fill + copper dot or
underline indicator below. Inactive: stone color. The tab bar is functional
chrome — keep it clean, don't over-design it.

**No back links**: Sub-pages (recipe detail, import, generate, quick entry, bulk
import) do not render "Back to recipes" links. The bottom tab bar already
provides navigation back to each section, so inline back links are redundant and
waste vertical space on mobile.

### Empty States & Onboarding

New users see empty surfaces first. These set the tone.

**Empty recipe list** (`getting-started-checklist.tsx`): DM Sans, warm but
direct. Encourage importing recipes (URL paste, bulk text) rather than creating
from scratch — the fastest path to a collection that feels like "theirs." No
illustrations, no Caveat font. A dashed-border card with clear action links.

**Empty inventory** (`pantry-staples-onboarding.tsx`): Offer common pantry
staples as tappable chips. Quick bulk-add so the inventory feels useful
immediately.

**Empty meal plan / shopping list**: Simple one-line prompt in stone color with
a ghost action button. Minimal — these screens are self-explanatory once the
user has recipes.

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

**Inventory item** (from `inventory/index.tsx` loader):

```ts
{
  id, name: string,
  location: 'pantry'|'fridge'|'freezer',
  householdId: string
}
```

---

## Surface Designs

### 1. Landing Page

The first impression. Restraint communicates confidence.

**Hero (full viewport height)**: Cream background. "What are we making this
week?" centered in Young Serif at 40px. Below: a short tagline in DM Sans,
muted stone color. "Start cooking" button (sage) and "See how it works" (text
link). 30-40% of the viewport is whitespace.

**Artifacts section**: Three stylized representations of the app — not
screenshots, not wireframes. These need to feel like designed objects:

1. **A recipe page** — Young Serif title, a short ingredient list, metadata.
   Rendered at a slight angle (2-3deg rotation, warm shadow). Should look like a
   beautifully typeset cookbook page, not a UI mockup.
2. **A week view** — Days of the week with a few meals in Caveat. Feels like a
   note stuck to the fridge.
3. **A shopping list** — A few items, some with line-through strikethrough. Torn
   edge clip-path at the bottom. Clean, narrow, satisfying.

Each artifact has a Caveat 700 label in copper ("Tonight's dinner", "This
week", "Shopping list") and fades up on scroll via `IntersectionObserver`
(element reveal, 280ms). Natural stagger from scroll position rather than
explicit delays. `ScrollReveal` uses CSS-first `opacity-0` class to avoid
hydration flash, with `prefers-reduced-motion` check that skips animation
entirely.

**Close**: Simple final CTA section. Below, a shared marketing footer
(from `_marketing.tsx` layout) renders links to About, Support, Privacy,
and Terms — muted text, cedar top border, centered. All `_marketing/`
pages share this footer. The upgrade page (`upgrade.tsx`) is outside
`_marketing/` and has its own back-nav instead.

---

### 2. Recipe List

The most important screen to get right. This is where the no-image reality is
most felt — the design must make a text-only list beautiful, not apologize for
missing photos.

**The key insight**: Recipe titles describe food. "Pan-Seared Chicken with
Creamy Garlic Pasta" is more evocative than most app content. Let the titles be
the visual. Don't fill the gap with letter avatars.

**Mobile (list view)**:

- Recipe title in Young Serif at 16-17px. Allow wrapping to 2 lines before
  truncating — titles are the most important thing on this screen.
- Description (if present) below in small DM Sans, muted, 1 line max.
- Metadata (cook time, match %) as tiny captions in stone color. Match
  percentage shown as a small (16px) progress ring + text percentage.
  Color tiers: green ≥80%, amber ≥50%, muted foreground below.
  `tabular-nums` for consistent widths. Ring uses `hideText` at this size.
- 16px vertical padding per row. Subtle 1px cedar bottom border between rows.
- Favorite: small copper heart to the right of the title.
- If a recipe has an image: small thumbnail (48-56px) on the left.

**No-image treatment**: Mobile list cards use a thin (3px) colored left border
for subtle visual variation without the contacts-app feel of letter circles.
Desktop grid cards keep colored letter backgrounds as placeholder art. No-image
cards get extra padding (`md:p-6` vs `md:p-5`) and an additional line of
description (`md:line-clamp-3` vs 2) to fill the space intentionally.

**Desktop (grid view)**:

- Two columns at `md`, three at `lg`.
- **Cards with image**: Photo fills card top (4:3 ratio), 1px cedar border. Title
  in Young Serif below. Cook time as tiny caption.
- **Cards without image** (the default): The card is a typographic composition.
  Title in Young Serif at 18px, given room to breathe. Description gets more
  space. Generous padding. The card should feel intentional, not like a card
  missing its photo.
- Hover: shadow-hover transition, 180ms. Border warms slightly. If image, it
  scales 1.02x.

**Search and filters**: Search input at top, DM Sans placeholder. Filter pills
(time, favorites, "can make") below — linen background, rounded, gentle.

**"AI Generated" indicator**: Heavily demoted — a small muted sparkles icon
(`text-muted-foreground/50`) in the metadata row. No text, no badge. This is
background metadata, not a feature to advertise.

---

### 3. Recipe Detail (Signature Surface)

Users spend the most time here during cooking. Every decision optimized for
arm's-length readability and focus.

**Hero area**: Title in Young Serif at 2rem. Below it, a clean `<hr>` in cedar.
Then metadata: prep, cook, total time in small DM Sans, muted.

If there's an image: up to 400px wide on desktop beside the title, full-width
with 16px horizontal margin on mobile. 1px cedar border, 6px radius.

**Two-column body (desktop)**:

- **Left (sticky): Ingredients.** Generous line spacing (1.7). Both amounts and
  ingredient names in DM Sans — serif amounts were prototyped but looked too
  heavy on mobile. Section headings (`isHeading` rows) in DM Sans 500, uppercase
  at 12px with a subtle underline — clearly distinct from checkable items (no
  checkbox). Checkboxes: 24px, sage fill when checked.
- **Right: Instructions.** Step numbers in Young Serif, oversized. Step text in
  DM Sans, line-height 1.75. Steps separated by subtle border dividers for
  scannability. Checked steps dim to 40% opacity with subtle strikethrough.
  Checking a step auto-scrolls to center the next unchecked step.

**Mobile (single column)**: Ingredients first (collapsible, starts expanded),
then instructions. 17px base text for arm's-length reading. Full-row tap
targets for checkboxes.

**Personal notes**: Left-bordered with copper line. Note text in Caveat on a
subtly warm background. Empty state: dashed border, DM Sans prompt "Add your
notes..." — Caveat only appears when notes exist (it's the user's handwriting,
not the app's).

**Action bar**: Inline icon row below the description, shared by mobile and
desktop. Mobile shows icon-only buttons (cook in emerald, favorite, edit, share,
enhance) with an overflow menu for less common actions; desktop adds a text "I
Made This" button and print. Serving scaler: simple +/- stepper in the
ingredients card header.

**Print view**: Young Serif titles + clean ingredient columns print beautifully
— lean into the cookbook identity. No chrome, no colors (save ink). Ingredients
in a tight two-column layout (amount | name). Instructions numbered, compact
line-height. Source URL as small footer text. A printed recipe should feel like
a page torn from a well-designed cookbook.

---

### 4. Meal Plan

**Mobile**: Vertical day stack. Day name in Young Serif. Today highlighted with
copper pill background and subtle ring. Meals in DM Sans, text-only — no
thumbnails, which keeps the view clean and scannable. Empty days: ghost "+"
button. Past days faded (80% opacity).

**Desktop**: 7-day grid. Each day is a warm card with Young Serif day header
and generous padding. Today's card: 3px copper top-border. Should feel like
index cards on a table, not spreadsheet cells.

**"Up next" banner**: Warm card at top (linen background). Tonight's meal with
time and "Cook" action. Nothing planned: simple DM Sans suggestion. Gentle
nudge, not notification.

**Adding meals**: Inline dropdown with search, same on mobile and desktop.
Opens below the meal slot, scrollable list partitioned into "Favorites" and
"All Recipes" sections (headers shown when both groups exist). Each recipe shows
a heart icon (favorites), cook count badge, and cook time. Weeknight sort
(Mon-Thu quick recipes first) applied within each group. New meal fades in with
element-reveal curve.

---

### 5. Shopping List

Narrow, focused, satisfying to cross off.

**Layout**: Single column, 480px max-width, centered.

**Items**:

- Large checkboxes (24px), sage fill when checked.
- Item name in DM Sans 16px. Quantity/unit as a small caption below.
- Checked items: standard `line-through` (2px stone color, `decoration-2
  decoration-muted-foreground/60`). Text fades to 50% opacity.
- 10px vertical padding per item — tighter than default for efficient
  scrolling through long lists.

**Progress**: Header counter — "Shopping List (3/10)". No progress bar.

**Sorting**: Items sort by checked status first, then alphabetically by name.
No visible category headers — flat, scannable column. Category grouping was
tried and removed; it added visual noise without helping real shopping trips.
Categories are stored for inventory pipeline use but do not affect display.

**Quick add**: Inline input at top on desktop (DM Sans placeholder "Add an
item...", ghost + button). On mobile, a floating action button (FAB) in the
bottom-right opens a small dialog with name input and optional qty/unit fields
— designed for one-handed use while at the store.

**Checked item actions**: Subtle footer slides up when items are checked: "Add
to inventory" and "Clear checked" as text links.

**Print view**: Unicode checkboxes, compact spacing, no chrome. Should fit one
page for a typical weekly shop.

---

### 6. Inventory

The densest, most utilitarian surface. A reference tool you scan quickly —
closer to a spreadsheet than a cookbook.

**Layout**: Single column, 1080px max. Category tabs at top (All, Pantry,
Fridge, Freezer). Search input below.

**Items**: Flat list, DM Sans 16px. Item name left-aligned. Overflow dots at
right. Minimal row height — this list can be long and needs efficient scrolling.
**Swipe-to-delete**: on mobile, swiping left reveals an 80px destructive-red
delete button behind the row. `touch-action: pan-y` for native scroll vs swipe
discrimination, 10px dead zone, rubber-band resistance past bounds. Only one row
open at a time. Overflow menu remains as the desktop and accessibility fallback.

**Category headers** (PANTRY, FRIDGE, FREEZER): DM Sans 500, 12px, uppercase.
Colored dot indicator (amber pantry, blue fridge, etc.) and item count. Sticky
on scroll so you always know which section you're in.

**Mobile FAB**: Floating action button in the bottom-right opens a quick-add
dialog with name input and location pills (Pantry/Fridge/Freezer). Defaults to
the currently selected tab. Same pattern as the shopping list FAB — designed
for one-handed use.

**What makes it different from the shopping list**: Inventory is dense and
scannable — you're looking up what you have. Shopping list is spacious and
interactive — you're checking items off. Inventory rows are tighter (12px
vertical padding vs shopping list's 10px). No checkboxes, no strikethrough. The
visual language says "reference" not "task list."

---

## Building New Surfaces

When adding a screen not described above, start from these defaults:

- **Container**: Pick the closest width from the set (480 / 880 / 1080px). When
  nothing fits, use 880px — it works for most content-focused pages.
- **Page title**: Young Serif, 2.25rem (36px). One title per page.
- **Body text**: DM Sans 400, 16px, line-height 1.65.
- **Spacing**: 8px grid. 16px top padding (`py-4`). 24-32px between content
  groups.
- **Cards**: Paper background, 1px cedar border, 8px radius, 20-24px internal
  padding. Minimal shadow (shadow-rest).
- **Interactive elements**: Sage for primary actions, cedar borders on inputs,
  200ms transitions.
- **The test**: Does this surface feel like a cookbook page, or like a settings
  panel in a SaaS app? If the latter, add warmth — more generous padding, serif
  where appropriate, warmer backgrounds.

---

## Voice & Copy

The app should read like it was written by a person who cooks, not generated by
a language model. AI-generated copy has a recognizable register — vague
enthusiasm, filler phrases, bullet-point thinking — and it erodes trust
instantly. Every piece of text in the UI should pass a simple test: _would a
real person actually say this?_

### Principles

- **Be specific, not encouraging.** "You have 3 recipes that use chicken
  thighs" is useful. "Great job building your collection!" is filler. Never
  congratulate the user for using the product.
- **Be direct, not padded.** Say what something does in the fewest words that
  are still friendly. "Add a recipe" not "Get started by adding your first
  recipe to begin your cooking journey." Cut every word that doesn't carry
  information.
- **Avoid AI tells.** No "Unlock the power of...", "Elevate your cooking",
  "Dive into", "Explore a world of", "Seamlessly", "Effortlessly",
  "Streamline", "Supercharge", "Harness", "Leverage", "Delve". If a phrase
  sounds like it came from a marketing template, rewrite it.
- **No fake warmth.** Warmth comes from the typography and design, not from
  exclamation marks or hollow phrases. "Welcome back" is fine. "Welcome back!
  We're so excited to see you!" is not.
- **Error messages are human.** "That email is already registered" not
  "An account with this email address already exists in our system." Plain
  language, no jargon, no passive voice.
- **Empty states are calm.** A blank page with a clear action link. No
  illustrations of smiling vegetables, no "It's looking a little empty in
  here!", no multi-paragraph explanations of what the feature does.

### The same standard applies to design

The visual equivalent of AI-generated copy is generic SaaS UI: gradient hero
banners, stock illustrations, oversized feature grids, "trusted by 10,000+
users" social proof blocks, floating chat widgets. Quartermaster's design
language is warm paper and ink — if a component looks like it belongs on a
Y Combinator landing page template, it doesn't belong here.

---

## Implementation Notes

### Fonts

Young Serif and Caveat loaded via Google Fonts `<link>` tags in `root.tsx`
alongside DM Sans. `font-display: swap`. ~45KB combined (woff2).

### CSS architecture

- Colors use hex values in CSS variables. Semantic names (`--primary`,
  `--accent`, etc.) stay the same — component code doesn't change between
  themes.
- Shadow definitions use `oklch` intentionally for warm-tinted transparency;
  palette variables are hex.
- No generic type scale tokens — all sizing uses standard Tailwind classes
  directly. Purpose-driven sizes from the type scale table above.
- `prefers-reduced-motion`: global CSS rule sets `animation-duration: 0.01ms
  !important` and `transition-duration: 0.01ms !important`. `ScrollReveal`
  also checks via JS and skips animation entirely.

### Shadow tokens

Three tiers, all warm-tinted:

- `shadow-warm` — resting state (cards, containers)
- `shadow-warm-md` — hover state (card hover, elevated interactions)
- `shadow-warm-lg` — elevated state (modals, FAB dialogs)

UI primitives (dropdowns, dialogs) use standard `shadow-lg`.
