# Refactoring Plan — Open Source Prep

Simplify the app for open-sourcing as a portfolio piece. Remove dormant
business features, sharpen the engineering signal, add documentation that
makes the depth discoverable.

Tracked from `/plan-ceo-review` on 2026-03-18.
Reviewed via `/plan-ceo-review` (HOLD SCOPE) on 2026-03-18.
Reviewed via `/plan-eng-review` on 2026-03-18.

---

## Phase 1: Remove Dead Weight (one PR, one migration)

All cuts in a single branch. Removes ~3,000 LOC, 3 database tables
(InviteCode, Subscription, UsageEvent — repurposed for rate limiting), and
the entire subscription/payment system.

**Pre-deploy:** Take a Fly.io volume snapshot before deploying. The migration
drops tables with production data (subscriptions, invite codes). This is
intentional but irreversible without a backup.

```
npx prisma migrate dev --name simplify-for-open-source
```

### 1A. Remove Invite Code System (~600 LOC)

**Files to delete:**
- [ ] `app/utils/invite-codes.server.ts`
- [ ] `app/utils/invite-codes.server.test.ts`
- [ ] `app/utils/invite-code-status.ts`
- [ ] `app/components/invite-code-banner.tsx`
- [ ] `app/routes/settings/profile/invite-codes.tsx`
- [ ] `app/routes/resources/redeem-invite-code.tsx`

**Schema changes:**
- [ ] Drop `InviteCode` model from `prisma/schema.prisma`
- [ ] Remove `inviteCodesCreated` and `inviteCodesRedeemed` relations from
      User model

**References to remove:**
- [ ] `root.tsx` loader: remove `getAvailableCodeCount` import, remove
      `availableInviteCodeCount` query, remove `hasRedeemedCode` query and
      return value
- [ ] `settings/profile/index.tsx`: remove `getAvailableCodeCount` import
      (line 9), remove query in loader (line 57), remove "Invite Codes"
      SettingsSection (lines 173-189)
- [ ] `recipes/index.tsx`: remove `InviteCodeBanner` import and rendering
- [ ] `settings/profile/_layout.tsx`: remove nav link to
      `/settings/profile/invite-codes`

### 1B. Remove Subscription & Payment System (~1,200 LOC)

Remove the entire Pro/Free tier system AND Stripe integration. All features
available to all users. No subscription model, no payment processing.

**Files to delete:**
- [ ] `app/utils/subscription.server.ts` (tier logic, `getUserTier`,
      `requireProTier`, `requireUserWithTier`, `getInventoryUsage`)
- [ ] `app/utils/subscription.server.test.ts`
- [ ] `app/utils/subscription.ts` (client hooks: `useIsProActive`,
      `useSubscriptionTier`, etc.)
- [ ] `app/utils/stripe.server.ts`
- [ ] `app/utils/stripe.server.test.ts`
- [ ] `app/routes/upgrade.tsx`
- [ ] `app/routes/resources/stripe-webhook.tsx`
- [ ] `app/routes/resources/stripe-portal.tsx`
- [ ] `app/components/pro-expiry-nudge.tsx`
- [ ] `tests/mocks/stripe.ts` (MSW mock handlers for Stripe API)

**Schema changes:**
- [ ] Drop `Subscription` model from `prisma/schema.prisma`
- [ ] Remove `subscription` relation from User model

**Dependencies:**
- [ ] Remove `stripe` from `package.json`
- [ ] Remove `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` from
      `env.server.ts` schema
- [ ] Remove Stripe vars from `.env.example` (`STRIPE_SECRET_KEY`,
      `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_YEARLY_PRICE_ID`)
- [ ] Update `tests/mocks/index.ts` to remove Stripe mock import

**Routes using `requireProTier()` — replace with `requireUserWithHousehold()`:**
- [ ] `recipes/generate.tsx` (line 33)
- [ ] `resources/transcribe.tsx` (line 18)
- [ ] `resources/substitutions.tsx` (line 18)
- [ ] `resources/enhance-recipe.tsx` (line 19)
- [ ] `resources/shopping-to-inventory.tsx` (line 10)
- [ ] `resources/meal-plan-suggest.tsx` (line 33)
- [ ] `resources/quick-cook.tsx` (line 8)
- [ ] `resources/meal-plan-copy-week.tsx` (line 15)

**Routes using `requireUserWithTier()` — replace with
`requireUserWithHousehold()` and remove `isProActive` from loader return:**
- [ ] `shopping.tsx` (line 53)
- [ ] `plan/index.tsx` (line 39)
- [ ] `recipes/import.tsx` (line 47)
- [ ] `inventory/index.tsx` (lines 42-43) — also remove
      `getInventoryUsage()` and `isAtLimit` check
- [ ] `inventory/new.tsx` (lines 49-50) — remove limit check and redirect
- [ ] `recipes/index.tsx` (line 45) — always load ingredient data for
      matching (remove conditional on `isProActive`)
- [ ] `recipes/$recipeId.tsx` (line 58) — remove `isProActive` from loader
- [ ] `resources/uncooked-meals.tsx` (lines 25-26) — remove early return
      when not Pro, always return entries

**Components to update (remove `isProActive` prop and conditionals):**
- [ ] `recipe-ingredient-list.tsx` (line 24, 48)
- [ ] `ingredient-substitution.tsx` (lines 10, 20, 25 — remove Pro guard)
- [ ] `shopping-mobile-fab.tsx` (lines 14, 19, 130 — always show voice)
- [ ] `inventory-mobile-fab.tsx` (lines 25, 30, 151 — always show voice)
- [ ] `inventory-quick-add.tsx` (lines 13, 28 — always show voice)
- [ ] `recipe-action-bar.tsx` (lines 13, 23)
- [ ] `bottom-nav.tsx` (lines 3, 50-51 — remove `useIsProActive()`,
      always show activity dot)
- [ ] `user-dropdown.tsx` (lines 4, 11-12, 34-47 — remove Pro badge,
      expiry countdown)

**root.tsx cleanup:**
- [ ] Remove `getUserTier` import and `tierInfo` from loader
- [ ] Remove `isPro` conditional on `<HouseholdActivityNotifier />`
      (always render for authenticated users)
- [ ] Remove `<ProExpiryNudge />` rendering

**Inventory limit removal:**
- [ ] Remove `FREE_INVENTORY_LIMIT` constant
- [ ] Remove `getInventoryUsage()` function
- [ ] Remove all `usage.isAtLimit` checks
- [ ] Remove "Free plan limit reached" messaging from `inventory/new.tsx`

### 1C. Remove Admin Users + Subscriptions Pages (~700 LOC)

- [ ] Delete `app/routes/admin/users.tsx`
- [ ] Delete `app/routes/admin/subscriptions.tsx`
- [ ] Keep `app/routes/admin/cache/` (useful Epic Stack dev tooling)

### 1D. Strip UsageEvent to Rate Limiting Only

Keep the `UsageEvent` table for AI rate limiting. Remove the tracking and
stats surface.

**Files to delete:**
- [ ] `app/utils/usage-tracking.server.ts` (fire-and-forget `trackEvent()`)
- [ ] `app/utils/usage-stats.server.ts` (aggregation queries)
- [ ] `app/routes/settings/profile/usage.tsx` (stats UI)
- [ ] `app/routes/resources/usage-stats.tsx` (stats API)

**Schema changes:**
- [ ] Remove `usageEvents` relation from User model
- [ ] Remove `usageEvents` relation from Household model
- [ ] Keep `UsageEvent` model but remove `householdId` field and
      `Household` relation (rate limiting only needs userId + type + date)

**References to update:**
- [ ] Remove all `trackEvent()` calls (5 routes):
      - `recipes/generate.tsx` (lines 120, 239)
      - `recipes/import.tsx` (line 704)
      - `recipes/$recipeId.tsx` (line 286)
      - `resources/substitutions.tsx` (line 47)
      - `resources/enhance-recipe.tsx` (line 109)
- [ ] Extract shared rate-limit utility: `app/utils/ai-rate-limit.server.ts`

```ts
// checkAndRecordAiUsage(userId, type, limit)
// Returns { allowed: boolean, remaining: number }
// Counts today's usage, checks against limit, creates row if allowed.
// DB write wrapped in try-catch — failure allows the call (rate limiting
// is a safety net, not a correctness requirement).
```

- [ ] Replace inline rate-limit code in 3 routes with utility call:
      - `recipes/import.tsx` (DAILY_EXTRACT_LIMIT)
      - `recipes/generate.tsx` (DAILY_GENERATION_LIMIT)
      - `resources/enhance-recipe.tsx` (DAILY_LIMIT)
- [ ] Add tests: `app/utils/ai-rate-limit.server.test.ts`
      - Under limit → allowed
      - At limit → rejected
      - DB write fails → allowed (try-catch, logged)
      - New day resets count
- [ ] `settings/profile/index.tsx`: remove "Usage Stats" SettingsRow
      link

### 1E. Test Updates

**Files to delete (features removed):**
- [ ] `app/utils/invite-codes.server.test.ts`
- [ ] `app/utils/subscription.server.test.ts`
- [ ] `app/utils/stripe.server.test.ts`

**Files to update (remove tier references):**
- [ ] `app/routes/plan/plan-actions.test.ts` — remove `tier: 'pro'` from
      test user setup
- [ ] `app/routes/plan/shopping-list-actions.test.ts` — remove tier refs
- [ ] `app/routes/recipes/recipe-actions.test.ts` — remove tier refs
- [ ] `app/routes/plan/plan-resource-routes.test.ts` — remove tier refs
- [ ] `app/routes/resources/household-events-poll.test.ts` — remove tier refs
- [ ] `tests/e2e/shopping-list.test.ts` — remove Pro gating assertions
- [ ] `tests/e2e/shopping-to-inventory.test.ts` — remove Pro gating (this
      was previously Pro-only via `requireProTier`)

**Verification:** Run `npm run validate` (tests + lint + typecheck + e2e).
Test count should stay at 860+ (we delete ~20 subscription/invite tests
but the remaining tests should all pass).

---

## Phase 2: BYOK (Bring Your Own Key) for AI Features

Replace host-provided API keys with per-user key storage. Users enter
their own Anthropic and Groq API keys in settings.

### Data Model

New model (or fields on User):

```prisma
model UserApiKey {
  id            String   @id @default(cuid())
  provider      String   // "anthropic" | "groq"
  encryptedKey  String   // AES-256-GCM ciphertext (base64)
  iv            String   // Initialization vector (base64)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId String

  @@unique([userId, provider])
  @@index([userId])
}
```

### Encryption

Use Node.js `crypto` module (no new dependencies):

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key derivation:** PBKDF2 from `SESSION_SECRET` + static salt, 100k
  iterations, SHA-256
- **IV:** Random 12 bytes per row (stored alongside ciphertext)
- **On decrypt failure** (corrupted data or SESSION_SECRET changed): delete
  the stored key row, return null, show "Please re-enter your API key"
- **On SESSION_SECRET rotation:** document that stored API keys become
  unreadable and must be re-entered. This is acceptable — SESSION_SECRET
  rotation is rare and explicitly documented

**Security constraints:**
- API keys must never appear in logs, error messages, or Sentry breadcrumbs
- Masked display in settings UI (show last 4 characters only)
- No client-side exposure — keys only decrypted server-side in route actions

### Key Resolution Flow

```
  AI ROUTE REQUEST
       │
       ▼
  User has stored key? ─── YES ──▶ Decrypt ──▶ Use user key
       │                              │
       │                         Decrypt fails?
       │                              │ YES
       │                              ▼
       │                    Delete corrupted row
       │                    Fall through ↓
       │
       └─ NO
            │
            ▼
  process.env has key? ──── YES ──▶ Use env key (self-hoster mode)
       │
       └─ NO ──▶ Return { error: 'no_api_key' }
                       │
                       ▼
              UI shows "Configure API key in Settings"
              with link to /settings/profile/api-keys
```

### Settings Page: `/settings/profile/api-keys`

- Inputs for Anthropic API Key and Groq API Key
- **Validate on save:** make a lightweight API call (Anthropic: list models;
  Groq: list models) to verify the key works before storing
- Masked display: `sk-ant-•••••••••••4f2e` (last 4 chars)
- Test button (re-runs validation)
- Remove button with confirmation
- Empty state: "Not configured" with link to provider's API key page
- Error states: "Invalid key", "Key saved", "Key removed"
- Follow existing settings page patterns (DM Sans, card layout, cedar borders)

### LLM Utility Changes

All 7 LLM server utilities read API keys at call time via `process.env`
(no global singletons). Refactor each to accept an optional `apiKey`
parameter:

```ts
// Before:
export async function extractRecipeFromText(rawText: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  // ...
}

// After — use options object (not positional param):
export async function extractRecipeFromText(
  rawText: string,
  opts?: { apiKey?: string },
) {
  const key = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!key) return { error: 'no_api_key' as const }
  // ...
}
```

Use options objects rather than positional `apiKey` params. This is explicit,
extensible, and avoids confusion on functions with multiple string params
(e.g., `extractRecipeFromImage(imageBase64, mediaType, opts?)`).

**Files to modify:**
- [ ] `recipe-extract-llm.server.ts` — `extractRecipeFromText()`,
      `extractRecipeFromImage()`
- [ ] `recipe-generation-llm.server.ts` — `generateRecipeFromInventory()`
- [ ] `recipe-enhance-llm.server.ts` — `enhanceRecipeMetadata()`
- [ ] `substitution-llm.server.ts` — `getLLMSubstitutions()`
- [ ] `speech-parse-llm.server.ts` — `parseSpeechItemsWithLLM()`
- [ ] `whisper.server.ts` — `transcribeAudio()`

Also update the cache layer:
- [ ] `substitution-lookup.server.ts` (line 97) — accepts key param

**Each AI route/action:** read user's stored key via new `getUserApiKey()`
utility, pass to LLM function:

```ts
const anthropicKey = await getUserApiKey(userId, 'anthropic')
const result = await extractRecipeFromText(rawText, anthropicKey)
if (result.error === 'no_api_key') {
  return data({ error: 'Configure your Anthropic API key in Settings' })
}
```

### Rate Limiting

Keep per-user daily rate limits (10/day for extraction, generation,
enhancement) using the `UsageEvent` table. Rate limits apply regardless
of key source (user key or env var).

### Error Handling for Invalid User Keys

When a user's key gets a 401/403 from the API provider:

```ts
if (response.status === 401 || response.status === 403) {
  return {
    error: 'invalid_api_key' as const,
    message: 'Your API key was rejected. Please check it in Settings.'
  }
}
```

Don't automatically delete the key — the user may have a temporary billing
issue. Let them re-test or remove it manually.

### Tests (Phase 2)

**New test file:** `app/utils/api-key-encryption.test.ts`
- [ ] Encrypt and decrypt round-trip
- [ ] Decrypt with wrong key returns null (doesn't throw)
- [ ] Decrypt corrupted ciphertext returns null
- [ ] Different IVs produce different ciphertext for same plaintext
- [ ] Empty string key rejected

**New test file:** `app/utils/api-key-resolution.test.ts`
- [ ] User key present → user key returned
- [ ] User key missing, env key present → env key returned
- [ ] Both missing → null returned
- [ ] User key corrupted → row deleted, env key returned
- [ ] Key validation (test call) succeeds / fails

**Update existing LLM tests:**
- [ ] Each LLM test file: add case for explicit `apiKey` parameter
- [ ] Each LLM test file: add case for `no_api_key` error return

**New E2E test:** `tests/e2e/api-keys.test.ts`
- [ ] Save a key, verify masked display
- [ ] Remove a key, verify removal
- [ ] AI feature shows "configure" message when no key

### Effort

- Human team: ~1.5 days
- CC + gstack: ~45 min

---

## Phase 3: Code Quality Refactors

### 3A. Split `parseIngredient()` (261 lines → 4–5 functions)

File: `app/utils/ingredient-parser.ts`

Break into phases:
1. `preprocessIngredientText()` — strip HTML, normalize unicode, handle
   parenthetical quantities, convert written-out numbers
2. `parseAmountAndUnit()` — extract numeric amount and unit token
3. `extractNameAndNotes()` — separate ingredient name from notes/modifiers
4. `normalizeParseResult()` — pluralization, "to taste" handling, cleanup

**Critical constraint:** The `fl oz` regex match (currently ~line 330-346)
must execute **before** the main amount/unit regex (~line 379). "2 fl oz
milk" will misparse if the order is reversed. Preserve this ordering when
splitting into `parseAmountAndUnit()`.

Existing 263 parser tests validate correctness. No new tests needed.

### 3B. Split `shopping.tsx` Action Handler (335 lines → named handlers)

File: `app/routes/shopping.tsx`

Extract intent handlers as named functions in the same file:

```ts
async function handleGenerate(/* ... */) { /* ... */ }
async function handleAdd(/* ... */) { /* ... */ }
async function handleToggle(/* ... */) { /* ... */ }
// etc.
```

Keep the switch/if-else in the main `action` function for intent routing
(~20 lines). Each handler gets the same args shape (request, userId,
householdId, shoppingList).

### Effort

- Human team: ~2 hours
- CC + gstack: ~15 min

---

## Phase 4: Documentation

### 4A. Update Existing Docs (with Phase 1 cuts)

- [ ] `README.md`:
  - Remove subscription/invite code references
  - Remove `STRIPE_SECRET_KEY` from env var table
  - Add BYOK section explaining API key setup
  - Update feature list to remove "Pro" labels
- [ ] `docs/DEVELOPMENT_PLAN.md`:
  - Remove subscription, invite code, usage tracking references
  - Update "Current Status" to reflect open-source posture
  - Remove "Subscription system is implemented" paragraph
- [ ] `docs/FEATURES.md`:
  - Remove all "(Pro)" labels
  - Remove invite code system section
  - Remove usage analytics section
  - Add BYOK setup section under AI features
  - Remove "Free: ... Pro: ..." tier listing
- [ ] `docs/DESIGN_SYSTEM.md`:
  - No changes expected (design system is independent of features)

### 4B. Add `docs/ARCHITECTURE.md`

New document with ASCII diagrams:

1. **System overview** — Express → React Router → SQLite/S3, with auth,
   AI, and real-time layers
2. **Core loop data flow** — Recipes → Inventory → Matching → Planning →
   Shopping → Restock → repeat
3. **Ingredient normalization pipeline** — Raw text → modifier stripping →
   synonym resolution → pluralization → canonical name
4. **4-level fuzzy matching** — Exact → synonym → core word → multi-word
   containment, with examples
5. **Real-time sync** — SSE architecture with polling fallback
6. **BYOK key resolution** — User key → env fallback → "configure" message

### Effort

- Human team: ~2 hours
- CC + gstack: ~15 min

---

## Execution Order

```
  Phase 1 (cuts) ──────────────────▶ Phase 4A (doc updates)
       │                                    │
       ├──▶ Phase 2 (BYOK) ───────▶ Phase 4A (BYOK docs)
       │                                    │
       └──▶ Phase 3 (refactors)             ▼
                                    Phase 4B (ARCHITECTURE.md)
```

1. **Phase 1** (cuts) — one PR, one migration. Must deploy first.
2. **Phase 2** (BYOK) — separate PR, depends on Phase 1 (tier gating gone)
3. **Phase 3** (refactors) — separate PR, independent of Phase 2
4. **Phase 4A** (doc updates) — combine with Phase 1 PR
5. **Phase 4B** (ARCHITECTURE.md) — after all code changes are done

Phases 2 and 3 can run in parallel after Phase 1 lands.

---

## Summary

| Phase | LOC Removed | LOC Added | Models Dropped | New Models |
|-------|-------------|-----------|----------------|------------|
| 1     | ~3,000      | ~50       | 2 (InviteCode, Subscription) | 0 |
| 2     | ~100        | ~500      | 0              | 1 (UserApiKey) |
| 3     | 0           | ~50       | 0              | 0 |
| 4     | 0           | ~300      | 0              | 0 |

**Total effort:** ~2 hours CC time across all phases.

---

_Created: 2026-03-18 from /plan-ceo-review (SCOPE REDUCTION mode)_
_Reviewed: 2026-03-18 via /plan-ceo-review (HOLD SCOPE mode)_
