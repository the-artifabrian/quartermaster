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

### Phase 1: Foundation

#### 1.1 Recipe Management
- [ ] Create/edit/delete recipes
- [ ] Recipe fields: title, description, servings, prep time, cook time, ingredients, instructions, notes
- [ ] Support for ingredient quantities and units (2 cups, 500g, etc.)
- [ ] Recipe images (upload or URL)
- [ ] Tags/categories (cuisine, meal type, dietary: vegetarian, vegan, gluten-free)
- [ ] Favorite/bookmark recipes
- [ ] Recipe source URL (for imported recipes)

#### 1.2 Search & Browse
- [ ] Full-text search across recipe title, ingredients, instructions
- [ ] Filter by tags, cook time, difficulty
- [ ] Sort by: recently added, alphabetical, cook time, rating
- [ ] **NOT** by recently viewed (solving your Apple Notes problem)

#### 1.3 Authentication
- [ ] User accounts (Epic Stack provides this out of the box)
- [ ] Personal recipe library per user

### Phase 2: Inventory System

#### 2.1 Pantry/Fridge/Freezer Tracking
- [ ] Three inventory locations: Pantry, Fridge, Freezer
- [ ] Add ingredients with optional quantity/expiration
- [ ] Quick add from common ingredients list
- [ ] Mark items as "running low" or "out"
- [ ] Simple increment/decrement quantities

#### 2.2 Ingredient Matching
- [ ] "What can I make?" - recipes matching current inventory
- [ ] Show match percentage (e.g., "You have 8/10 ingredients")
- [ ] Highlight missing ingredients
- [ ] Filter: "Only show recipes I can make right now"

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

```prisma
// Core recipe models
model Recipe {
  id          String   @id @default(cuid())
  title       String
  description String?
  servings    Int?
  prepTime    Int?     // minutes
  cookTime    Int?     // minutes
  imageUrl    String?
  sourceUrl   String?
  notes       String?

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  ingredients RecipeIngredient[]
  instructions RecipeInstruction[]
  tags        RecipeTag[]
  mealPlans   MealPlanEntry[]

  @@index([userId])
  @@index([title])
}

model RecipeIngredient {
  id          String  @id @default(cuid())
  quantity    Float?
  unit        String? // cups, tbsp, g, oz, etc.
  name        String  // "chicken breast", "olive oil"
  notes       String? // "diced", "room temperature"
  order       Int     @default(0)

  recipeId    String
  recipe      Recipe  @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  // Link to master ingredient for matching
  ingredientId String?
  ingredient   Ingredient? @relation(fields: [ingredientId], references: [id])

  @@index([recipeId])
  @@index([ingredientId])
}

model RecipeInstruction {
  id       String @id @default(cuid())
  step     Int
  text     String

  recipeId String
  recipe   Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  @@index([recipeId])
}

model Tag {
  id      String      @id @default(cuid())
  name    String      @unique
  type    String?     // "cuisine", "meal-type", "dietary", "custom"
  recipes RecipeTag[]
}

model RecipeTag {
  recipeId String
  tagId    String
  recipe   Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  tag      Tag    @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([recipeId, tagId])
}

// Inventory models
model Ingredient {
  id       String @id @default(cuid())
  name     String @unique // normalized: "chicken breast"
  category String? // "protein", "produce", "dairy", etc.

  recipeIngredients RecipeIngredient[]
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
├── _index.tsx                    # Landing/dashboard
├── _auth+/                       # Auth routes (Epic Stack)
│   ├── login.tsx
│   ├── signup.tsx
│   └── ...
├── recipes+/
│   ├── _index.tsx                # Recipe list with search/filter
│   ├── new.tsx                   # Create recipe
│   ├── $recipeId.tsx             # View recipe
│   ├── $recipeId_.edit.tsx       # Edit recipe
│   └── $recipeId_.cook.tsx       # Cooking mode
├── inventory+/
│   ├── _index.tsx                # Inventory overview
│   ├── pantry.tsx                # Pantry items
│   ├── fridge.tsx                # Fridge items
│   └── freezer.tsx               # Freezer items
├── plan+/
│   ├── _index.tsx                # Weekly meal plan
│   └── shopping-list.tsx         # Generated shopping list
├── discover+/
│   └── _index.tsx                # "What can I make?" + suggestions
└── settings+/
    └── profile.tsx               # User settings
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

### Phase 1: Foundation (Weeks 1-2)
**Goal**: Basic recipe CRUD with search

- [ ] Set up Prisma schema for recipes
- [ ] Recipe list page with search
- [ ] Create/edit/delete recipe forms
- [ ] Recipe detail view
- [ ] Tags system
- [ ] Mobile-responsive layout
- [ ] Bottom navigation component

**Deliverable**: Can add, view, search, and organize recipes

### Phase 2: Inventory (Weeks 3-4)
**Goal**: Track what's in your kitchen

- [ ] Inventory schema and models
- [ ] Pantry/Fridge/Freezer views
- [ ] Add/remove inventory items
- [ ] Quick-add common ingredients
- [ ] Ingredient autocomplete

**Deliverable**: Can track kitchen inventory across three locations

### Phase 3: Smart Matching (Week 5)
**Goal**: Connect recipes to inventory

- [ ] Ingredient normalization/matching logic
- [ ] "What can I make?" page
- [ ] Match percentage calculation
- [ ] Missing ingredients highlight
- [ ] Filter by available ingredients

**Deliverable**: Can discover recipes based on what you have

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

### First Steps

1. **Create the Prisma schema** - Add recipe models to `prisma/schema.prisma`
2. **Run migration** - `npx prisma migrate dev --name add-recipe-models`
3. **Build recipe routes** - Start with `/recipes` list and `/recipes/new`
4. **Add mobile layout** - Bottom nav, responsive grid
5. **Iterate from there**

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
*Last updated: February 2026*
