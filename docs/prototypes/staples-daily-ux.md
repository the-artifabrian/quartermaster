# Staples daily UX prototype

Question: which information hierarchy makes Staples feel like a quick daily
restocking tool rather than a setup or management page?

Run the existing app with one command:

```sh
bun run dev
```

Open the active Staples page and switch variants with the floating controls or
the left/right arrow keys:

- `/inventory?variant=A` — Restock queue: Out and usually-available groups.
- `/inventory?variant=B` — Filterable ledger: one compact status list.
- `/inventory?variant=C` — Trip board: a prominent shopping-oriented summary.

The variants use the signed-in Household's real Staples for realistic density,
but Add, Out, Available, and Remove change in-memory prototype state only. The
prototype is hidden unless the app is running in development. For an explicit
production-build browser capture, set `VITE_STAPLES_PROTOTYPE=true` only for
that local build.
