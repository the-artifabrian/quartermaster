# Staples daily UX prototype

Question: which compact header composition keeps search and Add useful without
pushing the Out queue down the page?

Run the existing app with one command:

```sh
bun run dev
```

Open the active Staples page and switch variants with the floating controls or
the left/right arrow keys:

- `/inventory?variant=A` — Unified toolbar: search and Add share one row; Add
  replaces that row with a compact composer.
- `/inventory?variant=B` — Quiet title actions: search and Add start as
  low-emphasis title actions, then reveal one control at a time.
- `/inventory?variant=C` — Two-field utility row: search and quick-add remain
  visible side by side.

Verdict: A. Search remains immediately discoverable for large lists, Add sits
beside the utility it temporarily replaces, and the composer needs no card or
second input row. Feedback takes space only when there is feedback, bringing the
Out queue substantially closer to the page purpose. B hides a useful large list
affordance, while C leaves two visually equal inputs competing for focus.

The variants use the signed-in Household's real Staples for realistic density,
but Add, Out, Available, and Remove change in-memory prototype state only. The
prototype is hidden unless the app is running in development. For an explicit
production-build browser capture, set `VITE_STAPLES_PROTOTYPE=true` only for
that local build.
