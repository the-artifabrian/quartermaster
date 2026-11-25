import { type Submission } from '@conform-to/react'
import { parseWithZod } from '@conform-to/zod/v4'
import { data } from 'react-router'
import { z } from 'zod'
import { handleVerification as handleChangeEmailVerification } from '#app/routes/settings/profile/change-email.server.tsx'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import { getAppOrigin } from '#app/utils/app-origin.server.ts'
import { getBrowserSession, requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	checkEmailCode,
	consumeEmailCode,
	isEmailCodeType,
	issueEmailCode,
	type EmailCodeType,
	type IssueResult,
} from '#app/utils/email-code.server.ts'
import { pagePathOf } from '#app/utils/page-path.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { verifyTOTP } from '#app/utils/totp.server.ts'
import { type twoFAVerifyVerificationType } from '../settings/profile/two-factor/verify.tsx'
import {
	endPendingSignIn,
	findPendingSignIn,
	handleVerification as handleLoginTwoFactorVerification,
	MAX_PENDING_SIGN_IN_TRIES,
	shouldRequestTwoFA,
	takePendingSignInTry,
} from './login.server.ts'
import { handleVerification as handleOnboardingVerification } from './onboarding/index.server.ts'
import { handleVerification as handleResetPasswordVerification } from './reset-password.server.ts'
import {
	VerifySchema,
	codeQueryParam,
	redirectToQueryParam,
	targetQueryParam,
	tokenQueryParam,
	typeQueryParam,
	type VerificationTypes,
} from './verify.tsx'

export type VerifyFunctionArgs = {
	request: Request
	submission: Submission<
		z.input<typeof VerifySchema>,
		string[],
		z.output<typeof VerifySchema>
	>
	body: FormData | URLSearchParams
}

export function getRedirectToUrl({
	type,
	target,
	redirectTo,
}: {
	type: VerificationTypes
	target: string
	redirectTo?: string
}) {
	const redirectToUrl = new URL(`${getAppOrigin()}/verify`)
	redirectToUrl.searchParams.set(typeQueryParam, type)
	redirectToUrl.searchParams.set(targetQueryParam, target)
	if (redirectTo) {
		redirectToUrl.searchParams.set(redirectToQueryParam, redirectTo)
	}
	return redirectToUrl
}

function pathAndSearch(url: URL) {
	return `${url.pathname}${url.search}`
}

export async function requireRecentVerification(request: Request) {
	const userId = await requireUserId(request)
	const shouldReverify = await shouldRequestTwoFA(request)
	if (shouldReverify) {
		const redirectUrl = getRedirectToUrl({
			target: userId,
			type: twoFAVerificationType,
			// A client navigation asks for the page's data; come back to the page.
			redirectTo: pagePathOf(new URL(request.url)),
		})
		throw await redirectWithToast(pathAndSearch(redirectUrl), {
			title: 'Confirm it’s you',
			description: 'Enter the code from your 2FA app to carry on.',
		})
	}
}

/**
 * The canonical target for an emailed code, or null when there is none. A
 * reset is keyed by the account's id, whichever of its id, username or email
 * was given, so every way of naming one account shares one set of codes and
 * one cap. A signup is keyed by the address as the account will store it.
 */
export async function emailCodeTarget(type: EmailCodeType, target: string) {
	switch (type) {
		case 'onboarding':
			return target.trim().toLowerCase()
		case 'reset-password': {
			const name = target.trim().toLowerCase()
			const user = await prisma.user.findFirst({
				where: { OR: [{ id: target }, { username: name }, { email: name }] },
				select: { id: true },
			})
			return user?.id ?? null
		}
		case 'change-email':
			return target
	}
}

/**
 * Makes an emailed code and hands it, with the verify link, to `send`. The
 * code works only once `send` reports success; a failed send leaves no code,
 * and the target's earlier codes keep working either way. Past the cap of
 * live codes nothing is made or sent (`status: 'capped'`).
 *
 * `target` must already be canonical (see emailCodeTarget). `address` is
 * where an email-change code goes, and the address it will set.
 */
export async function prepareVerification({
	type,
	target,
	address,
	redirectTo: destination,
	send,
}: {
	type: EmailCodeType
	target: string
	address?: string
	redirectTo?: string
	send: (email: {
		otp: string
		verifyUrl: URL
	}) => Promise<
		{ status: 'success' } | { status: 'error'; error: { message: string } }
	>
}): Promise<{ redirectTo: string } & IssueResult> {
	const verifyUrl = getRedirectToUrl({
		type,
		target,
		redirectTo: destination,
	})
	// Where the browser goes next. Relative, so it stays on the host it used
	// and keeps its cookies; only the emailed link needs APP_ORIGIN.
	const redirectTo = pathAndSearch(verifyUrl)

	const result = await issueEmailCode({
		type,
		target,
		address,
		send: ({ code, token }) => {
			// The link carries its own token, never the typed code.
			const link = new URL(verifyUrl)
			link.searchParams.set(tokenQueryParam, token)
			return send({ otp: code, verifyUrl: link })
		},
	})
	return { redirectTo, ...result }
}

/**
 * Whether `code` is the user's current authenticator code. Only for 2FA:
 * emailed codes are checked with checkEmailCode, and an emailed type here is
 * refused rather than looked up.
 */
export async function isCodeValid({
	code,
	type,
	target,
}: {
	code: string
	type: typeof twoFAVerificationType | typeof twoFAVerifyVerificationType
	target: string
}) {
	if (type !== twoFAVerificationType && type !== '2fa-verify') return false
	const verification = await prisma.verification.findUnique({
		where: {
			target_type: { target, type },
			OR: [{ expiresAt: { gt: new Date() } }, { expiresAt: null }],
		},
		select: { algorithm: true, secret: true, period: true, charSet: true },
	})
	if (!verification) return false
	const result = await verifyTOTP({
		otp: code,
		...verification,
	})
	if (!result) return false

	return true
}

/**
 * For a signed-in email change or a signup, where saying so gives nothing
 * away: no email went out because the target already holds the most live
 * codes it can.
 */
export const NO_NEW_EMAIL_TOAST = {
	title: 'No new email sent',
	description:
		"You've asked for a few codes in the last 10 minutes. The ones we already sent still work.",
}

const invalidCode = (submission: {
	reply: (options: { fieldErrors: Record<string, string[]> }) => unknown
}) =>
	data(
		{ result: submission.reply({ fieldErrors: { code: ['Invalid code'] } }) },
		{ status: 400 },
	)

/** Why a 2FA code sends the browser back to log in, without being checked. */
type LogInAgain = 'nothing-pending' | 'ended' | 'too-many-tries'

const logInAgainToasts: Record<
	LogInAgain,
	{ title: string; description: string }
> = {
	'nothing-pending': {
		title: 'Log in again',
		description: 'No login is waiting for this code. Log in and try again.',
	},
	ended: {
		title: 'Login expired',
		description: 'Log in again, then enter the code from your app.',
	},
	'too-many-tries': {
		title: 'Too many wrong codes',
		description: 'Log in again, then enter the code from your app.',
	},
}

export async function validateRequest(
	request: Request,
	body: URLSearchParams | FormData,
) {
	let logInAgain: LogInAgain | null = null
	const submission = await parseWithZod(body, {
		schema: VerifySchema.transform(async (data, ctx) => {
			const type = data[typeQueryParam]
			const code = data[codeQueryParam]
			const invalid = () => {
				ctx.addIssue({
					path: [codeQueryParam],
					code: 'custom',
					// Only the link was sent, so say what to do instead.
					message:
						code === undefined && data[tokenQueryParam]
							? `This link didn't work. Type the code from the email instead.`
							: `Invalid code`,
				})
				return z.NEVER
			}
			// Each kind of code is checked only by its own path: an emailed
			// type never reaches the authenticator check, and 2FA never
			// reaches the emailed codes.
			if (isEmailCodeType(type)) {
				const target = await emailCodeTarget(type, data[targetQueryParam])
				if (target === null) return invalid()
				const match = await checkEmailCode({
					type,
					target,
					code,
					token: data[tokenQueryParam],
				})
				if (!match) return invalid()
				// Handlers get the target the code was stored under.
				return { ...data, [targetQueryParam]: target }
			}
			if (type !== twoFAVerificationType || !code) return invalid()
			// A 2FA code can finish this browser's pending sign-in or reverify
			// its signed-in session, and nothing else. For any other target
			// the answer doesn't depend on the code, so it isn't checked.
			const target = data[targetQueryParam]
			const pending = await findPendingSignIn(request)
			const forPending = pending.status === 'live' && pending.userId === target
			if (!forPending) {
				const signedInAs = (await getBrowserSession(request))?.userId
				if (signedInAs !== target) {
					if (!signedInAs && pending.status !== 'live') {
						logInAgain =
							pending.status === 'ended' ? 'ended' : 'nothing-pending'
					}
					return invalid()
				}
			}
			// Only someone with the password can start a sign-in, so a cap on
			// its tries can't lock the owner out.
			const tries = forPending ? await takePendingSignInTry(pending) : 0
			if (forPending && tries > MAX_PENDING_SIGN_IN_TRIES) {
				await endPendingSignIn(pending.id)
				logInAgain = 'too-many-tries'
				return invalid()
			}
			const codeIsValid = await isCodeValid({ code, type, target })
			if (!codeIsValid) {
				if (forPending && tries >= MAX_PENDING_SIGN_IN_TRIES) {
					await endPendingSignIn(pending.id)
					logInAgain = 'too-many-tries'
				}
				return invalid()
			}
			return data
		}),
		async: true,
	})

	// Set inside the schema's transform, which TypeScript can't follow.
	const reason = logInAgain as LogInAgain | null
	if (reason) {
		const verifySession = await verifySessionStorage.getSession(
			request.headers.get('cookie'),
		)
		return redirectWithToast(
			'/login',
			{ type: 'error', ...logInAgainToasts[reason] },
			reason === 'nothing-pending'
				? undefined
				: {
						headers: {
							'set-cookie':
								await verifySessionStorage.destroySession(verifySession),
						},
					},
		)
	}

	if (submission.status !== 'success') {
		return data(
			{ result: submission.reply() },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}

	const { value: submissionValue } = submission
	const args = { request, body, submission }

	// Uses the code now. Of two submits of the same code only one gets here.
	function consume(type: 'onboarding' | 'reset-password') {
		return consumeEmailCode({
			type,
			target: submissionValue[targetQueryParam],
			code: submissionValue[codeQueryParam],
			token: submissionValue[tokenQueryParam],
		})
	}

	switch (submissionValue[typeQueryParam]) {
		case 'reset-password': {
			if (!(await consume('reset-password'))) return invalidCode(submission)
			return handleResetPasswordVerification(args)
		}
		case 'onboarding': {
			// Signing up needs a logged-out browser. Say so before the code is
			// used, so it still works after logging out.
			const loggedInAs = (await getBrowserSession(request))?.username
			if (loggedInAs) {
				return data({ result: submission.reply(), loggedInAs }, { status: 409 })
			}
			if (!(await consume('onboarding'))) return invalidCode(submission)
			return handleOnboardingVerification(args)
		}
		case 'change-email': {
			// Its handler uses the code itself, after the checks that can send
			// the user to reverify and back with the same code.
			return handleChangeEmailVerification(args)
		}
		case '2fa': {
			return handleLoginTwoFactorVerification(args)
		}
	}
}
