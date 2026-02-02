# Quartermaster - Recipe Management App Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application designed to solve the pain points of managing 100+ recipes in Apple Notes:

- Difficult to search and browse recipes
- Recently viewed recipes bubble to top (due to checkbox interactions)
- No ingredient-based discovery
- No meal planning capabilities

### Target User

You (a full-stack JavaScript developer) - building for personal use first, with potential for future expansion.

---

## Core Features (MVP)

### Phase 1: Foundation ✅ COMPLETE

#### 1.1 Recipe Management
- [x] Create/edit/delete recipes
- [x] Recipe fields: title, description, servings, prep time, cook time, ingredients, instructions
- [x] Support for ingredient quantities and units (2 cups, 500g, etc.)
- [x] Recipe images (upload to S3-compatible storage)
- [x] Tags/categories (cuisine, meal type, dietary: vegetarian, vegan, gluten-free)
- [ ] Favorite/bookmark recipes *(deferred to Phase 1.5)*
- [ ] Recipe source URL (for imported recipes) *(deferred to Phase 1.5)*

#### 1.2 Search & Browse
- [x] Full-text search across recipe title, ingredients, description
- [x] Filter by tags
- [x] Sort by: recently updated (default)
- [x] **NOT** by recently viewed (solving your Apple Notes problem)
- [ ] Filter by cook time, difficulty *(deferred to Phase 1.5)*

#### 1.3 Authentication
- [x] User accounts (Epic Stack provides this out of the box)
- [x] Personal recipe library per user

### Phase 2: Inventory System ✅ COMPLETE

#### 2.1 Pantry/Fridge/Freezer Tracking
- [x] Three inventory locations: Pantry, Fridge, Freezer
- [x] Add ingredients with optional quantity/expiration
- [x] Quick add from common ingredients list
- [x] Mark items as "running low" or "out"
- [x] Simple increment/decrement quantities

#### 2.2 Ingredient Matching
- [x] "What can I make?" - recipes matching current inventory
- [x] Show match percentage (e.g., "You have 8/10 ingredients")
- [x] Highlight missing ingredients
- [x] Filter: "Only show recipes I can make right now"

### Phase 3: Meal Planning

#### 3.1 Weekly Planner
- [ ] Calendar view (week at a glance)
- [ ] Drag-and-drop recipes to days
- [ ] Multiple meals per day (breakfast, lunch, dinner, snacks)
- [ ] Quick "Cook again" from recent history

#### 3.2 Shopping List Generation
- [ ] Auto-generate shopping list from meal plan
- [ ] Subtract items already in inventory
- [ ] Group by store section (produce, dairy, meat, etc.)
- [ ] Check off items while shopping
- [ ] Manual add items to list

### Phase 4: Smart Features

#### 4.1 Recipe Suggestions
- [ ] Suggest recipes based on:
  - Ingredients about to expire
  - Ingredients you have a lot of
  - Recipes you haven't made in a while
  - Seasonal ingredients
- [ ] "Surprise me" random recipe from collection

#### 4.2 Cooking Mode
- [ ] Distraction-free step-by-step view
- [ ] Large text for kitchen use
- [ ] Keep screen awake
- [ ] Voice commands (stretch goal)

---

## Technical Architecture

### Tech Stack (Epic Stack)

```
Frontend:        React Router v7 (Remix)
Styling:         Tailwind CSS + shadcn/ui components
Database:        SQLite (via better-sqlite3)
ORM:             Prisma
Auth:            Epic Stack auth (session-based)
Validation:      Zod + Conform
Deployment:      Fly.io (or self-host)
Testing:         Vitest + Playwright
```

### Database Schema (Prisma)

#### Phase 1 Implementation ✅

```prisma
// Core recipe models - IMPLEMENTED
model Recipe {
  id          String   @id @default(cuid())
  title       String
  description String?
  servings    Int      @default(4)
  prepTime    Int?     // minutes
  cookTime    Int?     // minutes

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId      String

  image        RecipeImage?
  ingredients  Ingredient[]
  instructions Instruction[]
  tags         Tag[]

  @@index([userId])
  @@index([title])
}

model RecipeImage {
  id        String   @id @default(cuid())
  altText   String?
  objectKey String   // S3-compatible storage key

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  recipe    Recipe   @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  recipeId  String   @unique
}

model Ingredient {
  id       String  @id @default(cuid())
  name     String
  amount   String? // "2", "1/2" (string for fractions)
  unit     String? // "cups", "tbsp"
  notes    String? // "diced", "room temperature"
  order    Int     @default(0)

  recipe   Recipe  @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  recipeId String

  @@index([recipeId])
}

model Instruction {
  id       String @id @default(cuid())
  content  String
  order    Int

  recipe   Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  recipeId String

  @@index([recipeId])
}

model Tag {
  id       String   @id @default(cuid())
  name     String   @unique
  category String   // "cuisine", "meal-type", "dietary"
  recipes  Recipe[]
}
```

#### Future Phases (Planned)

```prisma
// Inventory models (Phase 2+)
model MasterIngredient {
  id       String @id @default(cuid())
  name     String @unique // normalized: "chicken breast"
  category String? // "protein", "produce", "dairy", etc.

  inventoryItems    InventoryItem[]
}

model InventoryItem {
  id           String   @id @default(cuid())
  location     String   // "pantry", "fridge", "freezer"
  quantity     Float?
  unit         String?
  expiresAt    DateTime?
  lowStock     Boolean  @default(false)

  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  ingredientId String
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id])

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([userId, ingredientId, location])
  @@index([userId])
}

// Meal planning models
model MealPlan {
  id        String   @id @default(cuid())
  weekStart DateTime // Monday of the week

  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  entries   MealPlanEntry[]

  @@unique([userId, weekStart])
}

model MealPlanEntry {
  id       String   @id @default(cuid())
  date     DateTime
  mealType String   // "breakfast", "lunch", "dinner", "snack"

  mealPlanId String
  mealPlan   MealPlan @relation(fields: [mealPlanId], references: [id], onDelete: Cascade)

  recipeId String
  recipe   Recipe   @relation(fields: [recipeId], references: [id])

  @@index([mealPlanId])
}

// Shopping list
model ShoppingList {
  id        String   @id @default(cuid())
  name      String   @default("Shopping List")

  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  items     ShoppingListItem[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model ShoppingListItem {
  id         String  @id @default(cuid())
  name       String
  quantity   Float?
  unit       String?
  category   String? // for grouping in store
  checked    Boolean @default(false)

  listId     String
  list       ShoppingList @relation(fields: [listId], references: [id], onDelete: Cascade)

  @@index([listId])
}
```

### Route Structure

```
app/routes/
├── _marketing/
│   └── index.tsx                 # Landing page
├── _auth/                        # Auth routes (Epic Stack)
│   ├── login.tsx
│   ├── signup.tsx
│   └── ...
├── recipes/                      # ✅ IMPLEMENTED
│   ├── _layout.tsx               # Layout with bottom nav
│   ├── index.tsx                 # Recipe list with search/filter
│   ├── new.tsx                   # Create recipe
│   ├── $recipeId.tsx             # View recipe
│   ├── $recipeId_.edit.tsx       # Edit recipe
│   └── $recipeId_.cook.tsx       # Cooking mode (future)
├── inventory/                    # Phase 2
│   ├── _index.tsx                # Inventory overview
│   ├── pantry.tsx                # Pantry items
│   ├── fridge.tsx                # Fridge items
│   └── freezer.tsx               # Freezer items
├── plan/                         # Phase 4
│   ├── _index.tsx                # Weekly meal plan
│   └── shopping-list.tsx         # Generated shopping list
├── discover/                     # Phase 3
│   └── _index.tsx                # "What can I make?" + suggestions
└── settings/
    └── profile/                  # User settings (Epic Stack)
```

---

## Mobile-First UI Considerations

### Design Principles

1. **Thumb-friendly**: Primary actions in bottom 1/3 of screen
2. **Large touch targets**: Minimum 44x44px tap areas
3. **Bottom navigation**: Main nav at bottom, not top
4. **Swipe gestures**: Swipe to delete, swipe to add to list
5. **Pull to refresh**: Natural mobile pattern
6. **Offline-friendly**: Service worker for offline recipe viewing

### Key Mobile Patterns

```
┌─────────────────────────┐
│  Search...          [+] │  <- Sticky header
├─────────────────────────┤
│                         │
│  ┌─────┐ ┌─────┐       │
│  │     │ │     │       │  <- Recipe cards (2-col grid)
│  │ 🍝  │ │ 🥗  │       │
│  │Pasta│ │Salad│       │
│  └─────┘ └─────┘       │
│                         │
│  ┌─────┐ ┌─────┐       │
│  │     │ │     │       │
│  │ 🍲  │ │ 🥘  │       │
│  │ Soup│ │Curry│       │
│  └─────┘ └─────┘       │
│                         │
├─────────────────────────┤
│ 🏠  📖  🥬  📅  👤    │  <- Bottom nav
│Home Recipe Inv Plan User│
└─────────────────────────┘
```

### Responsive Breakpoints

```css
/* Mobile first */
sm: 640px   /* Large phones, small tablets */
md: 768px   /* Tablets */
lg: 1024px  /* Laptops */
xl: 1280px  /* Desktops */
```

---

## Development Phases & Timeline

### Phase 1: Foundation ✅ COMPLETE
**Goal**: Basic recipe CRUD with search

- [x] Set up Prisma schema for recipes
- [x] Recipe list page with search
- [x] Create/edit/delete recipe forms
- [x] Recipe detail view
- [x] Tags system (16 predefined tags across cuisine, meal-type, dietary)
- [x] Mobile-responsive layout (1 col → 2 col → 3 col grid)
- [x] Bottom navigation component (mobile only)

**Deliverable**: Can add, view, search, and organize recipes

#### Phase 1 Implementation Notes

**Database Models Created:**
- `Recipe` - Core recipe with title, description, servings, prep/cook time
- `RecipeImage` - Single image per recipe (S3-compatible storage)
- `Ingredient` - Ingredients with name, amount, unit, notes, order
- `Instruction` - Steps with content and order
- `Tag` - Predefined tags with category (many-to-many with recipes)

**Routes Created:**
- `/recipes` - Recipe list with search & tag filtering
- `/recipes/new` - Create recipe form
- `/recipes/:recipeId` - View recipe detail
- `/recipes/:recipeId/edit` - Edit recipe + delete

**Components Created:**
- `recipe-card.tsx` - Recipe card for grid display
- `recipe-form.tsx` - Shared create/edit form
- `ingredient-fields.tsx` - Dynamic ingredient inputs
- `instruction-fields.tsx` - Dynamic instruction inputs
- `bottom-nav.tsx` - Mobile bottom navigation

### Phase 2: Inventory ✅ COMPLETE
**Goal**: Track what's in your kitchen

- [x] Inventory schema and models
- [x] Pantry/Fridge/Freezer views
- [x] Add/remove inventory items
- [x] Quick-add common ingredients
- [x] Ingredient matching with fuzzy logic
- [x] "What can I make?" discover page
- [x] Match percentage calculation
- [x] Missing ingredients highlight
- [x] Filter by available ingredients

**Deliverable**: Can track kitchen inventory and discover recipes based on what you have

#### Phase 2 Implementation Notes

**Database Models Created:**
- `InventoryItem` - Free-text inventory items with location, quantity, unit, expiration, lowStock flag

**Routes Created:**
- `/inventory` - Inventory list with location tabs (All/Pantry/Fridge/Freezer)
- `/inventory/new` - Add inventory item form
- `/inventory/:id/edit` - Edit/delete inventory item
- `/discover` - Recipe discovery with match percentages

**Components Created:**
- `inventory-item-card.tsx` - Inventory item card with quick actions
- `inventory-quick-add.tsx` - Inline quick-add form
- `inventory-location-tabs.tsx` - Location filter tabs
- `common-ingredients.tsx` - Quick-add buttons for 30 common ingredients
- `recipe-match-card.tsx` - Enhanced recipe card with match percentage badge

**Utilities Created:**
- `inventory-validation.ts` - Zod schemas for inventory items
- `recipe-matching.server.ts` - Fuzzy matching algorithm with ingredient normalization

**Navigation:**
- Bottom nav updated to 5 items: Home, Recipes, New, Inventory, Discover

### Phase 4: Meal Planning (Weeks 6-7)
**Goal**: Plan your week

- [ ] Weekly calendar view
- [ ] Drag-and-drop recipes to days
- [ ] Shopping list generation
- [ ] Inventory subtraction
- [ ] Category grouping for shopping

**Deliverable**: Can plan meals and generate shopping lists

### Phase 5: Polish & UX (Week 8)
**Goal**: Make it delightful to use

- [ ] Cooking mode (step-by-step)
- [ ] PWA setup (offline, installable)
- [ ] Performance optimization
- [ ] Recipe suggestions
- [ ] Data import tool (for your Apple Notes)

**Deliverable**: Production-ready personal app

---

## Data Migration Strategy

### Importing from Apple Notes

Since you have 100+ recipes in Apple Notes, you'll need a migration path:

1. **Manual entry** (tedious but clean)
2. **Export Notes as HTML/PDF** and parse
3. **Copy-paste with smart parsing** - Build a "quick import" that parses pasted text:

```
Paste your recipe:
─────────────────────────
Spaghetti Carbonara

Ingredients:
- 400g spaghetti
- 200g guanciale
- 4 egg yolks
- 100g pecorino

Instructions:
1. Cook pasta
2. Fry guanciale
3. Mix eggs and cheese
4. Combine everything
─────────────────────────
[Parse & Import]
```

The parser would use simple heuristics:
- First line = title
- Lines after "Ingredients:" = ingredients (parse quantity/unit/name)
- Lines after "Instructions:" = steps

---

## Future Enhancements (Post-MVP)

- **Recipe scaling**: Adjust servings, auto-scale ingredients
- **Nutrition info**: Integrate with nutrition API
- **Recipe sharing**: Share individual recipes via link
- **Import from URL**: Scrape recipes from websites
- **Voice input**: "Add 2 cups flour to shopping list"
- **Barcode scanning**: Scan products to add to inventory
- **Multi-user households**: Shared inventory and meal plans
- **Cost tracking**: Track ingredient costs, meal budgeting

### AI-Powered Features (Nice to Have)

Leverage AI (Claude API, OpenAI, or local models) to enhance the cooking experience:

#### Ingredient Substitutions
- **Smart substitutions when missing ingredients**: When you're missing an ingredient for a recipe, AI suggests practical alternatives
  - Example: "Don't have buttermilk? Use 1 cup milk + 1 tbsp lemon juice"
  - Context-aware suggestions based on the recipe type and cooking method
  - Explain how the substitution affects taste/texture

#### Healthy Recipe Modifications
- **Health-goal substitutions**: AI recommends ingredient swaps to meet dietary goals
  - **Lower cholesterol**: Suggest egg whites instead of whole eggs, olive oil instead of butter
  - **Increase protein**: Add Greek yogurt, quinoa, or lean proteins
  - **Reduce sodium**: Alternative seasonings and flavor enhancers
  - **Lower carbs**: Cauliflower rice, zucchini noodles, almond flour alternatives
  - **Allergen-free**: Dairy-free, gluten-free, nut-free substitutions

- **Nutritional impact preview**: Show estimated changes in calories, protein, fat, etc.
- **Multiple suggestion levels**: Conservative swaps vs. more adventurous alternatives
- **Recipe rewrite**: AI can rewrite entire recipe with healthier ingredients while maintaining flavor profile

#### Implementation Considerations
- Use Claude API for context-aware, detailed substitution explanations
- Cache common substitution patterns to reduce API costs
- Allow users to save favorite substitutions for future use
- Integrate with recipe view: "🤖 Get AI suggestions" button on each recipe

---

## Getting Started

### Prerequisites

```bash
node -v  # Should be >= 20
npm -v   # Should be >= 10
```

### Initial Setup

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your values

# 3. Initialize database
npm run setup

# 4. Start development
npm run dev
```

### First Steps ✅ COMPLETE

1. ~~**Create the Prisma schema** - Add recipe models to `prisma/schema.prisma`~~
2. ~~**Run migration** - `npx prisma migrate dev --name add-recipe-models`~~
3. ~~**Build recipe routes** - Start with `/recipes` list and `/recipes/new`~~
4. ~~**Add mobile layout** - Bottom nav, responsive grid~~
5. **Iterate from there** - Continue to Phase 2

### Next Steps (Phase 2)

1. **Add inventory models** - Create Ingredient, InventoryItem models
2. **Build inventory routes** - `/inventory`, `/inventory/pantry`, etc.
3. **Link recipes to inventory** - Ingredient normalization
4. **Test the full flow** - Add recipes, track inventory, find matches

---

## Success Metrics

For a personal app, "success" means:

- [ ] All 100+ recipes migrated from Apple Notes
- [ ] Can find any recipe in < 5 seconds
- [ ] Weekly meal planning takes < 5 minutes
- [ ] Shopping list generation is automatic
- [ ] App is usable in the kitchen (cooking mode)
- [ ] Works offline for viewing recipes

---

## Questions to Consider

Before starting implementation:

1. **Do you want to self-host or use a managed service?** (Fly.io is cheap and easy)
2. **Do you need multi-device sync?** (SQLite is single-file, but can replicate with Litestream)
3. **How structured are your Apple Notes recipes?** (Affects migration strategy)
4. **Do you want to track recipe ratings/history?** (When you made it, how it turned out)
5. **Do you care about recipe scaling?** (2 servings → 8 servings)

---

## Resources

- [Epic Stack Documentation](https://github.com/epicweb-dev/epic-stack/tree/main/docs)
- [Remix Documentation](https://remix.run/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [shadcn/ui Components](https://ui.shadcn.com/)

---

*Document created: February 2026*
*Last updated: February 2, 2026 - Phase 1 & 2 complete*
