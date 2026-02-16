import { useRouteLoaderData } from 'react-router'
import { type loader as rootLoader } from '#app/root.tsx'

export function useSubscriptionTier() {
	const data = useRouteLoaderData<typeof rootLoader>('root')
	return data?.tierInfo ?? null
}

export function useIsProActive() {
	const tierInfo = useSubscriptionTier()
	return tierInfo?.isProActive ?? false
}

export function useAvailableInviteCodeCount() {
	const data = useRouteLoaderData<typeof rootLoader>('root')
	return data?.availableInviteCodeCount ?? 0
}
