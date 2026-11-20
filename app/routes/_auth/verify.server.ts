import { type Submission } from '@conform-to/react'
import { parseWithZod } from '@conform-to/zod/v4'
import { data } from 'react-router'
import { z } from 'zod'
import { handleVerification as handleChangeEmailVerification } from '#app/routes/settings/profile/change-email.server.tsx'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import { getAppOrigin } from '#app/utils/app-origin.server.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { pagePathOf } from '#app/utils/page-path.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { generateTOTP, verifyTOTP } from '#app/utils/totp.server.ts'
import { type twoFAVerifyVerificationType } from '../settings/profile/two-factor/verify.tsx'
import {
	handleVerification as handleLoginTwoFactorVerification,
	shouldRequestTwoFA,
} from './login.server.ts'
import { handleVerification as handleOnboardingVerification } from './onboarding/index.server.ts'
import { handleVerification as handleResetPasswordVerification } from './reset-password.server.ts'
import {
	VerifySchema,
	codeQueryParam,
	redirectToQueryParam,
	targetQueryParam,
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
			title: 'Please Reverify',
			description: 'Please reverify your account before proceeding',
		})
	}
}

export async function prepareVerification({
	period,
	type,
	target,
	redirectTo: destination,
}: {
	period: number
	type: VerificationTypes
	target: string
	redirectTo?: string
}) {
	const verifyUrl = getRedirectToUrl({
		type,
		target,
		redirectTo: destination,
	})
	// Where the browser goes next. Relative, so it stays on the host it used
	// and keeps its cookies; only the emailed link needs APP_ORIGIN.
	const redirectTo = pathAndSearch(verifyUrl)

	const { otp, ...verificationConfig } = await generateTOTP({
		algorithm: 'SHA-256',
		// Leaving off 0, O, and I on purpose to avoid confusing users.
		charSet: 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789',
		period,
	})
	const verificationData = {
		type,
		target,
		...verificationConfig,
		expiresAt: new Date(Date.now() + verificationConfig.period * 1000),
	}
	await prisma.verification.upsert({
		where: { target_type: { target, type } },
		create: verificationData,
		update: verificationData,
	})

	// add the otp to the url we'll email the user.
	verifyUrl.searchParams.set(codeQueryParam, otp)

	return { otp, redirectTo, verifyUrl }
}

export async function isCodeValid({
	code,
	type,
	target,
}: {
	code: string
	type: VerificationTypes | typeof twoFAVerifyVerificationType
	target: string
}) {
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

export async function validateRequest(
	request: Request,
	body: URLSearchParams | FormData,
) {
	const submission = await parseWithZod(body, {
		schema: VerifySchema.superRefine(async (data, ctx) => {
			const codeIsValid = await isCodeValid({
				code: data[codeQueryParam],
				type: data[typeQueryParam],
				target: data[targetQueryParam],
			})
			if (!codeIsValid) {
				ctx.addIssue({
					path: ['code'],
					code: z.ZodIssueCode.custom,
					message: `Invalid code`,
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

	const { value: submissionValue } = submission

	async function deleteVerification() {
		await prisma.verification.delete({
			where: {
				target_type: {
					type: submissionValue[typeQueryParam],
					target: submissionValue[targetQueryParam],
				},
			},
		})
	}

	switch (submissionValue[typeQueryParam]) {
		case 'reset-password': {
			await deleteVerification()
			return handleResetPasswordVerification({ request, body, submission })
		}
		case 'onboarding': {
			await deleteVerification()
			return handleOnboardingVerification({ request, body, submission })
		}
		case 'change-email': {
			// Its handler consumes the code itself, after the checks that can
			// send the user to reverify and back with the same code.
			return handleChangeEmailVerification({ request, body, submission })
		}
		case '2fa': {
			return handleLoginTwoFactorVerification({ request, body, submission })
		}
	}
}
