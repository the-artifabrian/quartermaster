# Architecture

For features, see [FEATURES.md](./FEATURES.md). For design system, see
[DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).

---

## System Overview

```
  Browser (React)
      │
      ▼
  Express + React Router v7
      │  Express handles middleware (Helmet, compression, rate
      │  limiting, HTTPS redirect) then hands off to React Router
      │  for all routing via loader/action/component pattern
      │
      ├── Prisma → SQLite
      ├── S3 storage (images)
      ├── Anthropic Claude (AI features)
      ├── Groq Whisper (voice transcription)
      ├── Stripe (subscriptions)
      ├── SSE (real-time sync)
      └── Auth (sessions, OAuth, passkeys)
```

Deployed on Fly.io with LiteFS. Bootstrapped from the
[Epic Stack](https://www.epicweb.dev/epic-stack).

---

## Database (24 Models)

All user data is household-scoped: recipes, inventory, meal plans, and shopping
lists belong to the household, not the user.

```
  User
    ├── Password, Session, Passkey, Connection (auth)
    ├── Role → Permission (RBAC)
    ├── Subscription (Pro/Free tier)
    ├── CookingLog (user-scoped)
    │
    └── HouseholdMember → Household
                              ├── Recipe → Ingredient, Instruction, RecipeImage
                              ├── InventoryItem
                              ├── MealPlan → MealPlanEntry
                              ├── ShoppingList → ShoppingListItem
                              ├── HouseholdInvite
                              └── HouseholdEvent (SSE log)

  Standalone: Verification (OTP), UsageEvent (AI rate limiting)
```

---

## Auth Chain

```
  requireUserId(request)
    │  Session cookie → Session table lookup
    │  Returns: userId
    ▼
  requireUserWithHousehold(request)
    │  HouseholdMember lookup (auto-creates if missing)
    │  Returns: { userId, householdId, role }
    ▼
  requireProTier(request)
       Subscription check → redirects to /upgrade if not Pro
```

---

## The Core Loop

```
  ┌─────────────────────────────────────────────────────────┐
  │                                                         │
  │  RECIPES ──────▶ INVENTORY ──────▶ MATCHING             │
  │     │              ▲    ▲              │                 │
  │     │              │    │              ▼                 │
  │     │         Check off │        "What can I make?"     │
  │     │          at store │              │                 │
  │     │              │    │              ▼                 │
  │  SHOPPING ◀──── MEAL PLAN ◀──── Recipe discovery        │
  │  LIST              │                                     │
  │     └──────────────┘                                     │
  │       Generate from planned meals                        │
  └─────────────────────────────────────────────────────────┘
           MEAL PLAN ──mark cooked──▶ review used-up
                        ingredients ──▶ remove from INVENTORY
```

**Shopping list generation flow:**

1. Collect ingredients across planned recipes (filter headings + heading
   heuristic for untagged headings)
2. Scale amounts by per-entry serving overrides
3. Consolidate duplicates via canonical name matching
4. Sum compatible units (cups + tbsp → total volume)
5. Annotate items already in inventory (pre-checked, not omitted)
6. Filter out staples and optional ingredients
7. After shopping: checked items → new InventoryItem records → feeds matching

**Post-cook inventory review flow:**

1. User marks a meal as cooked (quickCook intent)
2. Server matches recipe ingredients against household inventory
3. Filters out staples (salt, oil, pepper) and optional ingredients
4. Returns matched inventory items with pre-check flag (perishables checked,
   pantry items unchecked)
5. Dialog prompts user to confirm which items they used up
6. Selected items bulk-deleted from inventory via resource route

---

## Ingredient Normalization

```
  "2 cups fresh diced Roma tomatoes (optional)"
       │
       ▼
  parseIngredient()            { amount: "2", unit: "cups",
       │                         name: "fresh diced Roma tomatoes",
       │                         notes: "optional" }
       ▼
  normalizeIngredientName()    "roma tomato"
       │
       │  lowercase → strip parens → split comma → handle "or"
       │  → check protected compounds → strip modifiers
       │  → strip compound prep phrases → normalize plurals → cache
       ▼
  Canonical name (used for matching, dedup, consolidation)
```

The parser handles real-world edge cases: unicode fractions, "juice of 1 lemon"
patterns, fl oz as a two-word unit, written-out numbers, malformed JSON-LD from
recipe sites. The normalizer protects compound ingredients ("green onion" keeps
"green" because it's in the protected compounds list).

---

## 4-Level Fuzzy Matching

Each level is progressively looser:

```
  Recipe: "chicken thighs"  vs  Inventory: "Chicken Breast"

  1. EXACT  →  "chicken thigh" === "chicken breast"?  NO
  2. SYNONYM →  synonyms["chicken thigh"] has "chicken breast"?  YES ✓

  Recipe: "bell pepper"  vs  Inventory: "red bell pepper"

  1. EXACT   → NO
  2. SYNONYM → NO
  3. CORE WORD → NO (multi-word, skipped)
  4. CONTAINMENT → all words of "bell pepper" in "red bell pepper"?  YES ✓
```

**Performance:** Pre-built O(1) lookup from inventory (Sets for normalized
names, synonyms, core words). O(n) containment only runs as last resort.

**Guards:** Core-word matching skips cut-sensitive proteins (thigh ≠ breast).
Non-equivalent compounds blocked (rice ≠ rice vinegar).

**Match %:** `matched / (total - staples - optional - headings) × 100`,
displayed as SVG progress rings on recipe cards.

---

## Real-Time Sync (SSE)

```
  User A checks off "Milk"
       │
       ▼
  Action handler → DB update + emitHouseholdEvent()
       │
       ▼
  householdEventBus (EventEmitter singleton)
       ├── Write to HouseholdEvent table (30-day retention)
       └── Emit on "household:{id}" channel
              │
              ▼
       SSE endpoint → filters out acting user → User B sees toast
```

Fallback polling endpoint (`?since=<ISO timestamp>`) for reconnection. 30-second
keepalive prevents proxy timeouts.

---

## AI Integrations

All optional. The app works fully without any API keys.

| Feature                   | Model         | Timeout |
| ------------------------- | ------------- | ------- |
| Recipe extraction (text)  | Claude Haiku  | 15s     |
| Recipe extraction (image) | Claude Sonnet | 30s     |
| Recipe generation         | Claude Haiku  | 15s     |
| Recipe enhancement        | Claude Haiku  | 10s     |
| Voice transcription       | Groq Whisper  | 15s     |
| Speech item parsing       | Claude Haiku  | 4s      |

Rate limited to 10/day per user per feature via `UsageEvent` table. Shared
`checkAndRecordAiUsage()` utility. DB write failures are non-fatal (rate
limiting is a safety net, not a correctness gate).

---

## Rate Limiting

**Infrastructure (Express):** 10/min on auth routes, 100/min on mutations,
1000/min general. Uses `fly-client-ip` to prevent IP spoofing.

**Application:** 10 AI calls/day per user per feature, tracked in `UsageEvent`
table.

---

## Security

- Nonce-based CSP, SSRF protection (including post-redirect validation)
- Zod on all inputs, magic-byte MIME validation, streaming upload size limits
- Bcrypt + PwnedPasswords, WebAuthn, OAuth, TOTP 2FA
- 30-day sessions in database, Stripe webhook HMAC verification
- Error sanitization on public routes, user enumeration prevention

---

## Testing

831 tests across 36 files (Vitest) + Playwright e2e.

Key coverage: ingredient parser (263 tests), recipe matching, shopping list
generation, household events, LLM integrations (MSW mocks), AI rate limiting,
Stripe webhooks, shopping → inventory pipeline (e2e).

---

_Last updated: April 1, 2026._
