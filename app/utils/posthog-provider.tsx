import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react'
import { useLocation, useMatches } from 'react-router'
import { getPostHogHost } from './posthog-config.ts'
import {
	PWA_LAUNCHED,
	PWA_RESUMED,
	PWA_UPDATE_COMPLETED,
} from './posthog-events.ts'
import {
	getCurrentRouteId,
	getPwaSessionContext,
	getServiceWorkerContext,
} from './pwa-performance.ts'
import { takeCompletedPwaUpdate } from './pwa-update-telemetry.ts'

type AnalyticsProperties = Record<string, unknown>

/** The small client interface used by the app and its test adapters. */
export type AnalyticsClient = {
	capture: (event: string, properties?: AnalyticsProperties) => void
	captureException: (error: unknown) => void
	identify: (userId: string, properties?: AnalyticsProperties) => void
	group: (groupType: string, groupId: string) => void
	registerForSession: (properties: AnalyticsProperties) => void
	reset: () => void
	getFeatureFlag: (key: string) => string | boolean | undefined
}

const noopClient: AnalyticsClient = {
	capture: () => undefined,
	captureException: () => undefined,
	identify: () => undefined,
	group: () => undefined,
	registerForSession: () => undefined,
	reset: () => undefined,
	getFeatureFlag: () => undefined,
}

type ClientBridge = {
	client: AnalyticsClient
	attach: (client: AnalyticsClient) => void
	disable: () => void
}

/**
 * Give callers a usable client before the SDK arrives. Mutations are queued for
 * the brief idle-loading window, so an early navigation/error/identify event is
 * not lost. SDK-owned autocapture cannot observe interactions before the idle
 * import and intentionally drops that short window to protect hydration.
 * Without an API key, or after a failed import, the no-op path avoids retaining
 * a pointless queue.
 */
function createClientBridge(enabled: boolean): ClientBridge {
	if (!enabled) {
		return {
			client: noopClient,
			attach: () => undefined,
			disable: () => undefined,
		}
	}

	let delegate: AnalyticsClient | undefined
	let acceptingEvents = true
	const pending: Array<(client: AnalyticsClient) => void> = []
	const run = (operation: (client: AnalyticsClient) => void) => {
		if (delegate) operation(delegate)
		else if (acceptingEvents) pending.push(operation)
	}

	return {
		client: {
			capture: (event, properties) =>
				run((client) => client.capture(event, properties)),
			captureException: (error) =>
				run((client) => client.captureException(error)),
			identify: (userId, properties) =>
				run((client) => client.identify(userId, properties)),
			group: (groupType, groupId) =>
				run((client) => client.group(groupType, groupId)),
			registerForSession: (properties) =>
				run((client) => client.registerForSession(properties)),
			reset: () => run((client) => client.reset()),
			getFeatureFlag: (key) => delegate?.getFeatureFlag(key),
		},
		attach: (client) => {
			if (!acceptingEvents) return
			delegate = client
			acceptingEvents = false
			for (const operation of pending.splice(0)) operation(client)
		},
		disable: () => {
			delegate = undefined
			acceptingEvents = false
			pending.length = 0
		},
	}
}

const PostHogContext = createContext({ client: noopClient, ready: false })

function scheduleWhenIdle(task: () => void) {
	if (typeof window.requestIdleCallback === 'function') {
		const handle = window.requestIdleCallback(task, { timeout: 2_000 })
		return () => window.cancelIdleCallback?.(handle)
	}

	// Safari historically lacks requestIdleCallback. Keep the SDK off the task
	// immediately following hydration while bounding the queued-event window.
	const handle = window.setTimeout(task, 1_000)
	return () => window.clearTimeout(handle)
}

export function PostHogProvider({ children }: { children: ReactNode }) {
	const apiKey = window.ENV.POSTHOG_API_KEY
	const bridgeRef = useRef<ClientBridge | null>(null)
	if (!bridgeRef.current)
		bridgeRef.current = createClientBridge(Boolean(apiKey))
	const bridge = bridgeRef.current
	const [ready, setReady] = useState(false)

	useEffect(() => {
		if (!apiKey) return

		let cancelled = false
		const cancelScheduledLoad = scheduleWhenIdle(() => {
			void import('./posthog.client.ts')
				.then(({ initializePostHog }) => {
					if (cancelled) return
					const client = initializePostHog({
						apiKey,
						host: getPostHogHost(window.ENV.POSTHOG_HOST),
					})
					if (cancelled) return
					bridge.attach(client)
					setReady(true)
				})
				.catch((error: unknown) => {
					if (!cancelled) {
						bridge.disable()
						console.error('Failed to load analytics', error)
					}
				})
		})

		return () => {
			cancelled = true
			cancelScheduledLoad()
		}
	}, [apiKey, bridge])

	const value = useMemo(
		() => ({ client: bridge.client, ready }),
		[bridge, ready],
	)
	return (
		<PostHogContext.Provider value={value}>{children}</PostHogContext.Provider>
	)
}

export function usePostHog(): AnalyticsClient {
	return useContext(PostHogContext).client
}

export function useFeatureFlag(key: string): string | boolean | undefined {
	const { client, ready } = useContext(PostHogContext)
	return ready ? client.getFeatureFlag(key) : undefined
}

export function PostHogPageview() {
	const location = useLocation()
	const routeId = getCurrentRouteId(useMatches())
	const posthog = usePostHog()
	const initialRouteRef = useRef(routeId)
	const initialContextRef = useRef<ReturnType<
		typeof getPwaSessionContext
	> | null>(null)
	const didCaptureLaunchRef = useRef(false)

	useEffect(() => {
		initialContextRef.current ??= getPwaSessionContext({
			appBuild: window.ENV.APP_BUILD,
			initialRoute: initialRouteRef.current,
		})
		const sessionContext = initialContextRef.current
		// Register before capture so PostHog's built-in Web Vitals inherit the
		// same release/install context. Re-registering also restores it after a
		// logout reset without changing the initial-route snapshot.
		posthog.registerForSession(sessionContext)
		if (!didCaptureLaunchRef.current) {
			didCaptureLaunchRef.current = true
			if (sessionContext.display_mode === 'standalone') {
				posthog.capture(PWA_LAUNCHED, sessionContext)
			}
			const completedUpdate = takeCompletedPwaUpdate({
				toBuild: sessionContext.app_build,
			})
			if (completedUpdate) {
				posthog.capture(PWA_UPDATE_COMPLETED, completedUpdate)
			}
		}
		posthog.capture('$pageview', {
			$current_url: window.location.href,
			route_id: routeId,
		})
	}, [location.pathname, location.search, posthog, routeId])

	return null
}

export const PWA_RESUME_THRESHOLD_MS = 30_000

/** Distinguish a warm foreground resume from a new document launch. */
export function PostHogPwaLifecycle() {
	const posthog = usePostHog()
	const routeId = getCurrentRouteId(useMatches())
	const routeIdRef = useRef(routeId)
	routeIdRef.current = routeId
	const hiddenAtRef = useRef<number | null>(null)

	useEffect(() => {
		const onVisibilityChange = () => {
			if (document.visibilityState === 'hidden') {
				hiddenAtRef.current = Date.now()
				return
			}
			if (document.visibilityState !== 'visible') return

			const hiddenAt = hiddenAtRef.current
			hiddenAtRef.current = null
			if (hiddenAt == null) return
			const backgroundDuration = Date.now() - hiddenAt
			if (backgroundDuration < PWA_RESUME_THRESHOLD_MS) return

			posthog.capture(PWA_RESUMED, {
				background_duration_ms: backgroundDuration,
				route_id: routeIdRef.current,
				...getServiceWorkerContext(),
			})
		}

		document.addEventListener('visibilitychange', onVisibilityChange)
		return () =>
			document.removeEventListener('visibilitychange', onVisibilityChange)
	}, [posthog])

	return null
}

export function PostHogIdentify({
	user,
	householdId,
}: {
	user: { id: string; name: string | null; username: string } | null
	householdId: string | null
}) {
	const posthog = usePostHog()
	const prevUserIdRef = useRef<string | null>(null)

	useEffect(() => {
		const currentUserId = user?.id ?? null

		if (currentUserId && currentUserId !== prevUserIdRef.current) {
			posthog.identify(currentUserId, {
				name: user!.name,
				username: user!.username,
			})
			if (householdId) {
				posthog.group('household', householdId)
			}
		} else if (!currentUserId && prevUserIdRef.current) {
			posthog.reset()
		}

		prevUserIdRef.current = currentUserId
	}, [posthog, user, householdId])

	return null
}
