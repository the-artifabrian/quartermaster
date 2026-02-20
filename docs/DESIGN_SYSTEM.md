# Quartermaster Design System

## The Feeling

A quiet Japanese kitchen at dawn — steam, wood, a cookbook open to a stained
page. Every decision traces back to one question: _does this feel like something
made by hand, or something assembled from components?_

### Mood References

- **Kinfolk magazine** — editorial warmth, generous whitespace, photography that
  breathes
- **Notion's typography** — the tactile, paper-like quality of well-set type on
  a pale surface
- **Japanese packaging & ceramic studio sites** — disciplined minimalism where
  every element earns its place, wabi-sabi imperfection, natural material
  textures

---

## Aesthetic Foundation

### Material Palette

Every color has a physical origin. This isn't a "brand palette" — it's the
kitchen itself.

| Name        | Hex       | Material            | Role                                   |
| ----------- | --------- | ------------------- | -------------------------------------- |
| Washi       | `#F6F1EB` | Handmade paper      | Page background                        |
| Shiro       | `#FDFAF6` | Rice paper          | Card surfaces, elevated areas          |
| Sumi        | `#2D2926` | Sumi ink            | Primary text                           |
| Cha         | `#6F6358` | Hojicha tea         | Secondary/muted text                   |
| Sugi        | `#DED6CA` | Unfinished cedar    | Borders, dividers                      |
| Kinari      | `#E8E0D4` | Raw silk            | Secondary backgrounds, hover states    |
| Matcha      | `#4E7A54` | Whisked matcha      | Primary actions, success, links        |
| Matcha-deep | `#3A6040` | Concentrated matcha | Hover/pressed states                   |
| Kawa        | `#C4956A` | Aged leather        | Warm accent, highlights, active states |
| Beni        | `#B85C4A` | Red lacquerware     | Destructive actions, errors            |
| Hai         | `#A69B8F` | Wood ash            | Disabled states, placeholders          |

**Dark mode — The kitchen at midnight:**

| Name        | Hex       | Material                   | Role            |
| ----------- | --------- | -------------------------- | --------------- |
| Sumi-dark   | `#1A1816` | Charcoal                   | Page background |
| Kuro        | `#232019` | Burnt wood                 | Card surfaces   |
| Shiro-dark  | `#E2DBD1` | Pale paper in lamplight    | Primary text    |
| Cha-dark    | `#9A8E80` | Tea by candlelight         | Secondary text  |
| Sugi-dark   | `#33302B` | Cedar in shadow            | Borders         |
| Matcha-dark | `#7FA085` | Matcha in dim light        | Primary actions |
| Kawa-dark   | `#D4A87A` | Leather catching firelight | Accent          |

**Mapping to CSS variables:**

```
Light:
--background:           #F6F1EB  (washi)
--foreground:           #2D2926  (sumi)
--card:                 #FDFAF6  (shiro)
--card-foreground:      #2D2926  (sumi)
--primary:              #4E7A54  (matcha)
--primary-foreground:   #FDFAF6  (shiro)
--secondary:            #E8E0D4  (kinari)
--secondary-foreground: #4A4139  (dark cha)
--muted:                #EDE7DE  (warm muted)
--muted-foreground:     #6F6358  (cha)
--accent:               #C4956A  (kawa)
--accent-foreground:    #2D2926  (sumi)
--border:               #DED6CA  (sugi)
--destructive:          #B85C4A  (beni)
--ring:                 #4E7A54  (matcha)

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

### Typography

Three voices, each with a purpose:

**Crimson Pro** (Serif) — _The bookbinder's hand_ For headings, recipe titles,
and anything that should feel printed-on-paper. The 300 weight is reserved for
decorative/marketing contexts (landing page hero) where legibility at arm's
length isn't required. All functional headings use 400+ for readability.

```
Google Fonts: Crimson Pro 300, 400, 600
```

| Use                       | Weight | Size            | Line height | Letter spacing |
| ------------------------- | ------ | --------------- | ----------- | -------------- |
| Landing hero (decorative) | 300    | 2.5rem (40px)   | 1.2         | -0.02em        |
| Page title (functional)   | 400    | 2.25rem (36px)  | 1.2         | -0.015em       |
| Section heading           | 600    | 1.5rem (24px)   | 1.3         | -0.01em        |
| Recipe card title         | 600    | 1.125rem (18px) | 1.3         | -0.005em       |
| Recipe card title (list)  | 400    | 1rem (16px)     | 1.4         | 0              |

**DM Sans** (Sans-serif) — _The steady hand_ Kept from the current system.
Handles body text, UI labels, metadata — everything that needs to be functional
and clear. The serif/sans pairing creates the tension between "handmade journal"
and "usable tool."

```
Already loaded: DM Sans 300-700
```

| Use          | Weight | Size             | Line height |
| ------------ | ------ | ---------------- | ----------- |
| Body text    | 400    | 1rem (16px)      | 1.65        |
| Small body   | 400    | 0.875rem (14px)  | 1.5         |
| UI label     | 500    | 0.875rem (14px)  | 1.4         |
| Caption/meta | 400    | 0.8125rem (13px) | 1.45        |
| Tiny label   | 500    | 0.75rem (12px)   | 1.3         |

**Caveat** (Handwritten) — _The personal note_ Strictly limited to two contexts:
**personal recipe notes** (the core "your cookbook" gesture) and **landing page
artifacts** (the stylized mockups). Nowhere else. A handwritten font in a search
placeholder or empty state becomes a gimmick by the third time you see it. All
other UI text uses DM Sans.

```
Google Fonts: Caveat 400, 700
```

| Use                          | Weight | Size            | Line height |
| ---------------------------- | ------ | --------------- | ----------- |
| Recipe personal note         | 400    | 1.125rem (18px) | 1.4         |
| Landing page artifact labels | 700    | 1.25rem (20px)  | 1.35        |

### Spacing & Rhythm

The Japanese concept of **MA** (間) — negative space as a deliberate design
element, not just the absence of content. Space isn't empty; it's breathing.

**Vertical rhythm base: 8px.** Everything snaps to multiples of 8.

- Between elements within a group: 8-12px
- Between groups: 24-32px
- Between sections: 48-64px
- Page top padding (below header): 32px mobile, 48px desktop
- Card internal padding: 20-24px
- Generous line-height everywhere (1.5-1.7 for running text)

**Container widths** — narrower than the current 1400px to feel bookish, but
wide enough to not waste the screen:

- Recipe detail, settings, single-focus pages: **880px** max
- Recipe list, inventory, grid-based pages: **1080px** max
- Shopping list: **480px** max (narrow by nature)
- Landing page: full-width sections, content within **960px**

### Shadows

The current warm shadow system is good in concept but too pronounced. Shadows
should feel like the natural shadow of paper resting on wood — barely there, but
enough to create depth.

```css
--shadow-rest: 0 1px 2px oklch(25% 0.02 60 / 0.06);
--shadow-hover:
	0 2px 8px oklch(25% 0.02 60 / 0.08), 0 1px 2px oklch(25% 0.02 60 / 0.04);
--shadow-elevated:
	0 4px 16px oklch(25% 0.02 60 / 0.08), 0 1px 4px oklch(25% 0.02 60 / 0.05);
```

### Corner Radius

Slightly rounded — like the corners of a well-handled card, not the aggressive
rounding of modern SaaS.

```
--radius:    0.5rem (8px)   — default (cards, inputs)
--radius-sm: 0.25rem (4px)  — small elements (badges, chips)
--radius-lg: 0.75rem (12px) — large containers, modals
```

Reduced from current values. Less "bubbly app," more "worn notebook."

### Animation Language

Every animation should feel organic — like paper settling, steam dissipating,
ink spreading. Never mechanical, never theatrical.

| Interaction       | Curve                                 | Duration | Description                                                                                                               |
| ----------------- | ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| Page settle       | `cubic-bezier(0.22, 0.68, 0.35, 1.0)` | 320ms    | Elements finding their place after page load. Slow start, no overshoot. Like a page coming to rest after being turned.    |
| Hover lift        | `cubic-bezier(0.34, 0.01, 0.21, 1)`   | 180ms    | Cards responding to touch. Quick initial response, gentle settle. Like pressing your finger on paper and feeling it give. |
| Element reveal    | `cubic-bezier(0.16, 0.85, 0.45, 1)`   | 280ms    | Staggered fade-up for lists. Items appear like steam rising — slow departure, smooth arrival.                             |
| Micro-interaction | `cubic-bezier(0.33, 1, 0.68, 1)`      | 150ms    | Checkboxes, toggles, small state changes. Snappy but not robotic.                                                         |
| Exit/dismiss      | `cubic-bezier(0.55, 0.0, 0.68, 0.19)` | 200ms    | Things leaving. Quick departure, no lingering.                                                                            |

**Stagger delay for lists: 40ms** between items, max 6 items animated (rest
appear instantly).

### Texture & Details

Subtle cues that the surface is paper, not glass:

- **Dividers**: 1px lines using `border-color` (sugi), never heavy. Consider
  using a slightly irregular SVG line for key dividers (recipe title underline)
  — a single, hand-drawn-feeling horizontal rule.
- **Card borders**: 1px solid, muted. On hover, the border warms slightly (shift
  toward `kawa` at 20% opacity).
- **Image treatment**: Recipe photos get `border-radius: 6px` and a 1px border
  in `sugi` color — like a printed photograph with a paper edge. No aggressive
  object-cover cropping; prefer slight letterboxing over cutting off food.
- **Empty states**: DM Sans in muted cha color, dashed borders using 6px dash /
  8px gap. Warm and inviting, not clinical — but no handwritten font (Caveat
  reserved for personal notes + landing page only).

---

## Data Shapes (from actual loaders)

Design around these real structures, not placeholder text.

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

---

## Surface Designs

### 1. Landing Page — "The First Page of a Journal"

**Concept**: You've just opened a beautiful cooking journal. The first page
doesn't sell you anything — it invites you in. No hero images, no feature grids,
no "trusted by 10,000 cooks" social proof. Just a quiet statement of intent and
a glimpse of what's inside.

**Emotional response**: Curiosity. Warmth. "This feels different from every
other app." A sense of stumbling into someone's personal kitchen, not arriving
at a product page.

**Structure**:

**Opening (full viewport height)**: A cream paper background (washi). Centered,
a single sentence in large Crimson Pro light (300 weight — one of the few places
this decorative weight is used):

> _"What are we making this week?"_

Not a headline — a question. The kind you ask yourself on a Sunday morning.
Below it, a small line of DM Sans in muted cha color: "A quiet place to keep
your recipes, plan your meals, and cook with intention." Two buttons: "Start
cooking" (matcha, primary) and "See how it works" (ghost/text). The whole
section breathes — 30-40% of the viewport is negative space.

**The Glimpse (scroll down)**: Instead of feature cards with icons, show three
_artifacts_ from the app itself — rendered as if they're physical objects on a
wooden surface:

1. **A recipe card** — rendered at an angle (2° rotation, subtle shadow),
   showing a real recipe layout with Crimson Pro title, ingredient list, a small
   photo. It looks like an index card from a recipe box.
2. **A week view** — a simple handwritten-style week (Mon through Sun) with a
   few meals penciled in. Uses Caveat font for the meal names. Feels like a note
   on the fridge.
3. **A shopping list** — a torn-paper-edged note with a few items, some checked
   off with a line through them. Intimate, domestic.

Each artifact fades up as you scroll to it (element reveal curve, 280ms),
staggered left-right-left. They're not screenshots — they're stylized,
simplified representations. Think illustration, not documentation.

**The Close**: A simple final section: "Your recipes deserve a home." with a
single CTA. No footer clutter on the landing page itself — just warmth and an
invitation.

**Why this works**: The restraint communicates confidence. Artifacts show rather
than tell — you _see_ the app's personality before signing up. Paper textures
and handwritten elements signal "personal, not corporate."

---

### 2. Recipe List — "The Recipe Box"

**Concept**: You've pulled open the drawer of a wooden recipe box. Cards of
different ages, some with photos tucked in, some with just a title and a note in
the margin. The interface should feel like browsing physical cards — scannable,
tactile, personal.

**Emotional response**: Familiarity. The pleasure of flipping through a
collection you've built yourself. Recognition and anticipation when you spot a
favorite.

**Layout**:

**Mobile (375px)**: A single-column list. Each recipe is a horizontal card —
small square photo on the left (64px, like a polaroid thumbnail), title and
description on the right. If no photo, the placeholder shows just the first
letter in a warm serif on a muted background. Compact but breathing — 16px
vertical gap between cards. Touch targets are the full card width.

The search bar lives at the top as a simple text input with a warm background
and placeholder text in DM Sans: _"Search recipes..."_ Filter chips below: time,
favorites, "can make." Filters feel like sticky notes — kinari background,
rounded, gentle.

**Desktop (>768px)**: A standard grid (two columns at `md`, three at `lg`) but
cards have **natural height variation** — no forced equal heights or fixed
aspect ratios. A card with a photo, description, and cook history is taller than
one with just a title. This creates the "index cards of different ages" feel
without masonry layout complexity (CSS `columns` would break sort order; JS
masonry libraries add weight for minimal benefit).

**Recipe cards (redesigned)**:

- **With photo**: Photo fills the top of the card (aspect-ratio: 4/3). 1px sugi
  border around the image. Title in Crimson Pro 600 below, one line. Cook time
  as a small caption in cha color. Favorite heart is small, tucked in the
  top-right of the image area. Match ring is small and subtle.
- **Without photo**: The card is shorter. Title in slightly larger Crimson Pro.
  Background is plain shiro. A subtle motif (a small herb illustration or just
  the initial letter in very large, very light serif) provides visual interest
  without pretending to be a photo.
- **Hover**: Card lifts 2px (shadow-hover), border warms slightly. The image
  scales 1.02x (barely perceptible, but adds life). 180ms hover-lift curve.

**Why this works**: Variable-height cards and horizontal mobile format feel like
flipping through physical index cards, not querying a database. Warm filter
chips and serif card titles signal "your space."

---

### 3. Recipe Detail — "The Open Cookbook"

**Concept**: You've laid a cookbook flat on the counter next to the cutting
board. The page is open to a recipe you've made before — there's a small sauce
stain you can't quite scrub out, and you've penciled a note in the margin. This
page needs to work at arm's length with wet hands.

**Emotional response**: Confidence. Calm focus. You know exactly where
everything is. There's no cognitive overhead — just the recipe, ready to cook.

**Structure**:

**Hero area**: The recipe title in Crimson Pro 400 (readable at arm's length —
this is the page you stare at while cooking). Below it, a thin hand-drawn-style
SVG divider line. Then metadata: prep time, cook time, source — in small DM
Sans, muted, with minimal visual weight. If there's an image, it's prominent —
on desktop it sits beside the title area at up to **400px** width, with a subtle
1px sugi border and 6px radius (photograph-in-a-book treatment, not a hero
banner). On mobile, the image is below the title, full-width but with 16px
horizontal margin so it doesn't feel edge-to-edge corporate.

**Two-column body (desktop)**:

- **Left (sticky): Ingredients**. A simple list with generous line spacing
  (1.7). Ingredient amounts in slightly bolder weight. Section headings
  (isHeading rows) in small-caps Crimson Pro with a subtle underline. Checkboxes
  are large (24px) and warm-colored when checked (matcha).
- **Right: Instructions**. Numbered with large, light-weight numbers (Crimson
  Pro 400, oversized — like chapter numbers in a book). Step text in DM Sans
  with very generous line-height (1.75). Each step has breathing room below it
  (24px). Checked steps dim to 40% opacity and gain a subtle line-through.

**Mobile (single column)**: Ingredients first (collapsible, starts expanded).
Then instructions. Both with extra-large touch targets (entire row is tappable
for checkboxes). Text bumped to 17px base size for arm's-length reading.

**Cooking mode enhancements**: When the user starts checking off items, the
interface is already cooking-friendly by default. But the floating action bar at
the bottom (mobile) should feel like a wooden shelf — warm background (kinari),
softly elevated, with "I Made This" as the primary action. Serving scaler is a
simple +/- stepper, not a dropdown.

**Personal notes section**: If the user has notes, they appear in a distinct
area styled like a margin note — left-bordered with a kawa-colored line, text in
Caveat font, on a subtly warm background. Empty state: a dashed-border area with
DM Sans prompt in cha color: _"Add your notes..."_ (the Caveat font appears only
once notes are written — it's the user's handwriting, not the app's). This makes
it feel like writing in the margin of your own cookbook.

**Why this works**: Thin serif title + two-column layout echoes an actual
cookbook spread. Generous spacing works at arm's length. Handwritten notes
create ownership — YOUR recipe in YOUR book.

---

### 4. Meal Plan — "The Week Ahead"

**Concept**: A note pinned to the refrigerator. Not a calendar application — a
simple, handwritten plan for the week. Each day is a thought, not a cell in a
grid. The plan should feel like anticipation (looking forward to meals) rather
than scheduling (filling slots).

**Emotional response**: Gentle anticipation. "Wednesday is that pasta dish." The
satisfaction of having a loose plan without the pressure of a packed calendar.

**Layout**:

**Mobile**: A vertical stack. Each day is a row:

- Day name in Crimson Pro 600 (Mon, Tue, Wed...). Today is highlighted with a
  kawa pill label and a subtle ring (`bg-accent/10`, `ring-1 ring-accent/20`).
- Meals listed below in DM Sans, indented slightly, with small recipe thumbnails
  (32px circles, like stamps in a passport).
- Empty days show _"Nothing planned"_ with a ghost + button (no border, hover
  reveals background). Keeps visual noise low when many days are empty.
- Days scroll naturally. No forced equal-height cards. Past days are slightly
  faded (80% opacity). Future days are full contrast.

**Desktop**: A compact **7-day grid** that preserves the at-a-glance weekly view
(meal planning is fundamentally about seeing the whole week — variety, balance,
rhythm). But styled as a row of index cards, not a spreadsheet: each day is a
warm card with natural height variation, generous internal padding, Crimson Pro
day headers. Today's card has a kawa top-border (3px), a subtle accent ring, and
a pill-style day label. The grid should feel like seven recipe cards laid out on
a table, not cells in Google Calendar.

**Tonight banner**: Redesigned as a warm card at the top with a subtle gradient
(washi → kinari). Shows tonight's meal with its photo, time, and a "Let's cook"
link. If nothing's planned, shows a DM Sans suggestion: _"Nothing planned for
tonight"_ with a recipe suggestion from favorites. Gentle nudge, not
notification.

**Adding a recipe**: Tapping the + on a day opens a bottom sheet (mobile) or
inline dropdown (desktop) with a simple search. Selected recipe appears with a
subtle "writing-in" animation — the text fades in with the element-reveal curve,
as if being penciled in.

**Why this works**: Desktop keeps the bird's-eye view (essential for planning)
but styles it as index cards, not spreadsheet cells. Mobile vertical stack works
because you can't fit 7 columns on a phone anyway. Warm styling and Crimson Pro
headers shift the register from "obligation" to "intention."

---

### 5. Shopping List — "The Scrap of Paper"

**Concept**: A piece of paper torn from a notepad, tucked into your pocket or
propped on the counter. This is the most utilitarian surface, but utility
doesn't mean soulless. Even a scrap of paper has character — the handwriting,
the crossings-out, the way it gets crumpled at the edges.

**Emotional response**: Purposeful simplicity. The satisfaction of crossing
things off. A direct connection between planning and doing.

**Layout**:

Single column, 480px max-width, centered. This is a list — it should feel narrow
and focused, like a physical shopping list, not a sprawled interface.

**Items**:

- Large checkboxes (24px), warm matcha fill when checked.
- Item name in DM Sans 16px, with quantity/unit as a subtle caption below or to
  the right.
- Checked items: struck through with a slightly thick line (2px) in cha color,
  text fades to 50% opacity. The line-through should feel like a pen stroke —
  apply it with a brief left-to-right animation (200ms, micro-interaction curve)
  when the checkbox is tapped.
- Items have generous vertical padding (16px) for easy touch targets.

**Categories**: Minimal dividers. Category name in DM Sans 12px, all-caps,
letter-spacing 0.08em, in hai (ash) color. 32px of space above a category
header, 12px below. The categories create rhythm without creating visual blocks.

**Quick add**: A simple input at the top with DM Sans placeholder: _"Add an
item..."_ A subtle ghost + icon button sits at the right edge (discoverable on
mobile where Enter isn't always obvious). The input has a bottom-border only (no
full border), like writing on a ruled line.

**Checked item actions**: When items are checked, a subtle footer appears
(slides up, element-reveal curve) with "Add to inventory" and "Clear checked."
These actions are understated — text links, not buttons.

**Print view**: Strips away all chrome. Just the list, with Unicode checkboxes
(☐ / ☑), compact spacing, and a small "Quartermaster" wordmark at the bottom.
Should fit on a single page for a typical weekly shop.

**Why this works**: Narrow column + large touch targets + animated line-through
create a satisfying physical rhythm. Warmth without friction.

---

## Implementation Notes

### What changes about shadcn/ui

Components that stay (restyled): Button, Input, Checkbox, Dialog, DropdownMenu,
Select, Label, Popover. These are structural primitives that just need new
colors, radii, and typography.

Components that get significant restyling: Card (reduced shadow, warmer borders,
new padding), Badge (softer, more muted), Toast (warmer tone, subtler).

What we add: A custom `Divider` component (the hand-drawn SVG line), a
`HandwrittenText` component (wraps Caveat usage for consistent sizing), and
potentially a `PageContainer` for the narrower max-width layouts.

### Font loading strategy

Add Crimson Pro and Caveat via Google Fonts `<link>` tags in `root.tsx`,
alongside existing DM Sans. Use `font-display: swap` to prevent FOIT. Preconnect
is already in place.

### Color migration

Replace all oklch values in `tailwind.css` with the hex values above. The
semantic variable names (--background, --primary, etc.) stay the same, so
component code doesn't need to change — just the values behind the variables.

### Performance considerations

- Caveat and Crimson Pro add ~60KB combined (woff2). Acceptable for the
  character they bring.
- No texture images or background patterns — all visual texture comes from color
  and typography.
- Animations use transform and opacity only (GPU-composited).
- `prefers-reduced-motion` respected: all animations already gate on this
  (existing CSS in tailwind.css).
