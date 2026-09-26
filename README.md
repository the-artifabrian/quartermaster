# Quartermaster

[![Deploy](https://github.com/the-artifabrian/quartermaster/actions/workflows/deploy.yml/badge.svg)](https://github.com/the-artifabrian/quartermaster/actions/workflows/deploy.yml)

A personal cookbook for saving Recipes, planning Meals, and making one useful
Shopping list.

I built Quartermaster to replace 100+ Recipes scattered across Apple Notes. It
now handles the whole weekly loop without turning the kitchen into an inventory
system.

**Live at [useqm.app](https://useqm.app)**

## How it works

1. Save or import the Recipes you cook.
2. Plan individual Recipes or reusable multi-dish Menus as ordered Meals.
3. Open From Plan on Shopping and pick the Meals and lines to buy for.
4. Keep a short household Staples list; add one from its row to put it on the
   next shop.
5. Cook from the Recipe and check off Shopping together in real time.

Recipe cards and Recipe detail stay simple: they show what a Recipe needs, with
each ingredient one tap from Shopping. Shopping picked from the plan starts with
the lines matching a Staple unticked and keeps everything else.

## Product shape

- **Recipes** hold the canonical ingredients and instructions.
- **Menus** are reusable groups of ordered Recipe and note cards.
- **Meals** are scheduled Recipe items, Menu snapshots, or plain text.
- **Staples** are household ingredients normally assumed available, kept as a
  quick-add list: add one and it lands in Next shop.
- **Shopping** combines Recipe ingredients, Menu note lines, and manual items
  without pretending to know exact stock.

AI is optional. It extracts Recipes from text and images, suggests description
and time improvements for review, and parses speech. The manual app works
without API keys.

## Tech stack

| Layer    | Tech                                                 |
| -------- | ---------------------------------------------------- |
| App      | React Router v8, React, Express                      |
| Data     | Prisma, SQLite, LiteFS                               |
| UI       | Tailwind CSS v4, Radix UI                            |
| Auth     | Sessions, email verification, Google OAuth, passkeys |
| AI       | Anthropic Claude, Groq Whisper                       |
| Services | Stripe, Tigris-compatible object storage, SSE        |
| Hosting  | Fly.io, Docker                                       |
| Tests    | Vitest plus focused Playwright coverage              |

Bootstrapped from the [Epic Stack](https://www.epicweb.dev/epic-stack).

## Engineering notes

- **Shopping checks are versioned.** Every check submits the purchase version it
  saw, and SQLite triggers advance that version whenever demand changes, so a
  check can never silently cover an ingredient added after the shopper looked.
  Retries are safe through one latest request id.
  [Shopping in ARCHITECTURE](docs/ARCHITECTURE.md#shopping)
- **One small machine, run deliberately.** SQLite under LiteFS with a static
  lease on a single Fly Machine, forward-only Prisma migrations with a
  documented journal dance, nightly offsite backups, and a restore runbook.
  [Deployment and recovery](docs/ARCHITECTURE.md#deployment-and-recovery) ·
  [Restore runbook](docs/RESTORE.md)
- **Two watchdogs.** One restarts the process before memory pressure reaches
  swap; the other watches the event loop from a worker thread, since a wedged
  loop cannot report itself. Both live in [`server/`](server/), each commented
  with the failure it guards against.

## Getting started

Requires [Bun](https://bun.com/) >= 1.3.13.

```bash
bun install
cp .env.example .env
bun run setup
bun run dev
```

The development environment mocks Stripe, storage, Google OAuth, and email. See
[`.env.example`](.env.example) for optional service configuration.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Product terms](CONTEXT.md)
- [Features](docs/FEATURES.md)
- [Design system](docs/DESIGN_SYSTEM.md)
- [Copy guide](docs/COPYWRITING.md)
- [Database restore runbook](docs/RESTORE.md)
- [Development plan](docs/DEVELOPMENT_PLAN.md)

## License

[MIT](LICENSE)
