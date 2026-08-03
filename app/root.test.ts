import { expect, test } from 'vitest'
import { shouldRevalidate } from './root.tsx'

const BASE_URL = 'https://quartermaster.app'

/**
 * Build `shouldRevalidate` args the way React Router builds them.
 *
 * `defaultShouldRevalidate` is derived here rather than passed in, mirroring
 * `getMatchesToLoad` in react-router/dist/.../router/router.js: it is true when
 * revalidation is forced, when the URL is unchanged, or when the search params
 * changed. (The router also ORs in `isNewRouteInstance`, which is always false
 * for root — its matched pathname is "/" on every route.)
 *
 * `forced` covers the cases that set `isRevalidationRequired`: useRevalidator,
 * submissions, and — the one this suite is about — a loader-thrown redirect
 * whose response carries a Set-Cookie, which the server turns into
 * `X-Remix-Revalidate` for the client to replay.
 */
function navigation({
	from,
	to,
	forced = false,
	formAction,
}: {
	from: string
	to: string
	forced?: boolean
	formAction?: string
}) {
	const currentUrl = new URL(from, BASE_URL)
	const nextUrl = new URL(to, BASE_URL)
	return {
		currentUrl,
		nextUrl,
		formAction,
		defaultShouldRevalidate:
			forced ||
			currentUrl.pathname + currentUrl.search ===
				nextUrl.pathname + nextUrl.search ||
			currentUrl.search !== nextUrl.search,
	}
}

test('a lapsed-Pro redirect to /upgrade revalidates so the toast arrives with the user', () => {
	expect(
		shouldRevalidate(
			navigation({ from: '/recipes', to: '/upgrade', forced: true }),
		),
	).toBe(true)
})

test('a redirect away from a filtered list still carries its toast', () => {
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
	expect(
		shouldRevalidate(
			navigation({ from: '/inventory/new', to: '/inventory', forced: true }),
		),
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

test('an explicit same-URL revalidation re-runs the root loader', () => {
	expect(
		shouldRevalidate(navigation({ from: '/recipes', to: '/recipes' })),
	).toBe(true)
})

test('a form submission re-runs the root loader', () => {
	expect(
		shouldRevalidate(
			navigation({
				from: '/recipes/new',
				to: '/recipes/abc123',
				formAction: '/recipes/new',
			}),
		),
	).toBe(true)
})

test('leaving a filtered list re-runs the root loader', () => {
	// The router collapses "forced" and "search params changed" into one
	// boolean, so a navigation that changes both pathname and search is
	// indistinguishable from a forced one. We revalidate — the cost is one root
	// loader run, and the alternative is dropping toasts again.
	expect(
		shouldRevalidate(
			navigation({ from: '/recipes?cuisine=thai', to: '/recipes/abc123' }),
		),
	).toBe(true)
})
