import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Form, useSearchParams } from 'react-router'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList, OTPField } from '#app/components/forms.tsx'
import { Spacer } from '#app/components/spacer.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { useIsPending } from '#app/utils/misc.tsx'
import { type Route } from './+types/verify.ts'
import { validateRequest } from './verify.server.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

/** Shown wherever someone waits for an emailed code, sent or not. */
export const SEVERAL_CODES_NOTE =
	'Asked more than once? Any code we sent in the last 10 minutes works.'

export const codeQueryParam = 'code'
/** The emailed link's token, which stands in for the typed code. */
export const tokenQueryParam = 'token'
export const targetQueryParam = 'target'
export const typeQueryParam = 'type'
export const redirectToQueryParam = 'redirectTo'
const types = ['onboarding', 'reset-password', 'change-email', '2fa'] as const
const VerificationTypeSchema = z.enum(types)
export type VerificationTypes = z.infer<typeof VerificationTypeSchema>

const EMAILED_CODE_LENGTH = 8
const TWO_FA_CODE_LENGTH = 6

function isEmailedType(type: VerificationTypes | null) {
	return type !== null && type !== '2fa'
}

export const VerifySchema = z
	.object({
		// Any case, and spaces or dashes from a copied code, all read the same.
		[codeQueryParam]: z
			.string()
			.optional()
			.transform(
				(code) => code?.replace(/[\s-]/g, '').toUpperCase() || undefined,
			),
		[tokenQueryParam]: z.string().optional(),
		[typeQueryParam]: VerificationTypeSchema,
		[targetQueryParam]: z.string(),
		[redirectToQueryParam]: z.string().optional(),
	})
	.superRefine((data, ctx) => {
		const code = data[codeQueryParam]
		if (isEmailedType(data[typeQueryParam])) {
			if (code === undefined && data[tokenQueryParam]) return
			if (code?.length === EMAILED_CODE_LENGTH) return
			ctx.addIssue({
				path: [codeQueryParam],
				code: 'custom',
				message: `Enter the ${EMAILED_CODE_LENGTH}-character code from the email`,
			})
			return
		}
		if (code?.length !== TWO_FA_CODE_LENGTH || !/^\d+$/.test(code)) {
			ctx.addIssue({
				path: [codeQueryParam],
				code: 'custom',
				message: `Enter the ${TWO_FA_CODE_LENGTH}-digit code from your app`,
			})
		}
	})

export async function action({ request }: Route.ActionArgs) {
	const formData = await request.formData()
	return validateRequest(request, formData)
}

export default function VerifyRoute(props: Route.ComponentProps) {
	const [searchParams] = useSearchParams()
	// One verification can send the user through another (a reverify) and back
	// to this route; each step's form starts over with its own type and target.
	return <VerifyStep key={searchParams.toString()} {...props} />
}

function VerifyStep({ actionData }: Route.ComponentProps) {
	const [searchParams] = useSearchParams()
	const isPending = useIsPending()
	const parseWithZoddType = VerificationTypeSchema.safeParse(
		searchParams.get(typeQueryParam),
	)
	const type = parseWithZoddType.success ? parseWithZoddType.data : null

	const checkEmail = (
		<>
			<h1 className="font-serif text-2xl">Check your email</h1>
			<p className="text-muted-foreground mt-3 text-lg">
				We've sent you a code to verify your email address.
			</p>
			<p className="text-muted-foreground mt-2">{SEVERAL_CODES_NOTE}</p>
		</>
	)

	const headings: Record<VerificationTypes, React.ReactNode> = {
		onboarding: checkEmail,
		'reset-password': checkEmail,
		'change-email': checkEmail,
		'2fa': (
			<>
				<h1 className="font-serif text-2xl">Check your 2FA app</h1>
				<p className="text-muted-foreground mt-3 text-lg">
					Please enter your 2FA code to verify your identity.
				</p>
			</>
		),
	}

	const [form, fields] = useForm({
		id: 'verify-form',
		constraint: getZodConstraint(VerifySchema),
		lastResult: actionData?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: VerifySchema })
		},
		defaultValue: {
			code: searchParams.get(codeQueryParam),
			token: searchParams.get(tokenQueryParam),
			type: type,
			target: searchParams.get(targetQueryParam),
			redirectTo: searchParams.get(redirectToQueryParam),
		},
	})

	const codeLength = isEmailedType(type)
		? EMAILED_CODE_LENGTH
		: TWO_FA_CODE_LENGTH
	// Arriving from the emailed link, there's nothing to type unless the link
	// didn't work.
	const linkReady =
		Boolean(searchParams.get(tokenQueryParam)) &&
		!searchParams.get(codeQueryParam) &&
		!fields[codeQueryParam].errors?.length

	return (
		<main className="container flex flex-col justify-center pt-20 pb-32">
			<div className="text-center">
				{type ? headings[type] : 'Invalid Verification Type'}
			</div>

			<Spacer size="xs" />

			<div className="mx-auto flex w-80 max-w-full flex-col justify-center gap-1">
				<div>
					<ErrorList errors={form.errors} id={form.errorId} />
				</div>
				<div className="flex w-full gap-2">
					<Form method="POST" {...getFormProps(form)} className="flex-1">
						{linkReady ? (
							<p className="mb-6 text-center">
								Your link is ready. Press Submit to carry on.
							</p>
						) : (
							<div className="flex items-center justify-center">
								<OTPField
									className="w-full"
									length={codeLength}
									labelProps={{
										htmlFor: fields[codeQueryParam].id,
										children: 'Code',
									}}
									inputProps={{
										...getInputProps(fields[codeQueryParam], { type: 'text' }),
										autoComplete: 'one-time-code',
										autoFocus: true,
									}}
									errors={fields[codeQueryParam].errors}
								/>
							</div>
						)}
						<input
							{...getInputProps(fields[typeQueryParam], { type: 'hidden' })}
						/>
						{/* The link's token works like the code itself. */}
						<input
							{...getInputProps(fields[tokenQueryParam], { type: 'hidden' })}
							className="ph-no-capture"
						/>
						{/* The target can be an email address and redirectTo an invite
						link, so both are kept out of session replays. */}
						<input
							{...getInputProps(fields[targetQueryParam], { type: 'hidden' })}
							className="ph-no-capture"
						/>
						<input
							{...getInputProps(fields[redirectToQueryParam], {
								type: 'hidden',
							})}
							className="ph-no-capture"
						/>
						<StatusButton
							className="w-full"
							status={isPending ? 'pending' : (form.status ?? 'idle')}
							type="submit"
							disabled={isPending}
						>
							Submit
						</StatusButton>
					</Form>
				</div>
			</div>
		</main>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
