import { useEffect, useRef } from 'react'
import { useMatches, useNavigation } from 'react-router'
import { readDataTiming } from '#app/utils/nav-resource-timing.ts'
import { usePostHog } from '#app/utils/posthog-provider.tsx'
import { getCurrentRouteId } from '#app/utils/pwa-performance.ts'

/**
 * Measures real felt navigation latency from the user's device and reports it to
 * PostHog as `nav_duration_ms`. This is the single number to drive down: it's the
 * full time the user waits with the spinner showing (network + server + render),
 * captured per-route on the real (mobile) network.
 *
 * Each event is enriched with the destination route's single-fetch `.data` request
 * timing (see `nav-resource-timing.ts`) so felt latency can be attributed — in
 * aggregate, not just on one session replay — to its actual cause: cold connection
 * (`connect_ms` > 0), slow server (`ttfb_ms`), or a network vs cache response
 * (`transfer_size` === 0). So "p95 is 2s — why?" becomes a GROUP BY, not a guess.
 */
export function NavTiming() {
	const navigation = useNavigation()
	const currentRouteId = getCurrentRouteId(useMatches())
	const posthog = usePostHog()
	const startRef = useRef<number | null>(null)
	const fromRouteRef = useRef<string>('unknown')
	const toPathRef = useRef<string>('')

	useEffect(() => {
		if (navigation.state !== 'idle') {
			// Start at submission, not only when its loaders begin, so this remains the
			// full user-visible wait. Keep following the destination through redirects
			// or an interrupted navigation while preserving the original start/route.
			if (startRef.current == null) {
				startRef.current = performance.now()
				fromRouteRef.current = currentRouteId
			}
			toPathRef.current = navigation.location?.pathname ?? ''
		} else if (startRef.current != null) {
			const navStart = startRef.current
			const duration = performance.now() - navStart
			startRef.current = null
			const connection = (
				navigator as unknown as {
					connection?: { effectiveType?: string; rtt?: number }
				}
			).connection
			posthog.capture('nav_duration_ms', {
				duration_ms: Math.round(duration),
				from_route: fromRouteRef.current,
				to_route: currentRouteId,
				effective_type: connection?.effectiveType,
				rtt: connection?.rtt,
				// Resource-timing breakdown of the `.data` fetch (omitted when the nav did
				// no network): tells us cold-connection vs server vs cache-hit per event.
				...readDataTiming(navStart, toPathRef.current),
			})
		}
	}, [navigation.state, navigation.location, currentRouteId, posthog])

	return null
}
