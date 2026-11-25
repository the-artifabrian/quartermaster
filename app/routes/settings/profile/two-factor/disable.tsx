import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useState } from 'react'
import { useFetcher } from 'react-router'
import { ConfirmSheet } from '#app/components/ui/confirm-sheet.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireRecentVerification } from '#app/routes/_auth/verify.server.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type SettingsPageHandle } from '../../profile/_layout.tsx'
import { type Route } from './+types/disable.ts'
import { twoFAVerificationType } from './_layout.tsx'

export const handle: SettingsPageHandle & SEOHandle = {
	pageTitle: 'Disable 2FA',
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireRecentVerification(request)
	return {}
}

export async function action({ request }: Route.ActionArgs) {
	await requireRecentVerification(request)
	const userId = await requireUserId(request)
	await prisma.verification.delete({
		where: { target_type: { target: userId, type: twoFAVerificationType } },
	})
	return redirectWithToast('/settings/profile/two-factor', {
		description: 'Two-factor authentication is off.',
	})
}

export default function TwoFactorDisableRoute() {
	const disable2FAFetcher = useFetcher<typeof action>()
	const [confirming, setConfirming] = useState(false)
	const pending = disable2FAFetcher.state !== 'idle'

	return (
		<div className="mx-auto max-w-sm">
			<disable2FAFetcher.Form method="POST" id="disable-2fa">
				<p>With 2FA off, anyone with your password can log in.</p>
				<StatusButton
					type="button"
					variant="destructive"
					className="mx-auto"
					status={pending ? 'pending' : 'idle'}
					onClick={() => setConfirming(true)}
				>
					Disable 2FA
				</StatusButton>
				<ConfirmSheet
					open={confirming}
					onCancel={() => setConfirming(false)}
					title="Disable two-factor authentication?"
					description="Logging in will need only your password."
					confirmLabel="Disable 2FA"
					formId="disable-2fa"
					name="intent"
					value="disable"
					pending={pending}
				/>
			</disable2FAFetcher.Form>
		</div>
	)
}
