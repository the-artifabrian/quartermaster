import { z } from 'zod'

/**
 * Zod schema for validating invite code input format.
 * Used by the redemption resource route and the upgrade page form.
 */
export const RedeemCodeSchema = z.object({
	code: z
		.string()
		.min(1, 'Please enter an invite code')
		.regex(/^QM-[A-Za-z0-9]{6}$/i, 'Invalid code format (expected QM-XXXXXX)'),
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
				'border-primary/30 bg-primary/10 text-primary',
		}
	}
	if (code.expiresAt && new Date(code.expiresAt) < new Date()) {
		return {
			label: 'Expired',
			className:
				'border-muted-foreground/30 bg-muted text-muted-foreground',
		}
	}
	return {
		label: 'Available',
		className:
			'border-accent/30 bg-accent/10 text-accent-foreground dark:text-foreground',
	}
}
