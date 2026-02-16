import { z } from 'zod'

/**
 * Zod schema for validating invite code input format.
 * Used by the redemption resource route and the upgrade page form.
 */
export const RedeemCodeSchema = z.object({
	code: z
		.string()
		.min(1, 'Please enter an invite code')
		.regex(
			/^QM-[A-Za-z0-9]{6}$/i,
			'Invalid code format (expected QM-XXXXXX)',
		),
})

/**
 * Determines the display status (label + badge styles) for an invite code.
 * Shared between the user invite codes page and admin subscriptions page.
 */
export function getCodeStatus(code: {
	redeemedAt: string | Date | null
	expiresAt: string | Date | null
}): { label: string; className: string } {
	if (code.redeemedAt) {
		return {
			label: 'Redeemed',
			className:
				'border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950/30 dark:text-green-400',
		}
	}
	if (code.expiresAt && new Date(code.expiresAt) < new Date()) {
		return {
			label: 'Expired',
			className:
				'border-gray-300 bg-gray-50 text-gray-500 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
		}
	}
	return {
		label: 'Available',
		className:
			'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-400',
	}
}
