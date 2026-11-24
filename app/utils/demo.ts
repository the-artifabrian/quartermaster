/**
 * The demo: a visitor who taps "Try the demo" gets a user of their own with a
 * copy of the sample Household, on Pro, for a couple of hours. The numbers
 * here are shared by the server and the page, so this file imports nothing
 * server-only. The copy itself is in demo.server.ts.
 */

/** How long a demo visit lasts before expiry deletes the demo user. */
export const DEMO_LIFETIME_MS = 2 * 60 * 60 * 1000

/** Uses of each AI feature one demo user gets. */
export const DEMO_AI_USES_PER_FEATURE = 3

/** AI uses all demo users share in a day. Real users never count toward it. */
export const DEMO_AI_USES_PER_DAY = 60

/** Demo users alive at once. A start past it is refused. */
export const DEMO_LIVE_LIMIT = 30

/**
 * Whether a user is a demo visitor. Any `demoExpiresAt` counts, even one in
 * the past: a demo user whose time is up is still not a real account.
 */
export function isDemoUser(user: { demoExpiresAt: Date | string | null }) {
	return user.demoExpiresAt != null
}
