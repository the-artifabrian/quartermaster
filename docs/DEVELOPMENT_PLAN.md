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

### Phase 3: Meal Planning ✅ COMPLETE

#### 3.1 Weekly Planner
- [x] Calendar view (week at a glance)
- [x] Click/tap to assign recipes to meal slots
- [x] Multiple meals per day (breakfast, lunch, dinner, snacks)
- [x] Week navigation (previous/next/current week)
- [x] Mobile-optimized with horizontal scroll
- [ ] Drag-and-drop recipes (desktop - deferred)
- [ ] Quick "Cook again" from recent history (deferred)

#### 3.2 Shopping List Generation
- [x] Auto-generate shopping list from meal plan
- [x] Group by store section (produce, dairy, meat, pantry, frozen, bakery, other)
- [x] Check off items while shopping
- [x] Manual add items to list
- [x] Clear checked items
- [x] Ingredient quantity consolidation (same unit)
- [x] Subtract items already in inventory *(implemented in Phase 4)*

### Phase 4: Smart Features ✅ COMPLETE

#### 4.1 Inventory-Aware Shopping List
- [x] Subtract items already in inventory (unless low stock)
- [x] Remove staple ingredients (salt, pepper, oil, water)
- [x] Show count of removed items after generation

#### 4.2 Multiple Recipes per Meal Slot
- [x] Multiple recipes per meal slot (e.g., main + sides for dinner)
- [x] "Add Another" button on filled meal slots
- [x] Exclude already-assigned recipes from selector

#### 4.3 Recipe Scaling
- [x] Adjust servings with +/- buttons
- [x] Scale ingredient quantities with fraction display (1/2, 1 1/4, etc.)
- [x] URL-based scaling (?servings=N) for bookmarkable scaled views
- [x] Reset link to return to original servings

#### 4.4 Cooking Mode
- [x] Full-screen step-by-step instruction view
- [x] Large text for kitchen use (text-2xl/3xl)
- [x] Keep screen awake (Wake Lock API)
- [x] Collapsible ingredients panel
- [x] Progress bar
- [x] Previous/Next navigation with large touch targets
- [ ] Voice commands (stretch goal - deferred)

#### 4.5 Recipe Suggestions (Future)
- [ ] Suggest recipes based on:
  - Ingredients about to expire
  - Ingredients you have a lot of
  - Recipes you haven't made in a while
  - Seasonal ingredients
- [ ] "Surprise me" random recipe from collection

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

#### Phase 2 Implementation ✅

```prisma
// Inventory model - IMPLEMENTED
model InventoryItem {
  id        String    @id @default(cuid())
  name      String    // Free-text: "chicken breast", "Chicken Breasts"
  location  String    // "pantry", "fridge", "freezer"
  quantity  Float?    // Optional: 2.5
  unit      String?   // Optional: "lbs", "cups", "count"
  expiresAt DateTime?
  lowStock  Boolean   @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId String

  @@index([userId])
  @@index([userId, location])
}
```

#### Phase 3 Implementation ✅

```prisma
// Meal planning models - IMPLEMENTED
model MealPlan {
  id        String   @id @default(cuid())
  weekStart DateTime // Monday midnight UTC
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  entries   MealPlanEntry[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, weekStart])
  @@index([userId])
}

model MealPlanEntry {
  id         String   @id @default(cuid())
  date       DateTime // Specific date for this meal
  mealType   String   // "breakfast", "lunch", "dinner", "snack"
  mealPlanId String
  mealPlan   MealPlan @relation(fields: [mealPlanId], references: [id], onDelete: Cascade)
  recipeId   String
  recipe     Recipe   @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  createdAt  DateTime @default(now())

  @@index([mealPlanId])
  @@index([recipeId])
  @@unique([mealPlanId, date, mealType, recipeId])
}

// Shopping list models - IMPLEMENTED
model ShoppingList {
  id        String   @id @default(cuid())
  name      String   @default("Shopping List")
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  items     ShoppingListItem[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}

model ShoppingListItem {
  id         String   @id @default(cuid())
  name       String
  quantity   String?  // Freeform: "2", "1/2 cup", etc.
  unit       String?
  category   String?  // "produce", "dairy", "meat", "pantry", "frozen", "bakery", "other"
  checked    Boolean  @default(false)
  source     String   @default("manual") // "manual" or "generated"
  listId     String
  list       ShoppingList @relation(fields: [listId], references: [id], onDelete: Cascade)
  createdAt  DateTime @default(now())

  @@index([listId])
  @@index([listId, checked])
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
│   └── $recipeId_.cook.tsx       # Cooking mode (full-screen step-by-step)
├── inventory/                    # ✅ IMPLEMENTED
│   ├── index.tsx                 # Inventory overview with location tabs
│   ├── new.tsx                   # Add inventory item
│   └── $id.edit.tsx              # Edit/delete inventory item
├── plan/                         # ✅ IMPLEMENTED
│   ├── index.tsx                 # Weekly meal plan calendar
│   └── shopping-list.tsx         # Shopping list with generation
├── discover/                     # ✅ IMPLEMENTED
│   └── index.tsx                 # "What can I make?" with match percentages
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
- Bottom nav updated to 4 items: Recipes, Inventory, Plan, Discover

### Phase 3: Meal Planning ✅ COMPLETE
**Goal**: Plan your week

- [x] Weekly calendar view (Monday-start)
- [x] Click to assign recipes to meal slots
- [x] 4 meal types: Breakfast, Lunch, Dinner, Snack
- [x] Week navigation (previous/next/current)
- [x] Shopping list generation from meal plan
- [x] Ingredient consolidation and quantity summing
- [x] Category grouping (7 categories)
- [x] Manual item addition
- [x] Check off items while shopping
- [x] Mobile-optimized with horizontal scroll

**Deliverable**: Can plan meals and generate organized shopping lists

#### Phase 3 Implementation Notes

**Database Models Created:**
- `MealPlan` - Weekly meal plans with Monday start date
- `MealPlanEntry` - Individual meal slots (date + mealType + recipe)
- `ShoppingList` - User's shopping list
- `ShoppingListItem` - Items with category, quantity, checked state, source

**Routes Created:**
- `/plan` - Weekly meal planner with calendar grid
- `/plan/shopping-list` - Shopping list with generation and management

**Components Created:**
- `meal-plan-calendar.tsx` - Week grid layout (4 meal types × 7 days)
- `meal-slot-card.tsx` - Individual meal slot with add/change/remove
- `recipe-selector.tsx` - Searchable recipe picker
- `shopping-list-item.tsx` - Shopping list item with checkbox

**Utilities Created:**
- `date.ts` - Week calculations, date formatting, meal type definitions
- `meal-plan-validation.ts` - Zod schemas for meal entries
- `shopping-list-validation.ts` - Category definitions and auto-categorization
- `shopping-list.server.ts` - Shopping list generation with consolidation logic

**Navigation:**
- Bottom nav updated to 4 items: Recipes, Inventory, Plan, Discover
- Desktop nav updated with Plan link

### Phase 4: Polish & Smart Features ✅ COMPLETE
**Goal**: Make it delightful to use

- [x] Inventory subtraction from shopping list
- [x] Multiple recipes per meal slot
- [x] Recipe scaling (client-side servings adjustment)
- [x] Cooking mode (full-screen step-by-step)

**Deliverable**: Enhanced meal planning with inventory-aware shopping, flexible meal slots, scalable recipes, and kitchen-friendly cooking mode

#### Phase 4 Implementation Notes

**Schema Changes:**
- `MealPlanEntry` unique constraint changed from `[mealPlanId, date, mealType]` to `[mealPlanId, date, mealType, recipeId]` — allows multiple recipes per meal slot

**Routes Created:**
- `/recipes/:recipeId/cook` - Full-screen cooking mode with step-by-step instructions

**Files Created:**
- `app/utils/fractions.ts` - Fraction parsing (`parseAmount`), formatting (`formatAmount`), and scaling (`scaleAmount`)
- `app/routes/recipes/$recipeId_.cook.tsx` - Cooking mode route with Wake Lock, progress bar, collapsible ingredients

**Files Modified:**
- `app/utils/recipe-matching.server.ts` - Exported `ingredientMatchesInventoryItem()` and `isStapleIngredient()` for reuse
- `app/utils/shopping-list.server.ts` - Added `subtractInventoryFromShoppingList()` to filter out inventory items and staples
- `app/routes/plan/shopping-list.tsx` - Shopping list generation now subtracts inventory; shows removed item count
- `app/routes/plan/index.tsx` - `assign` action changed from `upsert` to check-then-create for new composite key
- `app/components/meal-plan-calendar.tsx` - Entry grouping changed to `Map<string, Entry[]>` for multi-entry slots
- `app/components/meal-slot-card.tsx` - Rewritten for multi-entry support with `EntryRow` component and "Add Another" button
- `app/components/recipe-selector.tsx` - Added `excludeRecipeIds` prop to filter already-assigned recipes
- `app/routes/recipes/$recipeId.tsx` - Added scaling controls (+/- servings), Cook button, scaled ingredient display
**Goal**: Make it delightful to use

- [x] Inventory subtraction when generating shopping list
- [x] Multiple recipes per meal slot (main + sides)
- [x] Recipe scaling (adjust servings with +/- controls)
- [x] Cooking mode (full-screen step-by-step view with wake lock)
- [ ] After completing a recipe, subtract ingredients from inventory *(deferred)*
- [ ] Drag-and-drop recipes (desktop) *(deferred)*
- [ ] Copy week to next week *(deferred)*
- [ ] Mark meal as "cooked" in meal plan *(deferred)*

**Deliverable**: Enhanced meal planning with inventory-aware shopping lists, flexible meal slots, recipe scaling, and kitchen-friendly cooking mode

### Phase 5: Advanced Features (Future)
**Goal**: Enhanced user experience

- [ ] PWA setup (offline, installable)
- [ ] Performance optimization
- [ ] Recipe suggestions based on expiring ingredients
- [ ] Print shopping list
- [ ] Recipe history/ratings

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

- ~~**Recipe scaling**: Adjust servings, auto-scale ingredients~~ ✅ Implemented in Phase 4
- **Nutrition info**: Integrate with nutrition API
- **Recipe sharing**: Share individual recipes via link
- **Import from URL**: Scrape recipes from websites
- **Voice input**: "Add 2 cups flour to shopping list"
- **Barcode scanning**: Scan products to add to inventory
- **Multi-user households**: Shared inventory and meal plans
- **Cost tracking**: Track ingredient costs, meal budgeting

### AI-Powered Features (Nice to Have)

Leverage AI (Claude API, OpenAI, or local models) to enhance the cooking experience:

#### Creative Recipe Suggestions
- **AI recipe generation from available ingredients**: When no recipes fully match your inventory, AI suggests 2-3 custom recipes
  - Example: "You have chicken, rice, carrots, and soy sauce" → AI suggests "Chicken Fried Rice" with full recipe
  - Considers your cooking style and dietary preferences
  - Shows what you have vs. what you need to buy
  - Can save AI-generated recipes to your collection
- **UX Enhancement**: Solves the "I have random stuff in my fridge" problem when discovery shows only low-match recipes
- **Implementation**:
  - Add "🤖 Generate Recipe Ideas" button on discover page when max match < 70%
  - Send inventory list to Claude API with prompt: "Suggest 2-3 recipes I can make"
  - Display suggestions with ingredient lists and simple instructions
  - One-click to save as new recipe or add to meal plan

#### Smart Inventory Management
- **Receipt scanning**: Take photo of grocery receipt, AI extracts items and adds to inventory
  - OCR + AI parsing to identify items, quantities, and units
  - Auto-categorize by location (pantry/fridge/freezer)
  - Review screen before confirming additions
  - Example: Photo of Trader Joe's receipt → extracts "Milk 1 gal", "Eggs 1 doz", "Chicken Breast 2 lbs"
- **Grocery photo scanning**: Take photo of groceries themselves (on counter, in bags)
  - AI vision identifies items: "I see: 3 tomatoes, 1 head lettuce, 2 bell peppers, 1 onion"
  - Great for farmers market hauls or loose produce without receipts
  - Estimates quantities when not obvious
- **UX Enhancement**: Major time-saver - instead of manually adding 20 items after shopping, just snap a photo
- **Implementation**:
  - Add "📸 Scan Receipt" and "📸 Scan Groceries" buttons on inventory page
  - Use Claude API with vision capabilities (supports image analysis)
  - Structured prompt: "Extract grocery items from this image with quantities and units"
  - Parse JSON response and pre-fill inventory add form for review

#### Ingredient Substitutions
- **Smart substitutions when missing ingredients**: When you're missing an ingredient for a recipe, AI suggests practical alternatives
  - Example: "Don't have buttermilk? Use 1 cup milk + 1 tbsp lemon juice"
  - Context-aware suggestions based on the recipe type and cooking method
  - Explain how the substitution affects taste/texture
- **UX Enhancement**: Reduces trips to store, encourages cooking with what you have
- **Implementation**: "🤖 Suggest Substitutions" button on recipe view when missing ingredients

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
- **UX Enhancement**: Makes healthy eating easier without manual research
- **Implementation**: "🤖 Make Healthier" button on recipe view

#### Implementation Considerations
- Use Claude API (Sonnet 3.5 or Opus) for all AI features - context-aware and multimodal
- Claude supports both text and image inputs (perfect for receipt/photo scanning)
- Estimated costs: ~$0.003-0.015 per API call (very affordable for personal use)
- Cache common substitution patterns to reduce API costs
- Allow users to save AI-generated recipes and substitutions
- Add optional OpenAI integration for users who prefer GPT-4 Vision
- Store API keys securely in user settings (not in codebase)

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

### Completed Steps ✅

**Phase 1, 2, 3 & 4:**
1. ~~**Create the Prisma schema** - Recipe + InventoryItem + MealPlan + ShoppingList models~~
2. ~~**Run migrations** - All database models migrated~~
3. ~~**Build recipe routes** - Full CRUD with search/filter~~
4. ~~**Build inventory routes** - Full CRUD with location filtering~~
5. ~~**Add mobile layout** - Bottom nav on all pages, responsive grid~~
6. ~~**Recipe matching** - Fuzzy ingredient matching algorithm~~
7. ~~**Sample data seeding** - 18 recipes + 38 inventory items~~
8. ~~**Meal planning** - Weekly calendar with 4 meal types~~
9. ~~**Shopping list** - Auto-generation with category grouping~~
10. ~~**Inventory subtraction** - Shopping list subtracts inventory items and staples~~
11. ~~**Multiple recipes per slot** - Main + sides support for meal slots~~
12. ~~**Recipe scaling** - Client-side servings adjustment with fraction display~~
13. ~~**Cooking mode** - Full-screen step-by-step with wake lock~~

### Next Steps (Phase 5)

**Enhanced Features (Future):**
1. PWA setup (offline, installable)
2. Performance optimization
3. Recipe suggestions based on expiring ingredients
4. Drag-and-drop recipes (desktop)
5. Print shopping list

**Available Commands:**
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run typecheck    # Run TypeScript checks
npm run lint         # Run ESLint
npm run reseed       # Clear and re-seed sample data for all users
npx prisma db seed   # Seed database with sample data
npx prisma studio    # Open Prisma Studio (database GUI)
```

---

## Sample Data & Testing

### Current Sample Data

The app includes sample data for testing and demonstration:

**18 Sample Recipes:**
- Apple and yogurt cake, Asian Cucumber Salad, Beef and Broccoli Stirfry, Brown butter brookies, Carbonara, Cheese Fondue, Chicken Cacciatore, Classic Tiramisu, Fried Rice, Gemuse Kebab, Gochujang Chicken, Hot Chocolate, Japanese milk bread, Minestrone, Okonomiyaki, Quick Cucumber Pickles, Tuscan-style sausage, White beans salad

**38 Inventory Items:**
- **Pantry (16)**: flour, sugar, salt, pepper, oils, soy sauce, rice, pasta, canned goods, stock, honey, sesame oil, rice vinegar, baking powder, vanilla
- **Fridge (16)**: eggs, butter, milk, cream, cheeses, yogurt, vegetables (carrots, celery, onions, garlic, ginger, scallions, peppers, broccoli, lettuce)
- **Freezer (6)**: chicken breast, ground beef, bacon, peas, mixed vegetables, pizza dough

### Seeding System

All new users automatically receive sample recipes and inventory items via `prisma/seed.ts`. This allows friends/testers to immediately explore the app's features without manually entering data.

**Scripts:**
- `npm run reseed` - Clear and re-seed all user data
- `scripts/clear-recipes.ts` - Remove all recipes and inventory
- `scripts/import-sample-recipes.ts` - Import recipes from markdown files
- `prisma/seed-sample-data.ts` - Reusable seeding function

**For Production:**
When ready to deploy without sample data, update `prisma/seed.ts` to remove the `seedSampleData()` call.

---

## Success Metrics

For a personal app, "success" means:

- [x] Recipe import system from Apple Notes (markdown parser built)
- [x] Can find any recipe in < 5 seconds (search + filter working)
- [x] Discover recipes based on available ingredients (fuzzy matching implemented)
- [x] Weekly meal planning takes < 5 minutes (click-to-assign implemented)
- [x] Shopping list generation is automatic (one-click generation from meal plan)
- [x] App is usable in the kitchen (cooking mode with wake lock, large text, step-by-step)
- [ ] Works offline for viewing recipes (PWA - Phase 5)

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
*Last updated: February 4, 2026 - Phase 1, 2, 3 & 4 complete! Inventory-aware shopping list, multiple recipes per meal slot, recipe scaling, and cooking mode now live.*
