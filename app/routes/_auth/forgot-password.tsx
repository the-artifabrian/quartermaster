import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import * as E from '@react-email/components'
import { data, Link, useFetcher } from 'react-router'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList, Field } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { EmailSchema, UsernameSchema } from '#app/utils/user-validation.ts'
import { type Route } from './+types/forgot-password.ts'
import { prepareVerification } from './verify.server.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

const ForgotPasswordSchema = z.object({
	usernameOrEmail: z.union([EmailSchema, UsernameSchema]),
})

export async function action({ request }: Route.ActionArgs) {
	const formData = await request.formData()
	const submission = parseWithZod(formData, { schema: ForgotPasswordSchema })
	if (submission.status !== 'success') {
		return data(
			{ result: submission.reply(), status: 'error' as const },
			{ status: 400 },
		)
	}
	const { usernameOrEmail } = submission.value

	// Always return the same response to prevent user enumeration
	const user = await prisma.user.findFirst({
		where: {
			OR: [
				{ email: usernameOrEmail },
				{ username: usernameOrEmail },
			],
		},
		select: { email: true, username: true },
	})

	if (user) {
		try {
			const { verifyUrl, otp } = await prepareVerification({
				period: 10 * 60,
				request,
				type: 'reset-password',
				target: usernameOrEmail,
			})

			await sendEmail({
				to: user.email,
				subject: `Quartermaster Password Reset`,
				react: (
					<ForgotPasswordEmail
						onboardingUrl={verifyUrl.toString()}
						otp={otp}
					/>
				),
			})
		} catch {
			// Swallow errors to prevent user enumeration via error responses
		}
	}

	return data({ result: submission.reply(), status: 'sent' as const })
}

function ForgotPasswordEmail({
	onboardingUrl,
	otp,
}: {
	onboardingUrl: string
	otp: string
}) {
	return (
		<E.Html lang="en" dir="ltr">
			<E.Container>
				<h1>
					<E.Text>Quartermaster Password Reset</E.Text>
				</h1>
				<p>
					<E.Text>
						Here's your verification code: <strong>{otp}</strong>
					</E.Text>
				</p>
				<p>
					<E.Text>Or click the link:</E.Text>
				</p>
				<E.Link href={onboardingUrl}>{onboardingUrl}</E.Link>
			</E.Container>
		</E.Html>
	)
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Password Recovery for Quartermaster' }]
}

export default function ForgotPasswordRoute() {
	const forgotPassword = useFetcher<typeof action>()

	const [form, fields] = useForm({
		id: 'forgot-password-form',
		constraint: getZodConstraint(ForgotPasswordSchema),
		lastResult: forgotPassword.data?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: ForgotPasswordSchema })
		},
		shouldRevalidate: 'onBlur',
	})

	const isSent = forgotPassword.data?.status === 'sent'

	return (
		<div className="container pt-20 pb-32">
			<div className="flex flex-col justify-center">
				<div className="text-center">
					<h1 className="font-serif text-2xl">Forgot Password</h1>
					<p className="text-lg text-muted-foreground mt-3">
						{isSent
							? 'Check your email for reset instructions.'
							: "No worries, we'll send you reset instructions."}
					</p>
				</div>
				<div className="mx-auto mt-16 max-w-sm min-w-full sm:min-w-[368px]">
					{isSent ? (
						<div className="text-center">
							<p className="text-muted-foreground">
								If an account exists with that username or email,
								you'll receive a password reset link shortly.
							</p>
							<Link
								to="/login"
								className="mt-8 inline-block text-base font-bold"
							>
								Back to Login
							</Link>
						</div>
					) : (
						<>
							<forgotPassword.Form method="POST" {...getFormProps(form)}>
								<div>
									<Field
										labelProps={{
											htmlFor: fields.usernameOrEmail.id,
											children: 'Username or Email',
										}}
										inputProps={{
											autoFocus: true,
											...getInputProps(fields.usernameOrEmail, {
												type: 'text',
											}),
										}}
										errors={fields.usernameOrEmail.errors}
									/>
								</div>
								<ErrorList errors={form.errors} id={form.errorId} />

								<div className="mt-6">
									<StatusButton
										className="w-full"
										status={
											forgotPassword.state === 'submitting'
												? 'pending'
												: (form.status ?? 'idle')
										}
										type="submit"
										disabled={forgotPassword.state !== 'idle'}
									>
										Recover password
									</StatusButton>
								</div>
							</forgotPassword.Form>
							<Link
								to="/login"
								className="mt-6 block text-center text-base font-bold"
							>
								Back to Login
							</Link>
						</>
					)}
				</div>
			</div>
		</div>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
