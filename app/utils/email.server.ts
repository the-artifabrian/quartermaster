import { render } from '@react-email/components'
import { type ReactElement } from 'react'
import { z } from 'zod'

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
	// boot without the key, precisely so this silence can't ship.
	if (!process.env.RESEND_API_KEY && !process.env.MOCKS) {
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
	const timeoutMs = Number(process.env.RESEND_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)

	try {
		const response = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			body: JSON.stringify(email),
			headers: {
				Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
				'Content-Type': 'application/json',
			},
			signal: AbortSignal.timeout(timeoutMs),
		})
		const data = await response.json()
		const parsedData = resendSuccessSchema.safeParse(data)

		if (response.ok && parsedData.success) {
			return {
				status: 'success',
				data: parsedData,
			} as const
		} else {
			const parseResult = resendErrorSchema.safeParse(data)
			if (parseResult.success) {
				return {
					status: 'error',
					error: parseResult.data,
				} as const
			} else {
				return {
					status: 'error',
					error: {
						name: 'UnknownError',
						message: 'Unknown Error',
						statusCode: 500,
						cause: data,
					} satisfies ResendError,
				} as const
			}
		}
	} catch (error) {
		// Timeout, DNS failure, connection reset, unparseable body. Callers all
		// branch on `status`, so report it as an error result rather than
		// throwing an exception they don't expect.
		const timedOut = error instanceof Error && error.name === 'TimeoutError'
		return {
			status: 'error',
			error: {
				name: timedOut ? 'EmailTimeoutError' : 'EmailDeliveryError',
				message: timedOut
					? `Email request timed out after ${timeoutMs}ms`
					: `Email request failed: ${error instanceof Error ? error.message : String(error)}`,
				statusCode: timedOut ? 504 : 502,
			} satisfies ResendError,
		} as const
	}
}

async function renderReactEmail(react: ReactElement) {
	const [html, text] = await Promise.all([
		render(react),
		render(react, { plainText: true }),
	])
	return { html, text }
}
