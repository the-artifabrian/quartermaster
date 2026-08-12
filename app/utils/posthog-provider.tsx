import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react'
import { useLocation } from 'react-router'

export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com'

export function getPostHogHost(host?: string) {
	return host || DEFAULT_POSTHOG_HOST
}

type AnalyticsProperties = Record<string, unknown>

/** The small client interface used by the app and its test adapters. */
export type AnalyticsClient = {
	capture: (event: string, properties?: AnalyticsProperties) => void
	captureException: (error: unknown) => void
	identify: (userId: string, properties?: AnalyticsProperties) => void
	group: (groupType: string, groupId: string) => void
	reset: () => void
	getFeatureFlag: (key: string) => string | boolean | undefined
}

const noopClient: AnalyticsClient = {
	capture: () => undefined,
	captureException: () => undefined,
	identify: () => undefined,
	group: () => undefined,
	reset: () => undefined,
	getFeatureFlag: () => undefined,
}

type ClientBridge = {
	client: AnalyticsClient
	attach: (client: AnalyticsClient) => void
}

/**
 * Give callers a usable client before the SDK arrives. Mutations are queued for
 * the brief idle-loading window, so an early navigation/error/identify event is
 * not lost. Without an API key the no-op client avoids retaining a pointless
 * queue forever.
 */
function createClientBridge(enabled: boolean): ClientBridge {
	if (!enabled) return { client: noopClient, attach: () => undefined }

	let delegate: AnalyticsClient | undefined
	const pending: Array<(client: AnalyticsClient) => void> = []
	const run = (operation: (client: AnalyticsClient) => void) => {
		if (delegate) operation(delegate)
		else pending.push(operation)
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
			reset: () => run((client) => client.reset()),
			getFeatureFlag: (key) => delegate?.getFeatureFlag(key),
		},
		attach: (client) => {
			delegate = client
			for (const operation of pending.splice(0)) operation(client)
		},
	}
}

const PostHogContext = createContext({ client: noopClient, ready: false })

function scheduleWhenIdle(task: () => void) {
	if (typeof window.requestIdleCallback === 'function') {
		const handle = window.requestIdleCallback(task, { timeout: 2_000 })
		return () => window.cancelIdleCallback?.(handle)
	}

	const handle = window.setTimeout(task, 0)
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
					if (!cancelled) console.error('Failed to load analytics', error)
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
	const posthog = usePostHog()

	useEffect(() => {
		posthog.capture('$pageview', {
			$current_url: window.location.href,
		})
	}, [location.pathname, location.search, posthog])

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
