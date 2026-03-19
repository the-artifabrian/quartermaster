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

## Under the hood

The ingredient matching is the core of the app. "Chicken breast" shouldn't match
"chicken thigh," but "cilantro" should match "coriander," and "rice" absolutely
should not match "rice vinegar." It uses a 4-level system (exact, synonym, core
word, multi-word containment) with guards for compounds and cut-sensitive
proteins.

Shopping list generation is trickier than it sounds: deduplicate ingredients
across recipes, handle unit conversion, subtract what's already in inventory,
filter out pantry staples. Add household sharing and now two people need
real-time sync via SSE so they can check things off the same list at the store.

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
| Testing    | [Vitest](https://vitest.dev/) (850+ unit/integration) + [Playwright](https://playwright.dev/) (e2e) |

Bootstrapped from the [Epic Stack](https://www.epicweb.dev/epic-stack).

## Getting started

Requires Node.js >= 22.

```bash
npm install
cp .env.example .env
npm run setup
npm run dev              # http://localhost:3000
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
- [Features](docs/FEATURES.md): detailed feature reference

## License

[MIT](LICENSE)
