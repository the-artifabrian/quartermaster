# Quartermaster

A personal cookbook that turns saved recipes into a weekly cooking plan and
shopping list.

I built this to replace 100+ recipes scattered across Apple Notes. It turned
into a full meal planning system: import recipes, plan the week, generate a
shopping list, cook from the app, and remember what you usually keep on hand so
the list focuses on what you may need to buy.

**Live at [useqm.app](https://useqm.app)**

## How it works

You save the recipes you actually cook, then add them to a weekly plan. From
there Quartermaster generates a shopping list across the planned meals,
deduplicates ingredients, handles unit conversion, and marks things you usually
keep on hand so you can quickly see what needs buying.

Pantry is intentionally low-maintenance. It is not a warehouse ledger for exact
current stock. The app should work well even if you only tell it what you
usually keep around.

## Under the hood

Shopping list generation is the core utility of the app: deduplicate ingredients
across planned recipes, handle unit conversion, separate usually-on-hand items
from what probably needs buying, and keep the list usable in the store. Once
two people share a household, they need real-time sync via SSE to check items
off the same list.

Ingredient matching supports that loop. "Chicken breast" should not match
"chicken thigh," but "cilantro" should match "coriander," and "rice" should not
match "rice vinegar." It uses a 4-level system (exact, synonym, core word,
multi-word containment) with guards for compounds and cut-sensitive proteins.

The AI features chain multiple models (Claude for recipe extraction from
screenshots and text, Groq Whisper for voice input) with regex fallbacks for
when the LLM gets creative. All optional, the app runs fine without any API
keys.

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
| Testing    | [Vitest](https://vitest.dev/) (830+ unit/integration) + [Playwright](https://playwright.dev/) (e2e) |

Bootstrapped from the [Epic Stack](https://www.epicweb.dev/epic-stack).

## Getting started

Requires [Bun](https://bun.com/) >= 1.3.13.

```bash
bun install
cp .env.example .env
bun run setup
bun run dev              # http://localhost:3000
```

All external services (Stripe, S3, Google OAuth, email) are mocked in dev, so
you can clone and run without configuring a single account. See
[`.env.example`](.env.example) for the full list of options.

## Docs

- [Architecture](docs/ARCHITECTURE.md): system design, data flow, matching
  algorithm
- [Development Plan](docs/DEVELOPMENT_PLAN.md): status, technical debt, backlog
- [Design System](docs/DESIGN_SYSTEM.md): typography, colors, spacing,
  components
- [Copywriting](docs/COPYWRITING.md): product voice and anti-AI-copy checklist
- [Features](docs/FEATURES.md): detailed feature reference

## License

[MIT](LICENSE)
