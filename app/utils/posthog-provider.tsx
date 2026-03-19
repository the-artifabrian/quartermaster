import { usePostHog } from '@posthog/react'
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'

export { usePostHog } from '@posthog/react'

export function useFeatureFlag(key: string): string | boolean | undefined {
	const posthog = usePostHog()
	return posthog?.getFeatureFlag(key) ?? undefined
}

export function PostHogPageview() {
	const location = useLocation()
	const posthog = usePostHog()

	useEffect(() => {
		posthog?.capture('$pageview', {
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
		if (!posthog) return

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
