/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from 'vitest'
import { shouldRevalidate } from './root.tsx'
import { TOAST_PENDING_COOKIE } from './utils/toast-pending.ts'

const BASE_URL = 'https://quartermaster.app'

/**
 * Build `shouldRevalidate` args the way React Router builds them.
 *
 * `defaultShouldRevalidate` is derived here rather than passed in, mirroring
 * `getMatchesToLoad` in react-router/dist/.../router/router.js, in its order:
 * a failed (>=400) action skips revalidation outright; otherwise it is true
 * when revalidation is forced, when the URL is unchanged, or when the search
 * params changed. (The router also ORs in `isNewRouteInstance`, which is
 * always false for root — its matched pathname is "/" on every route.)
 *
 * `from` is the COMMITTED location — for a loader-thrown redirect that is the
 * page the user was on when they clicked, not the URL whose loader redirected
 * (that navigation never commits).
 *
 * `forced` covers the cases that set `isRevalidationRequired`: useRevalidator,
 * successful submissions, and a redirect whose response carries a Set-Cookie,
 * which the server turns into `X-Remix-Revalidate` for the client to replay.
 */
function navigation({
	from,
	to,
	forced = false,
	actionStatus,
}: {
	from: string
	to: string
	forced?: boolean
	actionStatus?: number
}) {
	const currentUrl = new URL(from, BASE_URL)
	const nextUrl = new URL(to, BASE_URL)
	return {
		currentUrl,
		nextUrl,
		defaultShouldRevalidate:
			actionStatus !== undefined && actionStatus >= 400
				? false
				: forced ||
					currentUrl.pathname + currentUrl.search ===
						nextUrl.pathname + nextUrl.search ||
					currentUrl.search !== nextUrl.search,
	}
}

function setPendingToastMarker() {
	document.cookie = `${TOAST_PENDING_COOKIE}=1; path=/`
}

afterEach(() => {
	document.cookie = `${TOAST_PENDING_COOKIE}=; path=/; max-age=0`
})

test('a lapsed-Pro redirect to /upgrade revalidates so the toast arrives with the user', () => {
	setPendingToastMarker()
	expect(
		shouldRevalidate(
			navigation({ from: '/recipes', to: '/upgrade', forced: true }),
		),
	).toBe(true)
})

test('a redirect away from a filtered list still carries its toast', () => {
	setPendingToastMarker()
	expect(
		shouldRevalidate(
			navigation({
				from: '/recipes?cuisine=thai',
				to: '/upgrade',
				forced: true,
			}),
		),
	).toBe(true)
})

test('the pantry-limit redirect back to /inventory revalidates', () => {
	// User is ON /inventory (committed), clicks through to /inventory/new,
	// whose loader throws redirectWithToast('/inventory') — so the pair the
	// router hands us is /inventory → /inventory, not /inventory/new →
	// /inventory (a navigation whose loader redirected never commits).
	setPendingToastMarker()
	expect(
		shouldRevalidate(
			navigation({ from: '/inventory', to: '/inventory', forced: true }),
		),
	).toBe(true)
})

test('a same-pathname redirect that only strips search params still delivers its toast', () => {
	// The shape the URL heuristic alone cannot distinguish from a filter
	// change: /upgrade?session_id=… whose loader redirects with a toast to
	// bare /upgrade. Only the marker cookie saves this one.
	setPendingToastMarker()
	expect(
		shouldRevalidate(
			navigation({
				from: '/upgrade?session_id=cs_test_123',
				to: '/upgrade',
				forced: true,
			}),
		),
	).toBe(true)
})

test('a pending toast forces revalidation even on shapes the router would skip', () => {
	setPendingToastMarker()
	expect(
		shouldRevalidate(navigation({ from: '/recipes', to: '/recipes/abc123' })),
	).toBe(true)
})

test('an ordinary page-to-page navigation skips the root loader', () => {
	expect(
		shouldRevalidate(navigation({ from: '/recipes', to: '/recipes/abc123' })),
	).toBe(false)
})

test('changing filters on a list skips the root loader', () => {
	expect(
		shouldRevalidate(
			navigation({ from: '/recipes', to: '/recipes?cuisine=thai' }),
		),
	).toBe(false)
})

test('without a pending toast, a same-pathname search-only change skips even when forced', () => {
	// Documented residual: a Set-Cookie redirect that keeps the pathname,
	// changes only the search AND carries no toast is indistinguishable from
	// a filter change (the router collapses both into one boolean). Toast
	// redirects are exempt via the marker; anything else in this narrow shape
	// accepts the skip in exchange for not re-running the root queries on
	// every filter interaction.
	expect(
		shouldRevalidate(
			navigation({
				from: '/upgrade?session_id=cs_test_123',
				to: '/upgrade',
				forced: true,
			}),
		),
	).toBe(false)
})

test('an explicit same-URL revalidation re-runs the root loader', () => {
	expect(
		shouldRevalidate(navigation({ from: '/recipes', to: '/recipes' })),
	).toBe(true)
})

test('a successful form submission re-runs the root loader', () => {
	// After a successful action the router forces revalidation
	// (isRevalidationRequired), so deferring to defaultShouldRevalidate keeps
	// the old `if (formAction) return true` behavior for the success case.
	expect(
		shouldRevalidate(
			navigation({
				from: '/recipes/new',
				to: '/recipes/abc123',
				forced: true,
			}),
		),
	).toBe(true)
})

test('a failed (4xx) action skips the root loader', () => {
	// The router deliberately skips revalidation after 4xx action results
	// (shouldSkipRevalidation). The old unconditional formAction branch
	// overrode that and re-ran the root queries on every validation error.
	expect(
		shouldRevalidate(
			navigation({
				from: '/settings/profile',
				to: '/settings/profile',
				actionStatus: 400,
			}),
		),
	).toBe(false)
})

test('leaving a filtered list re-runs the root loader', () => {
	// The router collapses "forced" and "search params changed" into one
	// boolean, so a navigation that changes both pathname and search is
	// indistinguishable from a forced one. We revalidate — the cost is one root
	// loader run, and the alternative is dropping non-toast forced
	// revalidations (session cookie refreshes) on these shapes.
	expect(
		shouldRevalidate(
			navigation({ from: '/recipes?cuisine=thai', to: '/recipes/abc123' }),
		),
	).toBe(true)
})
