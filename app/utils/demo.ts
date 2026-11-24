/**
 * The demo: a visitor who taps "Try the demo" gets a user of their own with a
 * copy of the sample Household, on Pro, for a couple of hours. The numbers
 * here are shared by the server and the page, so this file imports nothing
 * server-only. The copy itself is in demo.server.ts.
 */
import { type Prisma } from '#app/generated/prisma/client.ts'
import { formatDuration } from './format-duration.ts'

/** How long a demo visit lasts before expiry deletes the demo user. */
export const DEMO_LIFETIME_MS = 2 * 60 * 60 * 1000

/** Uses of each AI feature one demo user gets. */
export const DEMO_AI_USES_PER_FEATURE = 3

/** AI uses all demo users share in a day. Real users never count toward it. */
export const DEMO_AI_USES_PER_DAY = 60

/** What a demo user sees when they try something the demo turns off. */
export const DEMO_BLOCKED_MESSAGE =
	"That's turned off in the demo. Sign up to use it with your own account."

/** Demo users alive at once. A start past it is refused. */
export const DEMO_LIVE_LIMIT = 30

/**
 * Whether a user is a demo visitor. Any `demoExpiresAt` counts, even one in
 * the past: a demo user whose time is up is still not a real account.
 */
export function isDemoUser(user: { demoExpiresAt: Date | string | null }) {
	return user.demoExpiresAt != null
}

/**
 * The demo template's owners have emails under this domain (demo.server.ts).
 * `.invalid` is reserved, so no real address can be one.
 */
export const DEMO_TEMPLATE_EMAIL_DOMAIN = 'demo-template.invalid'

/**
 * Households with no demo user and no demo template owner in them, as a
 * Prisma filter. The public share pages show only these: anyone with a link
 * can open them, and a demo is nobody's to publish. The template is matched
 * by its owner's email rather than the `DemoTemplate` row, so a template
 * still being built, or one just replaced, is covered too.
 */
export const NOT_A_DEMO_HOUSEHOLD = {
	members: {
		none: {
			user: {
				OR: [
					{ demoExpiresAt: { not: null } },
					{ email: { endsWith: `@${DEMO_TEMPLATE_EMAIL_DOMAIN}` } },
				],
			},
		},
	},
} satisfies Prisma.HouseholdWhereInput

/**
 * The time left in a demo now, by the server's clock. The root loader sends
 * `msLeftAtLoad`, the time left when it ran, and the page notes its own
 * clock when that reading arrives (`loadedAt`). Only the time passed on the
 * page's clock since then counts, so a page whose clock is hours off still
 * agrees with the server, and a tab that slept has lost the time it slept.
 * A clock set back adds nothing.
 */
export function demoMsLeftNow({
	msLeftAtLoad,
	loadedAt,
	now,
}: {
	msLeftAtLoad: number
	loadedAt: number
	now: number
}) {
	return msLeftAtLoad - Math.max(0, now - loadedAt)
}

/** Whole minutes left, rounded up, so a demo never reads "0 min" while it runs. */
function minutesLeft(msLeft: number) {
	return msLeft > 0 ? Math.ceil(msLeft / 60_000) : 0
}

/** "1 hr 40 min" for the banner, or null once the demo has ended. */
export function demoTimeLeftLabel(msLeft: number) {
	const minutes = minutesLeft(msLeft)
	return minutes > 0 ? formatDuration(minutes) : null
}

/** The same time left as an ISO 8601 duration, for `<time dateTime>`. */
export function demoTimeLeftIso(msLeft: number) {
	const minutes = minutesLeft(msLeft)
	if (minutes === 0) return null
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	return `PT${hours ? `${hours}H` : ''}${rest ? `${rest}M` : ''}`
}
