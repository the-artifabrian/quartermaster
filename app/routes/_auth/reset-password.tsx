import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, redirect, Form } from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList, Field } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import {
	checkIsCommonPassword,
	endSessionCookies,
	getBrowserSession,
	resetUserPassword,
} from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { cn, useIsPending } from '#app/utils/misc.tsx'
import { PasswordAndConfirmPasswordSchema } from '#app/utils/user-validation.ts'
import { type Route } from './+types/reset-password.ts'
import {
	signedOutAlignClass,
	signedOutColumnClass,
	signedOutGapClass,
	signedOutLeadClass,
	signedOutMainActionClass,
	signedOutPageClass,
	signedOutSmallClass,
	SignedOutTitle,
} from './+signed-out.tsx'
import { requireResetPasswordUser } from './reset-password.server.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

const ResetPasswordSchema = PasswordAndConfirmPasswordSchema

// A reset works whether or not this browser is logged in, and as whichever
// account: links from emails open in the iOS app, which always is. Once the
// password is reset the browser is logged out.
export async function loader({ request }: Route.LoaderArgs) {
	const user = await requireResetPasswordUser(request)
	const loggedIn = Boolean((await getBrowserSession(request))?.username)
	return { username: user.username, loggedIn }
}

export async function action({ request }: Route.ActionArgs) {
	const user = await requireResetPasswordUser(request)
	const formData = await request.formData()
	const submission = await parseWithZod(formData, {
		schema: ResetPasswordSchema.superRefine(async ({ password }, ctx) => {
			const isCommonPassword = await checkIsCommonPassword(password)
			if (isCommonPassword) {
				ctx.addIssue({
					path: ['password'],
					code: 'custom',
					message: 'That password is too common. Try another.',
				})
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
	const { password } = submission.value

	await resetUserPassword({ userId: user.id, password })
	// The reset ended every session of this account. A session of another
	// account on this browser ends too.
	const browserSession = await getBrowserSession(request)
	if (browserSession) {
		await prisma.session.deleteMany({ where: { id: browserSession.id } })
	}
	return redirect('/login', { headers: await endSessionCookies(request) })
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Reset password | Quartermaster' }]
}

export default function ResetPasswordPage({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const isPending = useIsPending()

	const [form, fields] = useForm({
		id: 'reset-password',
		constraint: getZodConstraint(ResetPasswordSchema),
		lastResult: actionData?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: ResetPasswordSchema })
		},
		shouldRevalidate: 'onBlur',
	})

	return (
		<div
			className={cn(
				'container flex flex-col justify-center pt-20 pb-32',
				signedOutPageClass,
			)}
		>
			<div
				className={cn('text-center', signedOutAlignClass, signedOutColumnClass)}
			>
				<SignedOutTitle>Choose a new password</SignedOutTitle>
				<p
					className={cn(
						'text-muted-foreground phone:mt-2 mt-3 text-lg',
						signedOutLeadClass,
					)}
				>
					For {loaderData.username}
				</p>
				{loaderData.loggedIn ? (
					<p className={cn('text-muted-foreground mt-2', signedOutSmallClass)}>
						Resetting your password logs this device out.
					</p>
				) : null}
			</div>
			<div
				className={cn(
					'mx-auto mt-16 max-w-sm min-w-full sm:min-w-[368px]',
					signedOutGapClass,
					signedOutColumnClass,
				)}
			>
				<Form method="POST" {...getFormProps(form)}>
					<Field
						labelProps={{
							htmlFor: fields.password.id,
							children: 'New password',
						}}
						inputProps={{
							...getInputProps(fields.password, { type: 'password' }),
							autoComplete: 'new-password',
							autoFocus: true,
						}}
						errors={fields.password.errors}
					/>
					<Field
						labelProps={{
							htmlFor: fields.confirmPassword.id,
							children: 'Confirm password',
						}}
						inputProps={{
							...getInputProps(fields.confirmPassword, { type: 'password' }),
							autoComplete: 'new-password',
						}}
						errors={fields.confirmPassword.errors}
					/>

					<ErrorList errors={form.errors} id={form.errorId} />

					<StatusButton
						className={cn('mt-8 w-full', signedOutMainActionClass)}
						status={isPending ? 'pending' : (form.status ?? 'idle')}
						type="submit"
						disabled={isPending}
					>
						Reset password
					</StatusButton>
				</Form>
			</div>
		</div>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
