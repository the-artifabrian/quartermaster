import { invariant } from '@epic-web/invariant'
import { data, redirect } from 'react-router'
import { safeRedirect } from 'remix-utils/safe-redirect'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import { getUserId, sessionKey } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { combineResponseInits } from '#app/utils/misc.tsx'
import { shouldRememberSession } from '#app/utils/native-shell.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { getRedirectToUrl, type VerifyFunctionArgs } from './verify.server.ts'

const verifiedTimeKey = 'verified-time'
const unverifiedSessionIdKey = 'unverified-session-id'
const rememberKey = 'remember'

export async function handleNewSession(
	{
		request,
		session,
		redirectTo,
		remember,
	}: {
		request: Request
		session: { userId: string; id: string; expirationDate: Date }
		redirectTo?: string
		remember: boolean
	},
	responseInit?: ResponseInit,
) {
	// The 2FA path carries this value through the verify session to
	// handleVerification.
	remember = shouldRememberSession(request, remember)
	const verification = await prisma.verification.findUnique({
		select: { id: true },
		where: {
			target_type: { target: session.userId, type: twoFAVerificationType },
		},
	})
	const userHasTwoFactor = Boolean(verification)

	if (userHasTwoFactor) {
		const verifySession = await verifySessionStorage.getSession()
		verifySession.set(unverifiedSessionIdKey, session.id)
		verifySession.set(rememberKey, remember)
		const redirectUrl = getRedirectToUrl({
			type: twoFAVerificationType,
			target: session.userId,
			redirectTo,
		})
		return redirect(
			`${redirectUrl.pathname}?${redirectUrl.searchParams}`,
			combineResponseInits(
				{
					headers: {
						'set-cookie':
							await verifySessionStorage.commitSession(verifySession),
					},
				},
				responseInit,
			),
		)
	} else {
		const authSession = await authSessionStorage.getSession(
			request.headers.get('cookie'),
		)
		authSession.set(sessionKey, session.id)

		return redirect(
			safeRedirect(redirectTo, '/recipes'),
			combineResponseInits(
				{
					headers: {
						'set-cookie': await authSessionStorage.commitSession(authSession, {
							expires: remember ? session.expirationDate : undefined,
						}),
					},
				},
				responseInit,
			),
		)
	}
}

export async function handleVerification({
	request,
	submission,
}: VerifyFunctionArgs) {
	invariant(
		submission.status === 'success',
		'Submission should be successful by now',
	)
	const authSession = await authSessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const verifySession = await verifySessionStorage.getSession(
		request.headers.get('cookie'),
	)

	const remember = verifySession.get(rememberKey)
	const { redirectTo, target } = submission.value
	const headers = new Headers()

	// The code was checked against `target`. It may only verify that user's
	// pending sign-in, or that user's own signed-in session.
	const invalidCode = () =>
		data(
			{ result: submission.reply({ fieldErrors: { code: ['Invalid code'] } }) },
			{ status: 400 },
		)

	const noSessionToVerify = () =>
		redirectWithToast('/login', {
			type: 'error',
			title: 'Invalid session',
			description: 'Could not find session to verify. Please try again.',
		})

	const unverifiedSessionId = verifySession.get(unverifiedSessionIdKey)
	if (unverifiedSessionId) {
		const session = await prisma.session.findUnique({
			select: { expirationDate: true, userId: true },
			where: { id: unverifiedSessionId },
		})
		if (!session) throw await noSessionToVerify()
		if (session.userId !== target) return invalidCode()
		authSession.set(verifiedTimeKey, Date.now())
		authSession.set(sessionKey, unverifiedSessionId)

		headers.append(
			'set-cookie',
			await authSessionStorage.commitSession(authSession, {
				expires: remember ? session.expirationDate : undefined,
			}),
		)
		headers.append(
			'set-cookie',
			await verifySessionStorage.destroySession(verifySession),
		)
	} else {
		// Signed out with no sign-in pending, e.g. the verify cookie expired.
		const userId = await getUserId(request)
		if (!userId) throw await noSessionToVerify()
		if (userId !== target) return invalidCode()
		authSession.set(verifiedTimeKey, Date.now())
		// The verify cookie stays: a reverify can interrupt another
		// verification, such as a change of email, that still needs it.
		headers.append(
			'set-cookie',
			await authSessionStorage.commitSession(authSession),
		)
	}

	return redirect(safeRedirect(redirectTo, '/recipes'), { headers })
}

export async function shouldRequestTwoFA(request: Request) {
	const authSession = await authSessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const verifySession = await verifySessionStorage.getSession(
		request.headers.get('cookie'),
	)
	if (verifySession.has(unverifiedSessionIdKey)) return true
	const userId = await getUserId(request)
	if (!userId) return false
	// if it's over two hours since they last verified, we should request 2FA again
	const userHasTwoFA = await prisma.verification.findUnique({
		select: { id: true },
		where: { target_type: { target: userId, type: twoFAVerificationType } },
	})
	if (!userHasTwoFA) return false
	const verifiedTime = authSession.get(verifiedTimeKey) ?? new Date(0)
	const twoHours = 1000 * 60 * 60 * 2
	return Date.now() - verifiedTime > twoHours
}
