import { render } from '@react-email/components'
import { type ReactElement } from 'react'
import { z } from 'zod'
import { captureServerEvent } from './posthog.server.ts'

const resendErrorSchema = z.union([
	z.object({
		name: z.string(),
		message: z.string(),
		statusCode: z.number(),
	}),
	z.object({
		name: z.literal('UnknownError'),
		message: z.literal('Unknown Error'),
		statusCode: z.literal(500),
		cause: z.any(),
	}),
])
type ResendError = z.infer<typeof resendErrorSchema>

const resendSuccessSchema = z.object({
	id: z.string(),
})

const DEFAULT_TIMEOUT_MS = 10_000

// sendEmail returns error results instead of throwing, so nothing upstream
// (entry.server's handleError → console + PostHog) will ever see these
// failures — a provider outage would be invisible until users complain.
// Every error result must pass through here on its way out.
function reportEmailFailure(
	email: { to: string; subject: string },
	error: ResendError,
	cause?: unknown,
) {
	console.error('❌ Email send failed:', {
		to: email.to,
		subject: email.subject,
		name: error.name,
		statusCode: error.statusCode,
		message: error.message,
		cause,
	})
	captureServerEvent('server', 'email_send_failed', {
		name: error.name,
		statusCode: error.statusCode,
	})
}

export async function sendEmail({
	react,
	...options
}: {
	to: string
	subject: string
} & (
	| { html: string; text: string; react?: never }
	| { react: ReactElement; html?: never; text?: never }
)) {
	const from = 'hello@useqm.app'

	const email = {
		from,
		...options,
		...(react ? await renderReactEmail(react) : null),
	}

	// Dev convenience: with no key and no mocks, log the message instead of
	// sending it. Production never reaches this branch — `init()` refuses to
	// boot without the key unless MOCKS === 'true', the same comparison used
	// here and everywhere mocks are installed.
	if (!process.env.RESEND_API_KEY && process.env.MOCKS !== 'true') {
		console.error(`RESEND_API_KEY not set and we're not in mocks mode.`)
		console.error(
			`To send emails, set the RESEND_API_KEY environment variable.`,
		)
		console.error(`Would have sent the following email:`, JSON.stringify(email))
		return {
			status: 'success',
			data: { id: 'mocked' },
		} as const
	}

	// Resend applies no timeout of its own, so a stalled request would keep a
	// signup or password-reset action hanging for as long as the socket lives.
	// init() validates RESEND_TIMEOUT_MS as a positive integer; the guard here
	// also covers callers that never ran init() (tests, scripts), where a bad
	// value would otherwise become AbortSignal.timeout(0) or timeout(NaN).
	const rawTimeout = Number(process.env.RESEND_TIMEOUT_MS)
	const timeoutMs =
		Number.isInteger(rawTimeout) && rawTimeout > 0
			? rawTimeout
			: DEFAULT_TIMEOUT_MS

	let response: Response
	try {
		response = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			body: JSON.stringify(email),
			headers: {
				Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
				'Content-Type': 'application/json',
			},
			signal: AbortSignal.timeout(timeoutMs),
		})
	} catch (error) {
		// Timeout, DNS failure, connection reset. Callers branch on `status`
		// and render `message` as a form error, so keep the message user-safe;
		// the transport detail (undici puts ENOTFOUND etc. on error.cause)
		// goes to the log via reportEmailFailure.
		const timedOut = error instanceof Error && error.name === 'TimeoutError'
		const resendError = {
			name: timedOut ? 'EmailTimeoutError' : 'EmailDeliveryError',
			message: timedOut
				? 'The email request timed out — please try again'
				: 'We could not reach the email service — please try again',
			statusCode: timedOut ? 504 : 502,
		} satisfies ResendError
		reportEmailFailure(email, resendError, error)
		return { status: 'error', error: resendError } as const
	}

	let data: unknown
	try {
		data = await response.json()
	} catch (error) {
		// The request itself completed — an unreadable body is not a delivery
		// failure. On a 2xx Resend has already accepted the message, and
		// reporting failure here would invite a retry that rotates the
		// verification code carried by the email that actually arrived.
		if (response.ok) {
			console.error(
				'⚠️ Email accepted by Resend but the response body was unreadable:',
				error,
			)
			return { status: 'success', data: { id: 'unconfirmed' } } as const
		}
		const resendError = {
			name: 'EmailDeliveryError',
			message: `The email service returned an unexpected response (HTTP ${response.status})`,
			statusCode: response.status,
		} satisfies ResendError
		reportEmailFailure(email, resendError, error)
		return { status: 'error', error: resendError } as const
	}

	const parsedData = resendSuccessSchema.safeParse(data)
	if (response.ok && parsedData.success) {
		return {
			status: 'success',
			data: parsedData,
		} as const
	}

	const parseResult = resendErrorSchema.safeParse(data)
	if (parseResult.success) {
		reportEmailFailure(email, parseResult.data)
		return {
			status: 'error',
			error: parseResult.data,
		} as const
	}
	const unknownError = {
		name: 'UnknownError',
		message: 'Unknown Error',
		statusCode: 500,
		cause: data,
	} satisfies ResendError
	reportEmailFailure(email, unknownError)
	return {
		status: 'error',
		error: unknownError,
	} as const
}

async function renderReactEmail(react: ReactElement) {
	const [html, text] = await Promise.all([
		render(react),
		render(react, { plainText: true }),
	])
	return { html, text }
}
