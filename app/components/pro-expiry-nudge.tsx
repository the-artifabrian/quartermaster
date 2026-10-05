import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useIsNativeShell } from '#app/utils/request-info.ts'
import { useSubscriptionTier } from '#app/utils/subscription.ts'

export function ProExpiryNudge() {
	const tierInfo = useSubscriptionTier()
	const navigate = useNavigate()
	// The iOS app may not point at buying Pro (ADR 0001), so there the notice
	// keeps its title and loses the Subscribe copy and the Upgrade button.
	const isNativeShell = useIsNativeShell()

	useEffect(() => {
		if (!tierInfo?.isProActive || tierInfo.daysUntilExpiry === null) return

		const expiresAtIso = tierInfo.proExpiresAt
			? new Date(tierInfo.proExpiresAt).toISOString().split('T')[0]
			: 'unknown'

		if (tierInfo.daysUntilExpiry <= 3 && tierInfo.daysUntilExpiry > 0) {
			const key = `pro-expiry-3d:${expiresAtIso}`
			if (!localStorage.getItem(key)) {
				localStorage.setItem(key, '1')
				toast.warning(
					`Your Pro access expires in ${tierInfo.daysUntilExpiry} day${tierInfo.daysUntilExpiry === 1 ? '' : 's'}`,
					{
						duration: 10000,
						...(isNativeShell
							? {}
							: {
									description: 'Subscribe to keep Pro features.',
									action: {
										label: 'Upgrade',
										onClick: () => navigate('/upgrade'),
									},
								}),
					},
				)
			}
		} else if (tierInfo.daysUntilExpiry <= 7 && tierInfo.daysUntilExpiry > 3) {
			const key = `pro-expiry-7d:${expiresAtIso}`
			if (!localStorage.getItem(key)) {
				localStorage.setItem(key, '1')
				toast.info(`Pro access expires in ${tierInfo.daysUntilExpiry} days`, {
					duration: 8000,
					...(isNativeShell
						? {}
						: {
								description: 'Subscribe to continue.',
								action: {
									label: 'Upgrade',
									onClick: () => navigate('/upgrade'),
								},
							}),
				})
			}
		}
	}, [tierInfo, navigate, isNativeShell])

	return null
}
