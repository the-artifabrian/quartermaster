import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { redirect, useFetcher } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { generateTOTP } from '#app/utils/totp.server.ts'
import { type SettingsPageHandle } from '../../profile/_layout.tsx'
import { type Route } from './+types/index.ts'
import { twoFAVerificationType } from './_layout.tsx'
import { twoFAVerifyVerificationType } from './verify.tsx'
import { PushLink } from '#app/components/push-link.tsx'

export const handle: SettingsPageHandle & SEOHandle = {
	pageTitle: 'Two-factor auth',
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const verification = await prisma.verification.findUnique({
		where: { target_type: { type: twoFAVerificationType, target: userId } },
		select: { id: true },
	})
	return { is2FAEnabled: Boolean(verification) }
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const { otp: _otp, ...config } = await generateTOTP()
	const verificationData = {
		...config,
		type: twoFAVerifyVerificationType,
		target: userId,
	}
	await prisma.verification.upsert({
		where: {
			target_type: { target: userId, type: twoFAVerifyVerificationType },
		},
		create: verificationData,
		update: verificationData,
	})
	return redirect('/settings/profile/two-factor/verify')
}

export default function TwoFactorRoute({ loaderData }: Route.ComponentProps) {
	const enable2FAFetcher = useFetcher<typeof action>()

	return (
		<div className="flex flex-col gap-4">
			{loaderData.is2FAEnabled ? (
				<>
					<p className="text-lg">
						<Icon name="check">Two-factor authentication is on.</Icon>
					</p>
					<PushLink to="disable">
						<Icon name="lock-open-1">Disable 2FA</Icon>
					</PushLink>
				</>
			) : (
				<>
					<p>
						<Icon name="lock-open-1">Two-factor authentication is off.</Icon>
					</p>
					<p className="text-sm">
						With it on, logging in also asks for a code from an authenticator
						app such as{' '}
						<a className="underline" href="https://1password.com/">
							1Password
						</a>
						.
					</p>
					<enable2FAFetcher.Form method="POST">
						<StatusButton
							type="submit"
							name="intent"
							value="enable"
							status={enable2FAFetcher.state === 'loading' ? 'pending' : 'idle'}
							className="mx-auto"
						>
							Enable 2FA
						</StatusButton>
					</enable2FAFetcher.Form>
				</>
			)}
		</div>
	)
}
