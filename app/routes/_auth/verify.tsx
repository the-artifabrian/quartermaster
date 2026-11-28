import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useRef } from 'react'
import { Form, Link, useLocation, useSearchParams } from 'react-router'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList, OTPField } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { cn, useIsPending } from '#app/utils/misc.tsx'
import { type Route } from './+types/verify.ts'
import {
	signedOutAlignClass,
	signedOutColumnClass,
	signedOutJustifyClass,
	signedOutLeadClass,
	signedOutMainActionClass,
	signedOutPageClass,
	signedOutRowLinkClass,
	signedOutSmallClass,
	SignedOutTitle,
} from './+signed-out.tsx'
import { validateRequest } from './verify.server.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

/** Shown wherever someone waits for an emailed code, sent or not. */
export const SEVERAL_CODES_NOTE =
	'Asked more than once? Each code we sent works for 10 minutes, or until you use one of them.'

/** Where to ask for a new code of each emailed kind. */
const newCodePaths = {
	onboarding: '/signup',
	'reset-password': '/forgot-password',
	'change-email': '/settings/profile/change-email',
} as const

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

const pageClass = cn(
	'container flex flex-col justify-center pt-20 pb-32',
	signedOutPageClass,
)
const headClass = cn('text-center', signedOutAlignClass, signedOutColumnClass)
const leadClass = cn(
	'text-muted-foreground phone:mt-2 mt-3 text-lg',
	signedOutLeadClass,
)
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
			<SignedOutTitle>Check your email</SignedOutTitle>
			<p className={leadClass}>
				We've sent you a code to verify your email address.
			</p>
			<p className={cn('text-muted-foreground mt-2', signedOutSmallClass)}>
				{SEVERAL_CODES_NOTE}
			</p>
		</>
	)

	const headings: Record<VerificationTypes, React.ReactNode> = {
		onboarding: checkEmail,
		'reset-password': checkEmail,
		'change-email': checkEmail,
		'2fa': (
			<>
				<SignedOutTitle>Check your 2FA app</SignedOutTitle>
				<p className={leadClass}>Enter the code it shows for Quartermaster.</p>
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
	// Arriving from the emailed link, there's nothing to type. Once the
	// server has answered (the link didn't work), the code field shows.
	const linkReady =
		Boolean(searchParams.get(tokenQueryParam)) &&
		!searchParams.get(codeQueryParam) &&
		!actionData

	if (
		actionData &&
		'loggedInAs' in actionData &&
		typeof actionData.loggedInAs === 'string'
	) {
		return <LoggedInStep username={actionData.loggedInAs} />
	}

	const newCodePath =
		type && type !== '2fa' && fields[codeQueryParam].errors?.length
			? newCodePaths[type]
			: null

	return (
		<main className={pageClass}>
			<div className={headClass}>
				{linkReady ? (
					<>
						<SignedOutTitle>Your link is ready</SignedOutTitle>
						<p className={leadClass}>Press Submit to carry on.</p>
					</>
				) : type ? (
					headings[type]
				) : (
					'This link isn’t valid'
				)}
			</div>

			<div className="phone:h-6 h-16" />

			<div
				className={cn(
					'phone:gap-0 mx-auto flex w-80 max-w-full flex-col justify-center gap-1',
					signedOutColumnClass,
				)}
			>
				<div>
					<ErrorList errors={form.errors} id={form.errorId} />
				</div>
				<div className="flex w-full gap-2">
					<Form method="POST" {...getFormProps(form)} className="flex-1">
						{linkReady ? null : (
							<div
								className={cn(
									'flex items-center justify-center',
									signedOutJustifyClass,
								)}
							>
								<OTPField
									// Eight boxes share the column's width; six keep their size.
									className={
										codeLength === EMAILED_CODE_LENGTH ? 'w-full' : undefined
									}
									length={codeLength}
									labelProps={{
										htmlFor: fields[codeQueryParam].id,
										children: 'Code',
									}}
									inputProps={{
										...getInputProps(fields[codeQueryParam], { type: 'text' }),
										autoComplete: 'one-time-code',
										// Emailed codes have letters; 2FA codes are digits.
										inputMode:
											codeLength === EMAILED_CODE_LENGTH ? 'text' : 'numeric',
										autoFocus: true,
									}}
									errors={fields[codeQueryParam].errors}
								/>
							</div>
						)}
						<input
							{...getInputProps(fields[typeQueryParam], { type: 'hidden' })}
						/>
						<input
							{...getInputProps(fields[tokenQueryParam], { type: 'hidden' })}
						/>
						<input
							{...getInputProps(fields[targetQueryParam], { type: 'hidden' })}
						/>
						<input
							{...getInputProps(fields[redirectToQueryParam], {
								type: 'hidden',
							})}
						/>
						<StatusButton
							className={cn(
								'w-full',
								signedOutMainActionClass,
								// The code field keeps 36px under it for its error;
								// the button sits 32px under the boxes all the same.
								!linkReady && 'phone:-mt-1',
							)}
							status={isPending ? 'pending' : (form.status ?? 'idle')}
							type="submit"
							disabled={isPending}
						>
							Submit
						</StatusButton>
					</Form>
				</div>
				{newCodePath ? (
					<Link
						to={newCodePath}
						className={cn(
							'mt-6 text-center text-base font-bold',
							signedOutRowLinkClass,
						)}
					>
						Ask for a new code
					</Link>
				) : null}
			</div>
		</main>
	)
}

/**
 * A signup code used on a browser that is logged in. Nothing was used up, so
 * the same code works once they log out and come back here.
 */
function LoggedInStep({ username }: { username: string }) {
	const location = useLocation()
	const isPending = useIsPending({ formAction: '/logout' })
	const heading = useRef<HTMLHeadingElement>(null)
	useEffect(() => heading.current?.focus(), [])
	return (
		<main className={pageClass}>
			<div className={headClass}>
				<SignedOutTitle ref={heading} tabIndex={-1}>
					You’re logged in as {username}
				</SignedOutTitle>
				<p className={leadClass}>
					Log out to finish signing up the new address. The code in your email
					will still work.
				</p>
			</div>
			<div className="phone:h-6 h-16" />
			<Form
				method="POST"
				action="/logout"
				className={cn(
					'mx-auto flex w-80 max-w-full flex-col',
					signedOutColumnClass,
				)}
			>
				<input
					type="hidden"
					name="redirectTo"
					value={`${location.pathname}${location.search}`}
				/>
				<StatusButton
					className={cn('w-full', signedOutMainActionClass)}
					status={isPending ? 'pending' : 'idle'}
					type="submit"
					disabled={isPending}
				>
					Log out
				</StatusButton>
			</Form>
		</main>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
