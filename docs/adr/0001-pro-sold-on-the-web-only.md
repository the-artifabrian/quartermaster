---
status: accepted
date: 2026-10-04
---

# Sell Pro on the web only

Quartermaster's iOS app presents the Web app, and Pro is a paid tier. Apple
takes a commission on digital goods bought inside an app and forbids links or
other calls to action that lead to buying them elsewhere (App Review Guidelines
3.1.1 and 3.1.3). A second billing system next to Stripe, with two sources of
entitlement to reconcile, is not worth it for a household-sized product, and the
regional allowances for external purchase links carry their own reporting
duties. So Pro is sold on the web only, and the iOS app shows no purchasing at
all: no upgrade page, no Pro button or nudge, no subscription management, and no
copy about buying Pro. A free user in the iOS app sees the Pro surfaces absent
rather than locked. A Pro user has every Pro feature.

## Consequences

- The server must recognise requests from the iOS app, and every Pro purchase
  surface must branch on that signal, covered by Playwright with both user
  agents and both tiers.
- A free user who wants Pro has to find the web app on their own.
- Account creation and deletion both work inside the iOS app, which guideline
  5.1.1(v) requires of any app with accounts.
