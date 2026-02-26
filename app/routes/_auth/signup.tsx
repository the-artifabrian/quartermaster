import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import * as E from '@react-email/components'
import { data, redirect, Form, Link } from 'react-router'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList, Field } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireAnonymous } from '#app/utils/auth.server.ts'
import {
	GOOGLE_PROVIDER_NAME,
	ProviderConnectionForm,
} from '#app/utils/connections.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { useIsPending } from '#app/utils/misc.tsx'
import { EmailSchema } from '#app/utils/user-validation.ts'
import { type Route } from './+types/signup.ts'
import { prepareVerification } from './verify.server.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

const SignupSchema = z.object({
	email: EmailSchema,
})

export async function loader({ request }: Route.LoaderArgs) {
	await requireAnonymous(request)
	return null
}

export async function action({ request }: Route.ActionArgs) {
	const formData = await request.formData()

	const submission = await parseWithZod(formData, {
		schema: SignupSchema.superRefine(async (data, ctx) => {
			const existingUser = await prisma.user.findUnique({
				where: { email: data.email },
				select: { id: true },
			})
			if (existingUser) {
				ctx.addIssue({
					path: ['email'],
					code: z.ZodIssueCode.custom,
					message: 'A user already exists with this email',
				})
				return
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
	const { email } = submission.value
	const { verifyUrl, redirectTo, otp } = await prepareVerification({
		period: 10 * 60,
		request,
		type: 'onboarding',
		target: email,
	})

	const response = await sendEmail({
		to: email,
		subject: `Welcome to Quartermaster!`,
		react: <SignupEmail onboardingUrl={verifyUrl.toString()} otp={otp} />,
	})

	if (response.status === 'success') {
		return redirect(redirectTo.toString())
	} else {
		return data(
			{
				result: submission.reply({ formErrors: [response.error.message] }),
			},
			{
				status: 500,
			},
		)
	}
}

export function SignupEmail({
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
					<E.Text>Welcome to Quartermaster!</E.Text>
				</h1>
				<p>
					<E.Text>
						Here's your verification code: <strong>{otp}</strong>
					</E.Text>
				</p>
				<p>
					<E.Text>Or click the link to get started:</E.Text>
				</p>
				<E.Link href={onboardingUrl}>{onboardingUrl}</E.Link>
			</E.Container>
		</E.Html>
	)
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Sign Up | Quartermaster' }]
}

export default function SignupRoute({ actionData }: Route.ComponentProps) {
	const isPending = useIsPending()
	const [form, fields] = useForm({
		id: 'signup-form',
		constraint: getZodConstraint(SignupSchema),
		lastResult: actionData?.result,
		onValidate({ formData }) {
			const result = parseWithZod(formData, { schema: SignupSchema })
			return result
		},
		shouldRevalidate: 'onBlur',
	})

	return (
		<div className="container flex flex-col justify-center pt-20 pb-32">
			<div className="text-center">
				<h1 className="font-serif text-2xl">Your recipes deserve a home.</h1>
				<p className="text-lg text-muted-foreground mt-3">
					Enter your email to create an account.
				</p>
				<p className="text-sm text-muted-foreground mt-1">
					Free for 14 days. No credit card needed.
				</p>
			</div>
			<div className="mx-auto mt-8 max-w-sm min-w-full sm:min-w-[368px]">
				<Form method="POST" {...getFormProps(form)}>
					<Field
						labelProps={{
							htmlFor: fields.email.id,
							children: 'Email',
						}}
						inputProps={{
							...getInputProps(fields.email, { type: 'email' }),
							autoFocus: true,
							autoComplete: 'email',
						}}
						errors={fields.email.errors}
					/>
					<ErrorList errors={form.errors} id={form.errorId} />
					<div className="mt-4" />
					<StatusButton
						className="w-full"
						status={isPending ? 'pending' : (form.status ?? 'idle')}
						type="submit"
						disabled={isPending}
					>
						Submit
					</StatusButton>
				</Form>
				<div className="my-4 flex items-center gap-4">
					<hr className="flex-1" />
					<span className="text-sm text-muted-foreground">or</span>
					<hr className="flex-1" />
				</div>
				<ProviderConnectionForm
					type="Signup"
					providerName={GOOGLE_PROVIDER_NAME}
				/>
				<div className="mt-6 text-center text-sm text-muted-foreground">
					Already have an account?{' '}
					<Link to="/login" className="font-bold text-foreground">
						Log in
					</Link>
				</div>
			</div>
		</div>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
