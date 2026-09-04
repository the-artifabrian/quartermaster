import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from 'react'
import { useMatches, useNavigation } from 'react-router'
import { readDataTiming } from '#app/utils/nav-resource-timing.ts'
import { usePostHog } from '#app/utils/posthog-provider.tsx'
import { getCurrentRouteId } from '#app/utils/pwa-performance.ts'

export type BottomNavDestination = 'recipes' | 'staples' | 'plan' | 'shop'

export type BottomNavInput = {
	destination: BottomNavDestination
	destinationPath: string
	tabPath: string
	startedAt: number
}

type BottomNavTimingContextValue = {
	begin(input: BottomNavInput): void
	cancel(startedAt: number): void
}

const BottomNavTimingContext = createContext<BottomNavTimingContextValue>({
	begin: () => {},
	cancel: () => {},
})

export function useBottomNavTiming() {
	return useContext(BottomNavTimingContext)
}

function pathnameOnly(path: string) {
	return path.split(/[?#]/, 1)[0] ?? path
}

function isInTab(path: string, tabPath: string) {
	return path === tabPath || path.startsWith(`${tabPath}/`)
}

/**
 * Measures real felt navigation latency from the user's device and reports it to
 * PostHog as `nav_duration_ms`. This is the single number to drive down: it's the
 * full Router in-flight time the user waits through (network + server + render),
 * captured per-route on the real (mobile) network.
 *
 * Each event is enriched with the destination route's single-fetch `.data` request
 * timing (see `nav-resource-timing.ts`) so felt latency can be attributed — in
 * aggregate, not just on one session replay — to its actual cause: cold connection
 * (`connect_ms` > 0), slow server (`ttfb_ms`), or a network vs cache response
 * (`transfer_size` === 0). So "p95 is 2s — why?" becomes a GROUP BY, not a guess.
 * BottomNav adds input-to-idle time to this same event so its pointer/key interval
 * is visible without changing the established duration_ms definition.
 */
export function NavTiming({ children }: { children?: ReactNode }) {
	const navigation = useNavigation()
	const currentRouteId = getCurrentRouteId(useMatches())
	const posthog = usePostHog()
	const startRef = useRef<number | null>(null)
	const fromRouteRef = useRef<string>('unknown')
	const toPathRef = useRef<string>('')
	const pendingBottomNavInputRef = useRef<BottomNavInput | null>(null)
	const activeBottomNavInputRef = useRef<BottomNavInput | null>(null)

	const begin = useCallback((input: BottomNavInput) => {
		pendingBottomNavInputRef.current = input
	}, [])
	const cancel = useCallback((startedAt: number) => {
		if (pendingBottomNavInputRef.current?.startedAt === startedAt) {
			pendingBottomNavInputRef.current = null
		}
	}, [])
	const timingContext = useMemo(() => ({ begin, cancel }), [begin, cancel])

	useEffect(() => {
		if (navigation.state !== 'idle') {
			const destinationPath = navigation.location?.pathname ?? ''
			// Start at submission, not only when its loaders begin, so this remains the
			// full user-visible wait. Keep following the destination through redirects
			// or an interrupted navigation while preserving the original start/route.
			if (startRef.current == null) {
				startRef.current = performance.now()
				fromRouteRef.current = currentRouteId
			}

			const pendingInput = pendingBottomNavInputRef.current
			if (
				pendingInput &&
				pathnameOnly(pendingInput.destinationPath) === destinationPath
			) {
				activeBottomNavInputRef.current = pendingInput
				pendingBottomNavInputRef.current = null
			} else if (
				destinationPath !== toPathRef.current &&
				activeBottomNavInputRef.current &&
				!isInTab(destinationPath, activeBottomNavInputRef.current.tabPath)
			) {
				// A different navigation interrupted the tab change. Preserve the original
				// nav_duration_ms clock, but do not misattribute its final destination to
				// BottomNav.
				activeBottomNavInputRef.current = null
			}
			toPathRef.current = destinationPath
		} else if (startRef.current != null) {
			const navStart = startRef.current
			const idleAt = performance.now()
			const duration = idleAt - navStart
			const bottomNavInput = activeBottomNavInputRef.current
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
				...(bottomNavInput
					? {
							navigation_source: 'bottom_nav',
							destination_tab: bottomNavInput.destination,
							input_to_idle_ms: Math.round(idleAt - bottomNavInput.startedAt),
						}
					: {}),
				// Resource-timing breakdown of the `.data` fetch (omitted when the nav did
				// no network): tells us cold-connection vs server vs cache-hit per event.
				...readDataTiming(navStart, toPathRef.current),
			})
			activeBottomNavInputRef.current = null
			pendingBottomNavInputRef.current = null
			toPathRef.current = ''
		}
	}, [navigation.state, navigation.location, currentRouteId, posthog])

	return (
		<BottomNavTimingContext.Provider value={timingContext}>
			{children}
		</BottomNavTimingContext.Provider>
	)
}
