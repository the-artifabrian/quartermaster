# Quartermaster

A recipe app that actually knows what's in your kitchen.

I built this to replace 100+ recipes scattered across Apple Notes. It turned
into a full meal planning system: track your inventory, see which recipes you
can make right now, plan the week, generate a shopping list, and check things
off at the store so your inventory stays up to date.

**Live at [useqm.app](https://useqm.app)**

## How it works

You tell the app what's in your kitchen. Every recipe gets a match percentage
based on what you have on hand, so you can sort by "what can I cook tonight"
without thinking. Plan meals for the week and it generates a shopping list,
minus what's already in inventory. Check items off at the store and they flow
back into inventory for next time.

The UI is built around the reality that most home cooks don't photograph their
food. No grey placeholders -- warm serif typography and the recipe text carry
the design.

## Features

**Recipes:** URL import, bulk import (Apple Notes, text files), full-text
search, favorites, serving scaling with fractions, metric/imperial toggle, print
view, public sharing with OG tags and JSON-LD.

**Cooking mode:** check off ingredients and steps as you go, inline timers
auto-detected from recipe text, temperature conversion tooltips, wake lock.

**Inventory:** flat item list with 4-level fuzzy matching (exact, synonym, core
word, multi-word containment), stale item review, swipe-to-delete.

**Meal planning:** weekly calendar, per-entry serving overrides, uncooked meal
reminders, copy week, single-use ingredient waste alerts.

**Shopping list:** auto-generated from meal plan (deduped, inventory-aware),
real-time sync across household members via SSE, check-off to inventory.

**Household sharing:** invite-based, all data scoped to household, real-time
shopping list sync.

**AI features** (all optional): recipe extraction from text or screenshots,
recipe generation from inventory, ingredient substitutions, voice input via
Whisper.

## Tech stack

| Layer      | Tech                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------- |
| Framework  | [React Router v7](https://reactrouter.com/) (Remix)                                                 |
| Database   | SQLite via [Prisma](https://www.prisma.io/)                                                         |
| Styling    | [Tailwind CSS v4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/)                 |
| Auth       | Sessions, email verification, Google OAuth, passkeys (WebAuthn)                                     |
| AI         | Anthropic Claude (recipe extraction/generation) + Groq Whisper (voice)                              |
| Payments   | Stripe Checkout + webhooks                                                                          |
| Real-time  | Server-Sent Events                                                                                  |
| Storage    | S3-compatible (Tigris) with Sharp image processing                                                  |
| Deployment | [Fly.io](https://fly.io/) with LiteFS + Docker                                                      |
| Testing    | [Vitest](https://vitest.dev/) (850+ unit/integration) + [Playwright](https://playwright.dev/) (e2e) |

Bootstrapped from the [Epic Stack](https://www.epicweb.dev/epic-stack).

## Getting started

Requires Node.js >= 22.

```bash
npm install
cp .env.example .env    # edit with your config -- all API keys are optional
npm run setup            # database + Playwright
npm run dev              # http://localhost:3000
```

### Environment variables

The app runs fully functional with just a database. Everything else is optional:

| Variable                | Required | Purpose                   |
| ----------------------- | -------- | ------------------------- |
| `SESSION_SECRET`        | Yes      | Session encryption        |
| `DATABASE_URL`          | Yes      | SQLite connection string  |
| `ANTHROPIC_API_KEY`     | No       | AI recipe features        |
| `GROQ_API_KEY`          | No       | Voice-to-text via Whisper |
| `STRIPE_SECRET_KEY`     | No       | Subscription billing      |
| `AWS_*` / `BUCKET_NAME` | No       | Recipe image uploads      |
| `GOOGLE_CLIENT_ID`      | No       | Google OAuth              |
| `RESEND_API_KEY`        | No       | Transactional emails      |

## Scripts

```bash
npm run dev          # Dev server with mocks
npm run build        # Production build
npm run start        # Production server
npm run test         # Unit/integration tests
npm run test:e2e     # Playwright e2e tests
npm run typecheck    # Type checking
npm run lint         # ESLint
npm run validate     # All checks
npx prisma studio    # Database GUI
```

## Docs

- [Architecture](docs/ARCHITECTURE.md): system design, data flow, matching
  algorithm
- [Development Plan](docs/DEVELOPMENT_PLAN.md): status, technical debt, backlog
- [Design System](docs/DESIGN_SYSTEM.md): typography, colors, spacing,
  components
- [Features](docs/FEATURES.md): detailed feature reference

## License

[MIT](LICENSE)
