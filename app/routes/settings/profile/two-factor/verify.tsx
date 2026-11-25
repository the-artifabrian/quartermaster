import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import * as QRCode from 'qrcode'
import { data, redirect, Form, useNavigation } from 'react-router'
import { z } from 'zod'
import { ErrorList, OTPField } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { isCodeValid } from '#app/routes/_auth/verify.server.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { getAppOrigin } from '#app/utils/app-origin.server.ts'
import { useIsPending } from '#app/utils/misc.tsx'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { getTOTPAuthUri } from '#app/utils/totp.server.ts'
import { type SettingsPageHandle } from '../../profile/_layout.tsx'
import { type Route } from './+types/verify.ts'
import { twoFAVerificationType } from './_layout.tsx'

export const handle: SettingsPageHandle & SEOHandle = {
	pageTitle: 'Verify 2FA',
	getSitemapEntries: () => null,
}

const CancelSchema = z.object({ intent: z.literal('cancel') })
const VerifySchema = z.object({
	intent: z.literal('verify'),
	code: z.string().min(6).max(6),
})

const ActionSchema = z.discriminatedUnion('intent', [
	CancelSchema,
	VerifySchema,
])

export const twoFAVerifyVerificationType = '2fa-verify'

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const verification = await prisma.verification.findUnique({
		where: {
			target_type: { type: twoFAVerifyVerificationType, target: userId },
		},
		select: {
			id: true,
			algorithm: true,
			secret: true,
			period: true,
			digits: true,
		},
	})
	if (!verification) {
		return redirect('/settings/profile/two-factor')
	}
	const user = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: { email: true },
	})
	const issuer = new URL(getAppOrigin()).host
	const otpUri = getTOTPAuthUri({
		...verification,
		accountName: user.email,
		issuer,
	})
	const qrCode = await QRCode.toDataURL(otpUri)
	return { otpUri, qrCode }
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()

	const submission = await parseWithZod(formData, {
		schema: () =>
			ActionSchema.superRefine(async (data, ctx) => {
				if (data.intent === 'cancel') return
				const codeIsValid = await isCodeValid({
					code: data.code,
					type: twoFAVerifyVerificationType,
					target: userId,
				})
				if (!codeIsValid) {
					ctx.addIssue({
						path: ['code'],
						code: z.ZodIssueCode.custom,
						message: `Invalid code`,
					})
					return z.NEVER
				}
			}),
		async: true,
	})

	if (submission.status !== 'success') {
		return data(
			{ result: submission.reply() },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}

	switch (submission.value.intent) {
		case 'cancel': {
			await prisma.verification.deleteMany({
				where: { type: twoFAVerifyVerificationType, target: userId },
			})
			return redirect('/settings/profile/two-factor')
		}
		case 'verify': {
			await prisma.verification.update({
				where: {
					target_type: { type: twoFAVerifyVerificationType, target: userId },
				},
				data: { type: twoFAVerificationType },
			})
			return redirectWithToast('/settings/profile/two-factor', {
				type: 'success',
				description: 'Two-factor authentication is on.',
			})
		}
	}
}

export default function TwoFactorRoute({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const navigation = useNavigation()

	const isPending = useIsPending()
	const pendingIntent = isPending ? navigation.formData?.get('intent') : null

	const [form, fields] = useForm({
		id: 'verify-form',
		constraint: getZodConstraint(ActionSchema),
		lastResult: actionData?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: ActionSchema })
		},
	})
	const lastSubmissionIntent = fields.intent.value

	return (
		<div>
			<div className="flex flex-col items-center gap-4">
				{/* ph-no-capture keeps the secret out of PostHog's click events,
				which record the clicked element's text and attributes. */}
				<img
					alt="qr code"
					src={loaderData.qrCode}
					className="ph-no-capture size-56"
				/>
				<p>Scan this QR code with your authenticator app.</p>
				<p className="text-sm">
					If you can&apos;t scan it, add this to the app by hand instead:
				</p>
				<div className="p-3">
					<pre
						className="ph-no-capture text-sm break-all whitespace-pre-wrap"
						aria-label="One-time Password URI"
					>
						{loaderData.otpUri}
					</pre>
				</div>
				<p className="text-sm">
					Then enter the code the app shows. From now on, logging in asks for a
					code too. If you lose the app, you lose access to your account.
				</p>
				<div className="flex w-full max-w-xs flex-col justify-center gap-4">
					<Form method="POST" {...getFormProps(form)} className="flex-1">
						<div className="flex items-center justify-center">
							<OTPField
								labelProps={{
									htmlFor: fields.code.id,
									children: 'Code',
								}}
								inputProps={{
									...getInputProps(fields.code, { type: 'text' }),
									autoFocus: true,
									autoComplete: 'one-time-code',
									inputMode: 'numeric',
								}}
								errors={fields.code.errors}
							/>
						</div>

						<div className="min-h-[36px] px-4 pt-1 pb-3">
							<ErrorList id={form.errorId} errors={form.errors} />
						</div>

						<div className="flex justify-between gap-4">
							<StatusButton
								className="w-full"
								status={
									pendingIntent === 'verify'
										? 'pending'
										: lastSubmissionIntent === 'verify'
											? (form.status ?? 'idle')
											: 'idle'
								}
								type="submit"
								name="intent"
								value="verify"
							>
								Submit
							</StatusButton>
							<StatusButton
								className="w-full"
								variant="secondary"
								status={
									pendingIntent === 'cancel'
										? 'pending'
										: lastSubmissionIntent === 'cancel'
											? (form.status ?? 'idle')
											: 'idle'
								}
								type="submit"
								name="intent"
								value="cancel"
								disabled={isPending}
							>
								Cancel
							</StatusButton>
						</div>
					</Form>
				</div>
			</div>
		</div>
	)
}
