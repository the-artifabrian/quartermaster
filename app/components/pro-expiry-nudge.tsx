import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useIsNativeShell } from '#app/utils/request-info.ts'
import { useSubscriptionTier } from '#app/utils/subscription.ts'

export function ProExpiryNudge() {
	const tierInfo = useSubscriptionTier()
	const navigate = useNavigate()
	// The iOS app shows no copy about Pro and may not point at buying it (ADR
	// 0001), so there the notice names the features that end, not the tier,
	// and has no Subscribe copy or Upgrade button.
	const isNativeShell = useIsNativeShell()

	useEffect(() => {
		if (!tierInfo?.isProActive || tierInfo.daysUntilExpiry === null) return

		const days = tierInfo.daysUntilExpiry
		const expiresAtIso = tierInfo.proExpiresAt
			? new Date(tierInfo.proExpiresAt).toISOString().split('T')[0]
			: 'unknown'
		const shellNotice = `Voice input and AI import end in ${days} day${days === 1 ? '' : 's'}`

		if (days <= 3 && days > 0) {
			const key = `pro-expiry-3d:${expiresAtIso}`
			if (!localStorage.getItem(key)) {
				localStorage.setItem(key, '1')
				if (isNativeShell) {
					toast.warning(shellNotice, { duration: 10000 })
				} else {
					toast.warning(
						`Your Pro access expires in ${days} day${days === 1 ? '' : 's'}`,
						{
							description: 'Subscribe to keep Pro features.',
							duration: 10000,
							action: {
								label: 'Upgrade',
								onClick: () => navigate('/upgrade'),
							},
						},
					)
				}
			}
		} else if (days <= 7 && days > 3) {
			const key = `pro-expiry-7d:${expiresAtIso}`
			if (!localStorage.getItem(key)) {
				localStorage.setItem(key, '1')
				if (isNativeShell) {
					toast.info(shellNotice, { duration: 8000 })
				} else {
					toast.info(`Pro access expires in ${days} days`, {
						description: 'Subscribe to continue.',
						duration: 8000,
						action: {
							label: 'Upgrade',
							onClick: () => navigate('/upgrade'),
						},
					})
				}
			}
		}
	}, [tierInfo, navigate, isNativeShell])

	return null
}
