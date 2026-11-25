# Security

## Reporting a vulnerability

Please report a security problem privately, with "Report a vulnerability" on the
repo's Security tab
(https://github.com/the-artifabrian/quartermaster/security/advisories/new), and
not in a public issue.

The rest of this file describes the app's limits on guessing and abuse. It
covers the rate limits, passwords, two-factor codes and emailed codes, and which
addresses a Recipe link import may fetch. How sign-in, sessions and emailed
codes work is in [ARCHITECTURE.md](./ARCHITECTURE.md#auth-and-subscriptions).

## Rate limits

Express limits requests per client address before React Router sees them, and
nothing a client sends can choose its own bucket.
`app/utils/client-address.server.ts` picks the address. Production traffic comes
through Cloudflare, then Fly, so Fly's `fly-client-ip` is usually a Cloudflare
edge. The visitor's own address, in `cf-connecting-ip`, counts only when the
request carries our edge secret in `x-qm-edge` (see
[Deployment and recovery](./ARCHITECTURE.md#deployment-and-recovery)). The
connecting address alone can't show that a request came through our zone.
Without the secret the key is `fly-client-ip`. `req.ip`, which comes from
`X-Forwarded-For`, is used only when no `fly-client-ip` arrives at all, as in
local runs; an unreadable one goes to a single shared bucket. IPv4-mapped
addresses count as IPv4, and IPv6 addresses count per /64.

`server/rate-limit.ts` picks the limit from the path as the router resolves it
(decoded, any case, dot segments resolved, `.data` dropped). Sign-in, sign-out,
sign-up, codes, passkeys, Household invites, account settings and admin allow 10
non-GET requests a minute. This is the auth tier the sections below count on.
The paid AI routes (Recipe import, enhance, transcribe) allow 20 in their own
bucket, other non-GET requests 100, and GETs 1000, except passkey GETs under
`/webauthn`, which make a challenge and allow 100. The
apple-app-site-association file, at `/.well-known/apple-app-site-association`
and `/apple-app-site-association`, has no limit. Apple's CDN fetches it from
shared addresses, and a 429 there would break passkeys and universal links for
every iOS user. Tests check that every listed path is a real route, and that
every action under `_auth`, every other action that checks a password or code,
takes an invite or sends an email, and every route that reaches a paid AI helper
is on a strict tier.

## Passwords

Sign-in is limited per address only: 10 tries a minute, so 600 an hour from one
address. There is no per-account count. A per-account count would let a stranger
who knows the username lock the owner out from the sign-in form. In Settings it
would add nothing, because someone holding a session can read the username and
guess on the sign-in form at the same rate.

An attacker with many addresses is held back only by how fast the server checks
passwords. They are hashed with bcryptjs at cost 10, which is slow on purpose
and runs on the one JavaScript thread, so checks don't run in parallel. That
caps how many guesses the whole server can check in a second, whatever the
number of addresses.

Passwords are at least 6 characters. New ones are checked against Pwned
Passwords when it answers within a second; on a timeout or an error the check is
skipped.

## Two-factor codes

An authenticator code is 6 digits. The check accepts the code for the current 30
seconds and for one step either side, so one guess has a 3 in a million chance.

A 2FA sign-in waits for its code as a pending `Session` row. That row takes at
most 5 codes. After the fifth wrong one it is deleted, and the person logs in
again. Only someone with the password can start a sign-in, so the cap can't lock
the owner out. The count is the row's `signInTries`, so a restart doesn't reset
it. One `UPDATE … RETURNING` adds each try and reads the total, and a row that
has gone counts as over the cap. A code for any account other than the browser's
pending sign-in or its signed-in user isn't checked at all.

So one sign-in gives at most 5 × 3 in a million, or 1.5 in 100,000, and the next
needs the password again. Sign-in and `/verify` share the auth tier's 10 POSTs a
minute per address. Each round is one login POST and 5 codes, so one address
gets about 8 codes a minute, 12,000 a day. That is about a 3.5% chance a day,
for someone who already has the password. A reverify of a session someone
already holds has no count of its own, only the auth tier: 10 codes a minute,
14,400 a day, about 4.2% a day. Both grow with the number of addresses an
attacker has.

## Emailed codes

An emailed code is 8 characters from a 33-character alphabet, so there are 33^8,
about 1.4 × 10^12, of them. A guess is one POST to `/verify`, checked against at
most the 5 live codes of the target it names. There are no wrong-guess counters,
since a counter a stranger could fill would end the owner's codes early.

One address gets 10 POSTs a minute, so 100 guesses in a code's 10 minutes. That
is a chance of at most 100 × 5 ÷ 33^8, about 3.6 × 10^-10, per 10 minutes, about
5 × 10^-8 a day and 2 × 10^-5 a year.

An attacker with many addresses isn't held back by the rate limit, only by the
cap, the code space and how fast the server answers. If it answered 1,000
guesses a second, far more than the one shared-CPU machine serves, that is
600,000 × 5 ÷ 33^8, about 2.1 × 10^-6, per 10 minutes, about 3 × 10^-4 a day and
11% a year of guessing without a break. Keeping 5 codes live costs the owner 5
emails every 10 minutes, 720 a day, which they would notice long before that.

The codes are stored only as HMAC digests keyed with `SESSION_SECRET`. A plain
hash of a code this short could be reversed by trying every code, and the digest
can't be checked without the secret.

## Fetching Recipe links

A Recipe URL import fetches a page the visitor names, so it may only reach
public addresses. `app/utils/public-url.server.ts` resolves the host, refuses
private and reserved addresses, and pins the fetch to the address it checked.
The ranges rest on Bun's own `BlockList` in production. The guard refuses the
IPv6 ranges that wrap or relay to another address (IPv4-compatible `::/96`,
IPv4-translated `::ffff:0:0:0/96`, 6to4, Teredo, the discard prefix and
local-use NAT64) outright, along with the old site-local `fec0::/10`, and judges
well-known NAT64 by the IPv4 address inside. `bun run test:address-pinning`
checks the pinning under Bun (see [Testing](./ARCHITECTURE.md#testing)).
