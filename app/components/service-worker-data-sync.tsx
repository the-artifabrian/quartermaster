import { useEffect, useRef } from 'react'
import { useFetchers, useNavigation } from 'react-router'

function postToServiceWorker(message: Record<string, unknown>) {
	if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
	const controller = navigator.serviceWorker.controller
	if (controller) {
		controller.postMessage(message)
		return
	}
	// No controller yet (first load before the SW takes control, or the brief
	// window right after an update swaps controllers). Don't drop the message —
	// the session-isolation purges (logout / household switch) depend on it being
	// delivered, otherwise a previous session's cached shell can linger on a
	// shared device. Post to the active registration instead, which receives
	// messages even when it isn't yet controlling this page. The controllerchange
	// handler still re-sends as a backstop; the SW message handler is idempotent.
	void navigator.serviceWorker.ready
		.then((registration) => {
			registration.active?.postMessage(message)
		})
		.catch(() => {})
}

/**
 * Whether an in-flight submission (from useNavigation or a fetcher) should drop
 * the per-session `.data` cache when it finishes. True for any non-GET submission
 * EXCEPT one targeting /shopping — see the isMutating comment below. A set, non-GET
 * formMethod is what marks a submission as in flight (it clears on idle).
 */
function invalidatesDataCache(
	formMethod: string | undefined,
	formAction: string | undefined,
): boolean {
	if (formMethod == null || formMethod === 'GET') return false
	// formAction is a root-relative path (e.g. "/shopping" or "/shopping?index").
	const pathname = formAction?.split(/[?#]/)[0]
	if (pathname === '/shopping') return false
	return true
}

/**
 * Bridges the authenticated session identity to the service worker so it can
 * namespace its `.data` cache per user+household — preventing one household's
 * cached data from ever being served to another on a shared device — and tells
 * it when to drop that cache (logout / session switch / after a mutation).
 *
 * Renders nothing; all work happens in client-only effects. The SW treats an
 * unknown namespace as network-only, so a missed message can degrade the cache
 * benefit but never leak data.
 */
export function ServiceWorkerDataSync({
	userId,
	householdId,
}: {
	userId: string | null
	householdId: string | null
}) {
	const token = userId && householdId ? `${userId}-${householdId}` : null
	const tokenRef = useRef(token)
	tokenRef.current = token

	// Keep the SW's cache namespace in sync with the current session. Re-send on
	// SW controllerchange and on app-resume (visibilitychange): the SW may have
	// been terminated while the PWA was backgrounded — the exact slow-nav case.
	useEffect(() => {
		const sync = () => {
			const current = tokenRef.current
			if (current) {
				postToServiceWorker({ type: 'qm-data-session', token: current })
			} else {
				postToServiceWorker({ type: 'qm-data-purge' })
			}
		}
		sync()
		const onVisibility = () => {
			if (document.visibilityState === 'visible') sync()
		}
		document.addEventListener('visibilitychange', onVisibility)
		navigator.serviceWorker?.addEventListener('controllerchange', sync)
		return () => {
			document.removeEventListener('visibilitychange', onVisibility)
			navigator.serviceWorker?.removeEventListener('controllerchange', sync)
		}
	}, [token])

	// After the user's own mutations, drop the cached `.data` so a later
	// navigation never shows stale-after-write. Coarse (the whole session
	// namespace); the next navigation refills from the network.
	//
	// Shopping mutations are deliberately excluded: the next Shopping read is
	// network-first, and clearing the whole namespace on every checkbox tap would
	// needlessly evict unrelated offline fallbacks. Other mutations may affect
	// several screens, so they retain the existing coarse invalidation.
	const navigation = useNavigation()
	const fetchers = useFetchers()
	const isMutating =
		invalidatesDataCache(navigation.formMethod, navigation.formAction) ||
		fetchers.some((f) => invalidatesDataCache(f.formMethod, f.formAction))
	const wasMutating = useRef(false)
	useEffect(() => {
		if (wasMutating.current && !isMutating) {
			postToServiceWorker({ type: 'qm-data-invalidate' })
		}
		wasMutating.current = isMutating
	}, [isMutating])

	return null
}
