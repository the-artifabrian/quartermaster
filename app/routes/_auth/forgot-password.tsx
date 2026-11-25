import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import * as E from '@react-email/components'
import { data, Link, useFetcher } from 'react-router'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList, Field } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { runInBackground } from '#app/utils/background.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { EmailSchema, UsernameSchema } from '#app/utils/user-validation.ts'
import { type Route } from './+types/forgot-password.ts'
import { SEVERAL_CODES_NOTE } from './verify.tsx'
import { emailCodeTarget, prepareVerification } from './verify.server.ts'

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

	// The answer is the same whether or not the account exists, and whether
	// or not an email went out (past the cap, none does). Both cases make the
	// same one lookup before answering: making the code and sending the email
	// happen after the answer, so a known account doesn't answer slower.
	const target = await emailCodeTarget('reset-password', usernameOrEmail)
	if (target) {
		runInBackground(sendResetCode(target), 'sending a password reset code')
	}

	return data({ result: submission.reply(), status: 'sent' as const })
}

async function sendResetCode(target: string) {
	const user = await prisma.user.findUnique({
		where: { id: target },
		select: { email: true },
	})
	if (!user) return
	// Keyed by the account, whichever of username or email was typed, so all
	// of one account's codes share one cap.
	await prepareVerification({
		type: 'reset-password',
		target,
		send: ({ verifyUrl, otp }) =>
			sendEmail({
				to: user.email,
				subject: 'Reset your Quartermaster password',
				react: (
					<ForgotPasswordEmail onboardingUrl={verifyUrl.toString()} otp={otp} />
				),
			}),
	})
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
					<E.Text>Reset your password</E.Text>
				</h1>
				<p>
					<E.Text>
						Here's your verification code: <strong>{otp}</strong>
					</E.Text>
				</p>
				<p>
					<E.Text>Or open this link:</E.Text>
				</p>
				<E.Link href={onboardingUrl}>{onboardingUrl}</E.Link>
				<p>
					<E.Text>If you didn&apos;t ask for this, you can ignore it.</E.Text>
				</p>
			</E.Container>
		</E.Html>
	)
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Forgot password | Quartermaster' }]
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
					<h1 className="font-serif text-2xl">Forgot password</h1>
					<p className="text-muted-foreground mt-3 text-lg">
						{isSent
							? 'Check your email.'
							: "We'll email you a code to reset it."}
					</p>
				</div>
				<div className="mx-auto mt-16 max-w-sm min-w-full sm:min-w-[368px]">
					{isSent ? (
						<div className="text-center">
							<p className="text-muted-foreground">
								If an account matches, we&apos;ve sent a code and a link to its
								email address.
							</p>
							<p className="text-muted-foreground mt-2">{SEVERAL_CODES_NOTE}</p>
							<Link
								to="/login"
								className="mt-8 inline-block text-base font-bold"
							>
								Back to log in
							</Link>
						</div>
					) : (
						<>
							<forgotPassword.Form method="POST" {...getFormProps(form)}>
								<div>
									<Field
										labelProps={{
											htmlFor: fields.usernameOrEmail.id,
											children: 'Username or email',
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

								<div className="mt-8">
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
										Email me a code
									</StatusButton>
								</div>
							</forgotPassword.Form>
							<Link
								to="/login"
								className="mt-6 block text-center text-base font-bold"
							>
								Back to log in
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
