import { invariant } from '@epic-web/invariant'
import { data, redirect } from 'react-router'
import { safeRedirect } from '#app/utils/safe-redirect.ts'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { getUserId, sessionKey } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { combineResponseInits } from '#app/utils/misc.tsx'
import { shouldRememberSession } from '#app/utils/native-shell.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { writeTransaction } from '#app/utils/write-transaction.server.ts'
import { getRedirectToUrl, type VerifyFunctionArgs } from './verify.server.ts'

const verifiedTimeKey = 'verified-time'
const unverifiedSessionIdKey = 'unverified-session-id'
const rememberKey = 'remember'

/** How long a 2FA sign-in waits for its code, like an emailed code. */
export const PENDING_SIGN_IN_LIFETIME_MS = 10 * 60 * 1000
/** Codes a pending 2FA sign-in takes before it ends. */
export const MAX_PENDING_SIGN_IN_TRIES = 5

type PendingSignIn =
	| { status: 'none' }
	| { status: 'ended' }
	| {
			status: 'live'
			id: string
			userId: string
			expirationDate: Date
			createdAt: Date
	  }

/**
 * The 2FA sign-in this browser's verify cookie holds. Its age comes from the
 * Session row, which a kept copy of the cookie can't change. One older than
 * 10 minutes is deleted and counts as `ended`, like one whose row has gone.
 */
export async function findPendingSignIn(
	request: Request,
): Promise<PendingSignIn> {
	const verifySession = await verifySessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const id = verifySession.get(unverifiedSessionIdKey)
	if (typeof id !== 'string' || !id) return { status: 'none' }
	const session = await prisma.session.findUnique({
		select: { userId: true, expirationDate: true, createdAt: true },
		where: { id },
	})
	if (!session) return { status: 'ended' }
	if (Date.now() - session.createdAt.getTime() > PENDING_SIGN_IN_LIFETIME_MS) {
		await endPendingSignIn(id)
		return { status: 'ended' }
	}
	return { status: 'live', id, ...session }
}

/**
 * The UsageEvent type that counts codes tried against one pending sign-in.
 * Kept in the database, so a restart doesn't hand a pending sign-in 5 more.
 */
function signInTryType(pendingId: string) {
	return `2fa-sign-in-try:${pendingId}`
}

/**
 * Counts one code tried against a pending sign-in and returns how many it
 * has had, this one included. Counted before the code is checked, so codes
 * sent at once can't share a count. A sign-in that has already ended counts
 * as over the cap, so a request that read its row just before another one
 * ended it can't start again from 1.
 *
 * Each try is a UsageEvent row whose `createdAt` is when the pending sign-in
 * runs out. The nightly prune drops usage rows from before today began, so
 * that keeps a sign-in started just before midnight from losing its tries.
 */
export async function takePendingSignInTry(
	pending: { id: string; userId: string; createdAt: Date },
	db: PrismaClient = prisma,
) {
	const type = signInTryType(pending.id)
	return writeTransaction(db, async (tx) => {
		const live = await tx.session.count({ where: { id: pending.id } })
		if (!live) return Infinity
		await tx.usageEvent.create({
			data: {
				type,
				userId: pending.userId,
				createdAt: new Date(
					pending.createdAt.getTime() + PENDING_SIGN_IN_LIFETIME_MS,
				),
			},
		})
		return tx.usageEvent.count({ where: { type } })
	})
}

/** Deletes a pending sign-in's Session row, so its code can't finish it. */
export async function endPendingSignIn(id: string) {
	await prisma.$transaction([
		prisma.session.deleteMany({ where: { id } }),
		prisma.usageEvent.deleteMany({ where: { type: signInTryType(id) } }),
	])
}

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
		const cookie = request.headers.get('cookie')
		const authSession = await authSessionStorage.getSession(cookie)
		authSession.set(sessionKey, session.id)
		const headers = new Headers()
		headers.append(
			'set-cookie',
			await authSessionStorage.commitSession(authSession, {
				expires: remember ? session.expirationDate : undefined,
			}),
		)
		// A 2FA sign-in someone started on this browser and walked away from
		// would otherwise outlive this one. The 2FA branch above replaces the
		// whole verify cookie, so this one drops it too.
		const verifySession = await verifySessionStorage.getSession(cookie)
		if (verifySession.has(unverifiedSessionIdKey)) {
			headers.append(
				'set-cookie',
				await verifySessionStorage.destroySession(verifySession),
			)
		}

		return redirect(
			safeRedirect(redirectTo, '/recipes'),
			combineResponseInits({ headers }, responseInit),
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

	const found = await findPendingSignIn(request)
	const pending = found.status === 'live' ? found : null
	if (pending?.userId === target) {
		// The signed-in session gets a new id, so the pending one stops
		// existing and a kept copy of the verify cookie names nothing.
		const signedIn = await prisma.$transaction(async (tx) => {
			const { count } = await tx.session.deleteMany({
				where: { id: pending.id },
			})
			if (count !== 1) return null
			await tx.usageEvent.deleteMany({
				where: { type: signInTryType(pending.id) },
			})
			return tx.session.create({
				select: { id: true },
				data: {
					userId: pending.userId,
					expirationDate: pending.expirationDate,
				},
			})
		})
		if (!signedIn) throw await noSessionToVerify()
		authSession.set(verifiedTimeKey, Date.now())
		authSession.set(sessionKey, signedIn.id)

		headers.append(
			'set-cookie',
			await authSessionStorage.commitSession(authSession, {
				expires: remember ? pending.expirationDate : undefined,
			}),
		)
		headers.append(
			'set-cookie',
			await verifySessionStorage.destroySession(verifySession),
		)
	} else {
		// A reverify of the signed-in session. A sign-in someone else left
		// pending on this browser doesn't stand in its way.
		const userId = await getUserId(request)
		if (!userId) {
			// The code isn't the pending sign-in's; with nothing pending, e.g.
			// the verify cookie expired, there is nothing to verify.
			if (pending) return invalidCode()
			throw await noSessionToVerify()
		}
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
	const userId = await getUserId(request)
	if (!userId) return false
	const authSession = await authSessionStorage.getSession(
		request.headers.get('cookie'),
	)
	// Only this user's own pending sign-in counts. One someone else started
	// on a shared browser could never be finished by this user.
	const pending = await findPendingSignIn(request)
	if (pending.status === 'live' && pending.userId === userId) return true
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
