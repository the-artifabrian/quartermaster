import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, redirect, Form, Link } from 'react-router'
import { z } from 'zod'
import { ErrorList, Field } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import {
	NO_NEW_EMAIL_TOAST,
	prepareVerification,
	requireRecentVerification,
} from '#app/routes/_auth/verify.server.ts'
import { requireUserId, verifyUserPassword } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { MAX_LIVE_EMAIL_CODES } from '#app/utils/email-code.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { pagePathOf } from '#app/utils/page-path.ts'
import { useIsPending } from '#app/utils/misc.tsx'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { EmailSchema } from '#app/utils/user-validation.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { type Route } from './+types/change-email.ts'
import { type SettingsPageHandle } from './_layout.tsx'
import { EmailChangeEmail } from './change-email.server.tsx'

export const handle: SettingsPageHandle & SEOHandle = {
	pageTitle: 'Change Email',
	getSitemapEntries: () => null,
}

export const newEmailAddressSessionKey = 'new-email-address'

const ChangeEmailSchema = z.object({
	email: EmailSchema,
	password: z.string({ error: 'Enter your current password' }),
})

export async function loader({ request }: Route.LoaderArgs) {
	await requireRecentVerification(request)
	const userId = await requireUserId(request)
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { email: true, password: { select: { userId: true } } },
	})
	if (!user) {
		const params = new URLSearchParams({
			redirectTo: pagePathOf(new URL(request.url)),
		})
		throw redirect(`/login?${params}`)
	}
	return { user: { email: user.email }, hasPassword: Boolean(user.password) }
}

export async function action({ request }: Route.ActionArgs) {
	await requireRecentVerification(request)
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const submission = await parseWithZod(formData, {
		schema: ChangeEmailSchema.superRefine(async (data, ctx) => {
			// The password comes first, so without it the answer says nothing
			// about the address. An account with no password can't pass.
			if (!(await verifyUserPassword({ id: userId }, data.password))) {
				ctx.addIssue({
					path: ['password'],
					code: 'custom',
					message: 'Incorrect password.',
				})
				return
			}
			const existingUser = await prisma.user.findUnique({
				where: { email: data.email },
			})
			if (existingUser) {
				ctx.addIssue({
					path: ['email'],
					code: z.ZodIssueCode.custom,
					message: 'This email is already in use.',
				})
			}
		}),
		async: true,
	})

	if (submission.status !== 'success') {
		return data(
			{ result: submission.reply({ hideFields: ['password'] }) },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}
	const address = submission.value.email
	const result = await prepareVerification({
		target: userId,
		type: 'change-email',
		address,
		send: ({ verifyUrl, otp }) =>
			sendEmail({
				to: address,
				subject: `Quartermaster Email Change Verification`,
				react: <EmailChangeEmail verifyUrl={verifyUrl.toString()} otp={otp} />,
			}),
	})

	switch (result.status) {
		case 'sent': {
			// Every address this device asked for, so each code sent from it
			// works here (each sets the address it was sent to).
			const verifySession = await verifySessionStorage.getSession(
				request.headers.get('cookie'),
			)
			// The newest goes last, so trimming to the cap drops the oldest.
			const addresses = [
				...requestedAddresses(
					verifySession.get(newEmailAddressSessionKey),
				).filter((requested) => requested !== address),
				address,
			].slice(-MAX_LIVE_EMAIL_CODES)
			verifySession.set(newEmailAddressSessionKey, addresses)
			return redirect(result.redirectTo, {
				headers: {
					'set-cookie': await verifySessionStorage.commitSession(verifySession),
				},
			})
		}
		case 'capped':
			// Signed in, so saying no email went out gives nothing away. The
			// cookie stays as it was: no code went to this address.
			return redirectWithToast(result.redirectTo, NO_NEW_EMAIL_TOAST)
		case 'failed':
			return data(
				{
					result: submission.reply({
						formErrors: [result.error.message],
						hideFields: ['password'],
					}),
				},
				{ status: 500 },
			)
	}
}

/** The addresses kept in the verify session, as a list. */
export function requestedAddresses(stored: unknown): string[] {
	if (typeof stored === 'string') return [stored]
	if (Array.isArray(stored)) {
		return stored.filter((value): value is string => typeof value === 'string')
	}
	return []
}

export default function ChangeEmailIndex({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const [form, fields] = useForm({
		id: 'change-email-form',
		constraint: getZodConstraint(ChangeEmailSchema),
		lastResult: actionData?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: ChangeEmailSchema })
		},
	})

	const isPending = useIsPending()
	return (
		<div>
			<p>You will receive an email at the new email address to confirm.</p>
			<p>
				An email notice will also be sent to your old address{' '}
				{loaderData.user.email}.
			</p>
			<div className="mx-auto mt-5 max-w-sm">
				{loaderData.hasPassword ? (
					<Form method="POST" {...getFormProps(form)}>
						<Field
							labelProps={{ children: 'New Email' }}
							inputProps={{
								...getInputProps(fields.email, { type: 'email' }),
								autoComplete: 'email',
							}}
							errors={fields.email.errors}
						/>
						<Field
							labelProps={{ children: 'Current password' }}
							inputProps={{
								...getInputProps(fields.password, { type: 'password' }),
								autoComplete: 'current-password',
							}}
							errors={fields.password.errors}
						/>
						<ErrorList id={form.errorId} errors={form.errors} />
						<div className="mt-8">
							<StatusButton
								status={isPending ? 'pending' : (form.status ?? 'idle')}
							>
								Send Confirmation
							</StatusButton>
						</div>
					</Form>
				) : (
					<p className="text-muted-foreground">
						Changing your email asks for your password, and your account doesn’t
						have one yet.{' '}
						<Link to="/forgot-password" className="text-foreground underline">
							Reset your password
						</Link>{' '}
						to set one.
					</p>
				)}
			</div>
		</div>
	)
}
