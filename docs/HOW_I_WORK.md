# How I work

I run Quartermaster the way I'd lead a small team. The team is AI agents,
mostly Claude Code. They write most of the code. I decide what we build and how
it fits together, and I say when it's ready.

## What I own

- **The product.** My partner and I use it every day, and the roadmap comes
  from that. Real use takes features out as well as putting them in. Cook
  logging and AI quantity planning both shipped and were later taken out.
- **The architecture.** SQLite on one machine, a thin Swift shell around the
  web app, AI that suggests while people decide. The iOS calls are written up
  in the [ADRs](adr), with their reasons.
- **The process.** The loop below is my design, and the rules in
  [AGENTS.md](../AGENTS.md) are mine. They grow whenever an agent finds a new
  way to get something wrong.
- **Day-to-day use.** Most changes start as something that annoyed one of us
  in the kitchen or the shop, so the flows have been worn in by daily use. The
  look is less settled. I pick colour and layout from rendered side-by-sides,
  and it's still changing.
- **Production.** Agents write the scripts. I read the dry run and decide
  whether it runs.

## The loop

1. An issue says what and why.
2. The agent questions me until no decision is left open.
3. One agent builds each piece in its own worktree, tests first.
4. A different agent reviews it, and the pull request says what review found.
5. Checks pass, it merges, and merging deploys.
