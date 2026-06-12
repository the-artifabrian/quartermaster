# Performance Audit — Navigation Latency (PWA)

**Date:** 2026-06-08 · **Symptom:** 3–4s delays "often" navigating between pages
on the installed iPhone PWA — spinner top-left and/or the global progress bar
stuck partway. **Method:** whole-stack multi-agent audit (38 findings) → 3-lens
adversarial verification (28 survived, 10 killed) → completeness critique,
cross-checked against live `fly` data and an independent read of the hot paths.

---

## TL;DR

**Not the database.** SQLite is a **local file** on the LiteFS FUSE mount in
`fra` — sub-ms/low-ms queries that can't produce a multi-second stall even
stacked 6 deep. The libsql `file:` adapter is **better-sqlite3 (synchronous,
single-handle)**, so queries serialize on one thread regardless (`Promise.all`
saves ~0ms).

The seconds-scale cost is the **mobile network / connection path:**

1. **iOS suspends backgrounded PWAs** — tears down TCP/TLS, can freeze the JS
   context. First tap after a gap pays cold DNS+TCP+TLS to Frankfurt (+ the
   `EventSource` 3–5s jittered reconnect), maybe a full re-hydration. A daily
   user who backgrounds the app hits this constantly — best fits _"often."_ **←
   top suspect, measure first.**
2. **No prefetch on primary nav** → the `*.data` round-trip only starts on tap.
3. **SW serves `*.data` network-first** → cache never accelerates an online nav.
4. **SSE-triggered `revalidate()` on shopping** → the stuck bar with **no nav at
   all**, on the daily route.

**Caveat:** the audit can't fully split network vs cold-connection vs server
without one real-device reading — **do Tier-0 first.** Tier-1 fixes are safe and
high-leverage regardless.

---

## What the adversarial review overturned

The adversarial pass killed the scary infra theories (two from this
investigation's own first pass):

| Earlier claim                                   | Verdict                                                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Swap thrash on 512MB causes stalls              | **Killed** — swap is on root fs, not the LiteFS volume; one user can't thrash it                                 |
| `busy_timeout=5000` lock → multi-second reads   | **Killed** — WAL readers don't block on a writer; the "5s ≈ 3-4s" match was coincidence                          |
| Auto-stop cold starts                           | **Killed** — opt-in; machine is `started` and stays up (`fly status`)                                            |
| Serial waterfalls / "`Promise.all` the loaders" | **~0ms** — better-sqlite3 is synchronous single-handle; queries serialize anyway                                 |
| FUSE adds a network round-trip per query        | **Killed** — FUSE reads come from the local page cache (µs)                                                      |
| DB is remote Turso                              | **Wrong** — local SQLite file; this is why the "serial round-trip" findings collapsed high→low                   |
| `prefetch="render"` on the tabs                 | **→ `prefetch="intent"`** — `render` eagerly fetches all 4 tabs' `.data` per render, self-contending on one vCPU |

**Net:** the only seconds-scale candidates standing are the network/connection
path, iOS PWA cold-connection after backgrounding, and SSE-triggered
revalidation.

---

## Ranked causes

| #   | Cause                                                  | Evidence                                                                                                                                                                                                                            | Scale                          |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | **iOS PWA connection/JS teardown after backgrounding** | Platform behavior; first-tap-after-gap = cold DNS+TCP+TLS + SSE reconnect, maybe full re-hydration                                                                                                                                  | **seconds**                    |
| 2   | **No prefetch on primary nav**                         | `bottom-nav.tsx:90`, header `NavLink`s `root.tsx:368-407` — no `prefetch` (RR7 defaults to `none`); only `user-dropdown.tsx:17` uses it                                                                                             | **seconds** (warm; see caveat) |
| 3   | **SW serves `.data` network-first**                    | `sw.js:120-128`; cache only on offline fallback. RR7 appends `?_routes=…` (root has `shouldRevalidate`); SW caches by full URL but `isCacheablePage()` matches pathname → naive SWR mostly cache-misses until the key is normalized | **seconds**                    |
| 4   | **SSE + unconditional 30s poll + `revalidate()`**      | `household-event-source.client.tsx:58` polls _and_ holds EventSource; `shopping-live-refresh.tsx` re-fetches `.data` per household event. Pro-gated                                                                                 | spinner w/o nav                |
| 5   | **`shared-cpu-1x:512MB`, single machine, fra**         | `fly status`. Coupled to the synchronous single-thread driver: SSR + every SQLite call + held SSE handler share one fraction of one vCPU; inflates server-held navs under burst                                                     | amplifier                      |
| 6   | **Progress bar parked at 66% the whole wait**          | `progress-bar.tsx:40-46`; `useSpinDelay(delay:600, minDuration:400)` made 600–1000ms navs flash-and-linger                                                                                                                          | perception                     |
| 7   | **Over-fetch on weekly routes**                        | `/plan` pulls every recipe's full ingredients the calendar never renders (`plan/index.tsx:56-66`); `/recipes` loads whole-cookbook ingredients + JS match-sort each load                                                            | ms                             |

> **iOS prefetch caveat (verified, `react-router@7.14`):** `prefetch="intent"`
> binds `onTouchStart` (`chunk-ZZNWZ5Q3.js:8524`) and emits
> `<link rel="prefetch" as="fetch">` for `.data` + `<link rel="modulepreload">`
> for the chunk (`:8746`). **WebKit/iOS Safari doesn't support
> `rel="prefetch"`** → `.data` warming is a **no-op in the iPhone PWA** (still
> helps desktop/Chrome/Android; `modulepreload` works on Safari 17+ but chunks
> are already SW-cached). The iOS-effective equivalent is **SW
> stale-while-revalidate of `.data` + optimistic UI** (Tier 2). Keep the
> declarative prefetch (free) but don't count on it for iPhone.

**Ruled out (don't chase):** client bundle weight (no server-lib leak; chunks
cached cache-first), `routeDiscovery:'initial'` (it _helps_ nav), PostHog init,
Express middleware chain, compression (it _does_ cover `.data`), Google Fonts
(cached cache-first after first launch).

---

## Action plan

### Tier 0 — Measure first (before the bigger changes)

Strategy: **PostHog built-ins + one custom event** (chosen over hand-rolled
per-loader Server-Timing, which broke a test cast — wrapping loaders in `data()`
changed their return types).

- [x] **`capture_performance: { web_vitals: true, network_timing: true }`**
      (`entry.client.tsx`) — Web Vitals incl. INP as queryable events + `.data`
      resource timing on replays. INP under-reports SPA nav (spinner paints
      first) → treat as a floor, not the felt-nav number.
- [x] **`nav_duration_ms` custom event** (`NavTiming`, `root.tsx`) — the felt
      nav duration PostHog has no native metric for; aggregate p95/p50 of the
      `duration_ms` property, break down by `to`. **Note:** its `effective_type`
      and `rtt` props come from `navigator.connection` (Network Information
      API), which **WebKit/iOS Safari doesn't implement** → both are empty on
      the iPhone PWA. For the network-vs-server split on iOS, use Session
      Replay's network tab (`network_timing`) instead.
- [ ] **PostHog session replay** — watch a background→resume→tap session (best
      tool for the #1 suspect). Confirm replay + network capture are on in
      **project** settings.
- [ ] **iPhone Safari → Mac Web Inspector** (the one manual reading worth
      taking) — background a few min, switch back, tap a tab, inspect
      `/shopping.data` Timing: DNS/TCP/TLS (cold connection) vs Waiting/TTFB vs
      Download; then tap the same tab warm.
- [ ] **Fly Grafana** (CPU/mem/IO, zero code) —
      `fly dashboard metrics -a quartermaster-94e5`.
- [ ] **`fly logs` during a slow tap** — morgan `:response-time`; grep
      `starting|suspend|oom`; `fly machine list` STATE around the tap.

**Decision table:** high TTFB / connection-setup + low server response-time →
**NETWORK** (SWR-of-`.data`, SSE lifecycle, maybe replica). High server
response-time → **SLOW LOADER** (add OTel/Prisma tracing to find the query).
Machine `STATE` stopped / high CPU·mem near the tap → **MACHINE** (scale up).

**Deferred (only if server-side dominates):** OpenTelemetry HTTP +
`@prisma/instrumentation` → OTLP backend gives auto per-query spans with no
per-loader edits — the robust replacement for hand-rolled Server-Timing.

### Tier 1 — Safe, high-leverage (shipped, merged `#37` / `d2ec882`)

- [x] `prefetch="intent"` on the 4 `BottomNav` + 4 header links (see caveat —
      helps desktop/Chrome/Android; near-no-op for `.data` on iPhone, so not the
      iOS fix on its own).
- [x] **SSE lifecycle:** poll is now fallback-only (starts on SSE `error`, stops
      on `open`); SSE + poll **pause on `document.hidden`**, reconnect +
      catch-up poll on resume — stops the backgrounded PWA churning the radio
      and avoids a revalidate storm on resume.
- [x] **Progress bar:** trickles toward ~90% during `loading` then completes to
      100% (was parked at 66%); `useSpinDelay` → `delay:500, minDuration:300`.
- [ ] **Try a bigger machine** (one command, rules #5 in/out):
      `fly scale vm shared-cpu-2x -a quartermaster-94e5 --memory 1024`,
      re-measure. ← your turn (Fly CLI not authed here).

### Tier 2 — Linear-class wins (medium; gate on Tier-0 saying "network")

- [ ] **SWR the `.data`** for read-mostly routes (recipes list/detail, plan) —
      **after** normalizing the SW cache key to strip `?_routes=`. Keep shopping
      network-first (edited daily) or give it a short revalidate token.
- [ ] **Optimistic UI for shopping edits** (check/add/remove) via `useFetcher` —
      Linear's core trick, where it matters most.
- [ ] **Consolidate auth into one query**
      (`session → user → householdMember + subscription` in a single
      `findUnique`) + short-TTL in-memory LRU keyed by sessionId.
- [ ] Trim `/plan` and `/recipes` over-fetch (drop unused `ingredients`
      selects).

### Tier 3 — Only if measurement shows network/geo dominates

- [ ] **LiteFS read replica in your region.** Requires wiring txid-consistency
      middleware (`waitForUpToDateTxNumber`/`handleTransactionalConsistency` are
      unused; `server/app.ts` has no LiteFS middleware) or you'll get
      read-after-write staleness; GET-loader `create()` writes still forward to
      fra. **Don't start until Tier-0 confirms iPhone TTFB ≫ a fra-adjacent
      baseline.**

---

## How Linear does it, mapped here

Linear's whole story is **"don't touch the network on the critical path."**
Quartermaster is the opposite — every nav _is_ a network round-trip.

| Linear technique                      | Quartermaster                            | Action                                   |
| ------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| Optimistic mutations (apply locally)  | Shopping edits round-trip to fra first   | Tier 2 — optimistic `useFetcher`         |
| Local-first / IndexedDB; never waits  | SSR + fetch `.data` per nav              | Endgame; **SWR-of-`.data`** is the 80/20 |
| Render-first auth (verify async)      | Blocks render on session+household+tier  | SWR-of-`.data` _is_ this                 |
| SW precache → nav needs no network    | SW exists but network-first for `.data`  | Tier 2 — flip read routes to SWR         |
| Modulepreload / aggressive code-split | Already good; split & cached cache-first | None (bundle ruled out)                  |
| Variable fonts, GPU-only animations   | Minor                                    | Optional polish                          |

Source: https://performance.dev/how-is-linear-so-fast-a-technical-breakdown

---

## Infra (`fly status`, 2026-06-08)

```
app │ 1 │ shared │ 1 vCPU │ 512 MB │ fra  (machine 4d892165b94638, state: started)
```

Single `shared-cpu-1x:512MB` in `fra`, `started`, no auto-stop in `fly.toml`. So
**not** cold-start-from-stopped, **not** swap thrash. Size only bites combined
with the synchronous single-thread driver during bursts — cheap to rule out by
scaling up and re-measuring.

---

## Key file references

- Nav links (no prefetch): `app/components/bottom-nav.tsx:90`,
  `app/root.tsx:368-407`
- Prefetch precedent: `app/components/user-dropdown.tsx:17`
- SW `.data` network-first: `public/sw.js:120-128`; `isCacheablePage`
  `public/sw.js:154-184`
- Progress bar: `app/components/progress-bar.tsx:10-46`
- SSE + poll: `app/utils/household-event-source.client.tsx:58`,
  `app/components/shopping-live-refresh.tsx`
- Auth chain: `app/utils/auth.server.ts:34-52`,
  `app/utils/household.server.ts:9-19`,
  `app/utils/subscription.server.ts:48-147`
- DB adapter (synchronous single-handle): `app/utils/db.server.ts:13`
- Server-Timing template: `app/routes/settings/profile/connections.tsx:50,84`
- LiteFS instance read per `.data`: `app/entry.server.tsx:135`
- Over-fetch: `app/routes/plan/index.tsx:56-66`,
  `app/routes/recipes/index.tsx:119-133,196-211`
- Infra: `fly.toml`, `other/litefs.yml`
