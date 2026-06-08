import { useEffect, useRef } from 'react'
import { useLocation, useNavigation } from 'react-router'
import { usePostHog } from '#app/utils/posthog-provider.tsx'

/**
 * Measures real felt navigation latency from the user's device and reports it to
 * PostHog as `nav_duration_ms`. This is the single number to drive down: it's the
 * full time the user waits with the spinner showing (network + server + render),
 * captured per-route on the real (mobile) network.
 *
 * Pair it with the per-loader Server-Timing headers to split felt time into
 * network vs server: if nav_duration_ms p95 is ~3s but Server-Timing is ~200ms,
 * the rest is network/connection (→ SWR/connection fixes, not query work).
 */
export function NavTiming() {
	const navigation = useNavigation()
	const location = useLocation()
	const posthog = usePostHog()
	const startRef = useRef<number | null>(null)
	const fromRef = useRef<string>('')
	const toRef = useRef<string>('')

	useEffect(() => {
		if (navigation.state === 'loading') {
			// Capture the start of a navigation once (ignore loading→loading churn).
			if (startRef.current == null) {
				startRef.current = performance.now()
				fromRef.current = location.pathname
				toRef.current = navigation.location?.pathname ?? ''
			}
		} else if (navigation.state === 'idle' && startRef.current != null) {
			const duration = performance.now() - startRef.current
			startRef.current = null
			const connection = (
				navigator as unknown as {
					connection?: { effectiveType?: string; rtt?: number }
				}
			).connection
			posthog?.capture('nav_duration_ms', {
				duration_ms: Math.round(duration),
				from: fromRef.current,
				to: toRef.current,
				effective_type: connection?.effectiveType,
				rtt: connection?.rtt,
			})
		}
	}, [navigation.state, navigation.location, location.pathname, posthog])

	return null
}
