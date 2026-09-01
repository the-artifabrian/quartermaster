# Quartermaster

A personal cookbook for saving Recipes, planning Meals, and making one useful
Shopping list.

I built Quartermaster to replace 100+ Recipes scattered across Apple Notes. It
now handles the whole weekly loop without turning the kitchen into an inventory
system.

**Live at [useqm.app](https://useqm.app)**

## How it works

1. Save or import the Recipes you cook.
2. Plan individual Recipes or reusable multi-dish Menus as ordered Meals.
3. Generate Shopping from the plan.
4. Keep a short household Staples list; mark a Staple Out when it needs buying.
5. Cook from the Recipe and check off Shopping together in real time.

Recipe cards stay simple. Availability appears on Recipe detail, where it can
help with a decision, and Shopping omits normal Staples while including Out
Staples and non-Staples.

## Product shape

- **Recipes** hold the canonical ingredients and instructions.
- **Menus** are reusable groups of ordered Recipe and note cards.
- **Meals** are scheduled Recipe items, Menu snapshots, or plain text.
- **Staples** are household ingredients normally assumed available; **Out** puts
  one back into generated Shopping.
- **Shopping** combines Recipe ingredients, Menu note lines, and manual items
  without pretending to know exact stock.

AI is optional. It extracts Recipes from text and images, suggests description
improvements for review, and parses speech. The manual app works without API
keys.

## Tech stack

| Layer    | Tech                                                 |
| -------- | ---------------------------------------------------- |
| App      | React Router v7, React, Express                      |
| Data     | Prisma, SQLite, LiteFS                               |
| UI       | Tailwind CSS v4, Radix UI                            |
| Auth     | Sessions, email verification, Google OAuth, passkeys |
| AI       | Anthropic Claude, Groq Whisper                       |
| Services | Stripe, Tigris-compatible object storage, SSE        |
| Hosting  | Fly.io, Docker                                       |
| Tests    | Vitest plus focused Playwright coverage              |

Bootstrapped from the [Epic Stack](https://www.epicweb.dev/epic-stack).

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

- [Product terms](CONTEXT.md)
- [Features](docs/FEATURES.md)
- [Development plan](docs/DEVELOPMENT_PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Design system](docs/DESIGN_SYSTEM.md)
- [Copy guide](docs/COPYWRITING.md)
- [Database restore runbook](docs/RESTORE.md)

## License

[MIT](LICENSE)
