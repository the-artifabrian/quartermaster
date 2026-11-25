import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	WebAuthnAbortService,
	startAuthentication,
} from '@simplewebauthn/browser'
import { useEffect, useOptimistic, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { data, Form, Link, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { CheckboxField, ErrorList, Field } from '#app/components/forms.tsx'
import { TryDemoButton } from '#app/components/demo.tsx'
import { Spacer } from '#app/components/spacer.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { login, requireAnonymous } from '#app/utils/auth.server.ts'
import { getErrorMessage, useIsPending } from '#app/utils/misc.tsx'
import {
	isPasskeyPromptDismissed,
	passkeyErrorName,
	signalUnknownPasskey,
	supportsPasskeyAutofill,
	isUnknownPasskeyAnswer,
} from '#app/utils/passkeys.ts'
import { useIsNativeShell } from '#app/utils/request-info.ts'
import { PasswordSchema, UsernameSchema } from '#app/utils/user-validation.ts'
import { type Route } from './+types/login.ts'
import { handleNewSession } from './login.server.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

const LoginFormSchema = z.object({
	username: UsernameSchema,
	password: PasswordSchema,
	redirectTo: z.string().optional(),
	remember: z.boolean().optional(),
})

const AuthenticationOptionsSchema = z.object({
	options: z.object({
		challenge: z.string(),
		rpId: z.string().optional(),
		timeout: z.number().optional(),
		userVerification: z
			.enum(['required', 'preferred', 'discouraged'])
			.optional(),
	}),
}) satisfies z.ZodType<{ options: PublicKeyCredentialRequestOptionsJSON }>

export async function loader({ request }: Route.LoaderArgs) {
	await requireAnonymous(request)
	return {}
}

export async function action({ request }: Route.ActionArgs) {
	await requireAnonymous(request)
	const formData = await request.formData()
	const submission = await parseWithZod(formData, {
		schema: (intent) =>
			LoginFormSchema.transform(async (data, ctx) => {
				if (intent !== null) return { ...data, session: null }

				const session = await login(data)
				if (!session) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: 'Invalid username or password',
					})
					return z.NEVER
				}

				return { ...data, session }
			}),
		async: true,
	})

	if (submission.status !== 'success' || !submission.value.session) {
		return data(
			{ result: submission.reply({ hideFields: ['password'] }) },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}

	const { session, remember, redirectTo } = submission.value

	return handleNewSession({
		request,
		session,
		remember: remember ?? false,
		redirectTo,
	})
}

export default function LoginPage({ actionData }: Route.ComponentProps) {
	const isPending = useIsPending()
	const [searchParams] = useSearchParams()
	const redirectTo = searchParams.get('redirectTo')
	// The iOS app always remembers the login; the server enforces it.
	const isNativeShell = useIsNativeShell()

	const [form, fields] = useForm({
		id: 'login-form',
		constraint: getZodConstraint(LoginFormSchema),
		defaultValue: { redirectTo },
		lastResult: actionData?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: LoginFormSchema })
		},
		shouldRevalidate: 'onBlur',
	})

	return (
		<div className="flex min-h-full flex-col justify-center pt-20 pb-32">
			<div className="mx-auto w-full max-w-md">
				<div className="flex flex-col gap-3 text-center">
					<h1 className="font-serif text-2xl">Log in</h1>
					<p className="text-muted-foreground text-lg">
						Use your password or a passkey.
					</p>
				</div>
				<Spacer size="xs" />

				<div>
					<div className="mx-auto w-full max-w-md px-8">
						<Form method="POST" {...getFormProps(form)}>
							<Field
								labelProps={{ children: 'Username' }}
								inputProps={{
									...getInputProps(fields.username, { type: 'text' }),
									autoFocus: true,
									className: 'lowercase',
									// `webauthn` lets focusing the field offer a saved passkey.
									autoComplete: 'username webauthn',
									autoCapitalize: 'none',
									autoCorrect: 'off',
									spellCheck: false,
								}}
								errors={fields.username.errors}
							/>

							<Field
								labelProps={{ children: 'Password' }}
								inputProps={{
									...getInputProps(fields.password, {
										type: 'password',
									}),
									autoComplete: 'current-password',
								}}
								errors={fields.password.errors}
							/>

							<div className="flex justify-between pt-3">
								{isNativeShell ? null : (
									<CheckboxField
										labelProps={{
											htmlFor: fields.remember.id,
											children: 'Remember me',
										}}
										buttonProps={getInputProps(fields.remember, {
											type: 'checkbox',
										})}
										errors={fields.remember.errors}
									/>
								)}
								<div className="ml-auto">
									<Link to="/forgot-password" className="text-sm font-semibold">
										Forgot password?
									</Link>
								</div>
							</div>

							<input
								{...getInputProps(fields.redirectTo, { type: 'hidden' })}
								// Can hold an invite link; kept out of session replays.
								className="ph-no-capture"
							/>
							<ErrorList errors={form.errors} id={form.errorId} />

							<div className="flex items-center justify-between gap-6 pt-8">
								<StatusButton
									className="w-full"
									status={isPending ? 'pending' : (form.status ?? 'idle')}
									type="submit"
									disabled={isPending}
								>
									Log in
								</StatusButton>
							</div>
						</Form>
						<hr className="my-4" />
						<div className="flex flex-col gap-5">
							<PasskeyLogin
								redirectTo={redirectTo}
								remember={fields.remember.value === 'on'}
							/>
						</div>
						<div className="flex items-center justify-center gap-2 pt-6">
							<span className="text-muted-foreground">New here?</span>
							<Link
								to={
									redirectTo
										? `/signup?redirectTo=${encodeURIComponent(redirectTo)}`
										: '/signup'
								}
							>
								Create an account
							</Link>
						</div>
						{/* A redirectTo is an invite or a page to come back to, and a
						    demo can't join a Household or keep anything. */}
						{redirectTo ? null : (
							<div className="pt-4">
								<TryDemoButton
									redirectTo="/login"
									variant="outline"
									className="w-full"
								/>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

const VerificationResponseSchema = z.discriminatedUnion('status', [
	z.object({
		status: z.literal('success'),
		location: z.string(),
	}),
	z.object({
		status: z.literal('error'),
		error: z.string(),
	}),
])

async function fetchAuthenticationOptions() {
	const response = await fetch('/webauthn/authentication')
	const { options } = AuthenticationOptionsSchema.parse(await response.json())
	return options
}

type AuthenticationResponse = Awaited<ReturnType<typeof startAuthentication>>

function PasskeyLogin({
	redirectTo,
	remember,
}: {
	redirectTo: string | null
	remember: boolean
}) {
	const [error, setError] = useState<string | null>(null)
	const [passkeyMessage, setPasskeyMessage] = useOptimistic<string | null>(
		'Log in with a passkey',
	)
	const navigate = useNavigate()
	// Autofill can finish after the checkbox changes; read the latest values.
	const latest = useRef({ redirectTo, remember, navigate })
	latest.current = { redirectTo, remember, navigate }
	// The autofill request starts on load and again after a button attempt
	// that didn't log in. `armAutofill` is set by the effect below.
	const armAutofill = useRef<() => void>(() => {})
	const autofillOptions = useRef<Promise<unknown> | null>(null)
	const buttonActive = useRef(false)

	// Throws with the server's message when the passkey isn't accepted.
	async function finishLogin(
		authResponse: AuthenticationResponse,
		rpId: string | undefined,
	) {
		const { remember, redirectTo, navigate } = latest.current
		const verificationResponse = await fetch('/webauthn/authentication', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ authResponse, remember, redirectTo }),
		})
		const verificationJson = await verificationResponse.json().catch(() => ({
			status: 'error',
			error: 'Unknown error',
		}))

		const parsedResult = VerificationResponseSchema.safeParse(verificationJson)
		if (!parsedResult.success) {
			throw new Error(parsedResult.error.message)
		} else if (parsedResult.data.status === 'error') {
			if (
				isUnknownPasskeyAnswer(verificationResponse.status, verificationJson) &&
				rpId
			) {
				// The server has no such passkey; the browser can stop offering it.
				void signalUnknownPasskey({ rpId, credentialId: authResponse.id })
			}
			throw new Error(parsedResult.data.error)
		}
		await navigate(parsedResult.data.location ?? '/')
	}
	const finishLoginRef = useRef(finishLogin)
	finishLoginRef.current = finishLogin

	useEffect(() => {
		let unmounted = false
		// Autofill re-arms itself after a cancel or a failed login. The cap
		// keeps a browser that refuses at once from asking for options in a loop.
		let rearmsLeft = 5
		function rearm() {
			if (unmounted || buttonActive.current || rearmsLeft <= 0) return
			rearmsLeft -= 1
			arm()
		}
		function arm() {
			const setup = (async () => {
				if (!(await supportsPasskeyAutofill())) return null
				// Checked before the fetch too: in development StrictMode
				// unmounts the first run, whose challenge cookie would otherwise
				// replace the second run's.
				if (buttonActive.current || unmounted) return null
				const options = await fetchAuthenticationOptions()
				// The button took over while the options were on their way.
				return buttonActive.current || unmounted ? null : options
			})()
			autofillOptions.current = setup
			void setup
				.then(async (options) => {
					if (!options || buttonActive.current) return
					let authResponse: AuthenticationResponse
					try {
						authResponse = await startAuthentication({
							optionsJSON: options,
							useBrowserAutofill: true,
						})
					} catch (e) {
						// The person closed the prompt they picked from autofill:
						// offer autofill again. An AbortError is the button flow
						// or leaving the page, which arm it themselves or don't need it.
						if (passkeyErrorName(e) === 'NotAllowedError') rearm()
						else if (!isPasskeyPromptDismissed(e)) {
							console.warn('Passkey autofill stopped', e)
						}
						return
					}
					try {
						setError(null)
						await finishLoginRef.current(authResponse, options.rpId)
					} catch (e) {
						if (unmounted) return
						setError(`Couldn't log in with a passkey. ${getErrorMessage(e)}`)
						rearm()
					}
				})
				// Autofill is optional; the button still works without it.
				.catch(() => {})
		}
		armAutofill.current = arm
		arm()
		return () => {
			unmounted = true
			armAutofill.current = () => {}
			WebAuthnAbortService.cancelCeremony()
		}
	}, [])

	async function handlePasskeyLogin() {
		// A second tap while a passkey request runs would cancel it.
		if (buttonActive.current) return
		buttonActive.current = true
		let loggedIn = false
		try {
			setError(null)
			// Let a pending autofill options request land first, so its
			// challenge cookie can't replace the one fetched below.
			await autofillOptions.current?.catch(() => {})
			setPasskeyMessage('Getting ready…')
			const options = await fetchAuthenticationOptions()

			setPasskeyMessage('Waiting for your passkey…')
			// This cancels the pending autofill request.
			const authResponse = await startAuthentication({ optionsJSON: options })
			setPasskeyMessage('Checking your passkey…')

			await finishLoginRef.current(authResponse, options.rpId)
			loggedIn = true
			setPasskeyMessage('Logged in')
		} catch (e) {
			// Closing the prompt or letting it time out leaves the page as it was.
			if (isPasskeyPromptDismissed(e)) return
			setError(`Couldn't log in with a passkey. ${getErrorMessage(e)}`)
		} finally {
			buttonActive.current = false
			if (!loggedIn) armAutofill.current()
		}
	}

	return (
		<form action={handlePasskeyLogin}>
			<PasskeyLoginButton error={error} message={passkeyMessage} />
		</form>
	)
}

// Reads the form's pending state: state set inside a form action only shows
// once the action ends.
function PasskeyLoginButton({
	error,
	message,
}: {
	error: string | null
	message: string | null
}) {
	const { pending } = useFormStatus()
	// A new attempt hides the last one's error.
	const shownError = pending ? null : error
	return (
		<>
			<StatusButton
				id="passkey-login-button"
				aria-describedby="passkey-login-button-error"
				className="w-full"
				status={pending ? 'pending' : shownError ? 'error' : 'idle'}
				type="submit"
				disabled={pending}
			>
				<span className="inline-flex items-center gap-1.5">
					<Icon name="passkey" />
					<span>{message}</span>
				</span>
			</StatusButton>
			<div className="mt-2">
				<ErrorList errors={[shownError]} id="passkey-login-button-error" />
			</div>
		</>
	)
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Log in | Quartermaster' }]
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
