import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useSubscriptionTier } from '#app/utils/subscription.ts'

export function ProExpiryNudge() {
	const tierInfo = useSubscriptionTier()
	const navigate = useNavigate()

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
						description: 'Subscribe or redeem a new code to keep Pro features.',
						duration: 10000,
						action: {
							label: 'Upgrade',
							onClick: () => navigate('/upgrade'),
						},
					},
				)
			}
		} else if (tierInfo.daysUntilExpiry <= 7 && tierInfo.daysUntilExpiry > 3) {
			const key = `pro-expiry-7d:${expiresAtIso}`
			if (!localStorage.getItem(key)) {
				localStorage.setItem(key, '1')
				toast.info(
					`Pro access expires in ${tierInfo.daysUntilExpiry} days`,
					{
						description:
							'Subscribe or redeem a new invite code to continue.',
						duration: 8000,
						action: {
							label: 'Upgrade',
							onClick: () => navigate('/upgrade'),
						},
					},
				)
			}
		}
	}, [tierInfo, navigate])

	return null
}
