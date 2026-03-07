# Quartermaster

A full-stack recipe management app with inventory-aware recipe matching, meal
planning, and shopping list generation. Plan meals, know what to buy, cook from
what you have.

Built with React Router v7, SQLite, Tailwind CSS, and AI features (Claude,
Whisper). Daily-driven for personal use since February 2026.

<!-- TODO: Add 2-3 screenshots here (recipe list, cooking mode, meal plan) -->

## What makes this different

Most recipe apps store recipes. Quartermaster connects recipes to your kitchen:

- **Inventory-aware matching** — Track what's in your kitchen. Every recipe
  shows a match percentage ring based on ingredients you already have. Sort by
  "ready to cook" to find what you can make tonight.
- **Closed-loop pipeline** — Plan meals, generate a shopping list (minus what
  you have), check items off at the store, and they flow back into inventory.
  One loop, not disconnected features.
- **Cookbook-quality design without photos** — Most recipes don't have images.
  The app is designed around that reality with warm serif typography, not
  around it.

## Features

- **Recipes** — Full CRUD, URL import, bulk import (Apple Notes, text files),
  full-text search, favorites, scaling with fraction display, metric/imperial
  toggle, print view, public sharing with OG meta tags and JSON-LD
- **Cooking mode** — Interactive ingredient and instruction check-off, inline
  timers auto-detected from recipe text, temperature conversion tooltips,
  wake lock, auto-scroll to next step
- **Inventory** — Flat item list with 4-level fuzzy matching (exact, synonym,
  core word, multi-word containment), stale item review, swipe-to-delete,
  duplicate detection via ingredient normalization pipeline
- **Meal planning** — Weekly calendar, drag-to-assign, per-entry serving
  overrides, uncooked meal reminders, copy week, single-use ingredient waste
  alerts
- **Shopping list** — Auto-generated from meal plan (deduped, inventory-aware),
  real-time sync via SSE across household members, check-off to inventory
  pipeline
- **Household sharing** — Invite-based, all data scoped to household, real-time
  shopping list sync, member management
- **AI features** (optional, requires API keys) — Recipe extraction from
  informal text or screenshots, recipe generation from inventory, metadata
  enhancement, ingredient substitution hints, voice-to-text input via Whisper

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [React Router v7](https://reactrouter.com/) (Remix) |
| Database | SQLite via [Prisma](https://www.prisma.io/) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) primitives |
| Auth | Session-based with email verification, Google OAuth, passkeys (WebAuthn) |
| AI | Anthropic Claude (recipe extraction, generation, substitutions) + Groq Whisper (voice input) |
| Payments | Stripe Checkout + Customer Portal + webhooks |
| Real-time | Server-Sent Events for shopping list sync |
| Image storage | S3-compatible (Tigris) with Sharp processing |
| Deployment | [Fly.io](https://fly.io/) with LiteFS + Docker |
| Testing | [Vitest](https://vitest.dev/) (39 unit/integration) + [Playwright](https://playwright.dev/) (10 e2e) |

Bootstrapped from the [Epic Stack](https://www.epicweb.dev/epic-stack) by Kent
C. Dodds.

## Getting Started

### Prerequisites

- Node.js >= 22
- npm

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration (all API keys are optional)

# Initialize database and install Playwright
npm run setup

# Start development server
npm run dev
```

Visit http://localhost:3000 and create an account.

### Environment Variables

All external service integrations are optional. The app runs fully functional
with just the database:

| Variable | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | Yes | Session encryption |
| `DATABASE_URL` | Yes | SQLite connection string |
| `ANTHROPIC_API_KEY` | No | AI recipe features (extraction, generation, substitutions) |
| `GROQ_API_KEY` | No | Voice-to-text via Whisper |
| `STRIPE_SECRET_KEY` | No | Subscription billing |
| `AWS_*` / `BUCKET_NAME` | No | Recipe image uploads |
| `GOOGLE_CLIENT_ID` | No | Google OAuth login |
| `RESEND_API_KEY` | No | Transactional emails |

## Scripts

```bash
npm run dev          # Start dev server with mocks
npm run build        # Production build
npm run start        # Start production server
npm run test         # Run Vitest unit/integration tests
npm run test:e2e     # Run Playwright e2e tests (UI mode)
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
npm run validate     # Run all checks (test + lint + typecheck + e2e)
npx prisma studio    # Database GUI
```

## Documentation

- [Development Plan](docs/DEVELOPMENT_PLAN.md) — Project status, technical
  debt, backlog, and design decisions
- [Design System](docs/DESIGN_SYSTEM.md) — Typography, color palette, spacing,
  animation, and component guidelines
- [Features](docs/FEATURES.md) — Exhaustive feature reference

## License

[MIT](LICENSE)
