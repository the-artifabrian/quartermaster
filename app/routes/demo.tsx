import { redirect } from 'react-router'
import { safeRedirect } from '#app/utils/safe-redirect.ts'
import {
	endSessionCookies,
	getBrowserSession,
	sessionKey,
} from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createDemoCopy, endDemoUser } from '#app/utils/demo.server.ts'
import { isDemoUser } from '#app/utils/demo.ts'
import { takeDemoStart } from '#app/utils/demo-start-limit.server.ts'
import { DEMO_STARTED } from '#app/utils/posthog-events.ts'
import { captureServerEvent } from '#app/utils/posthog.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { getRequestToday } from '#app/utils/today.server.ts'
import { reportServerError } from '#app/utils/report-server-error.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { type Route } from './+types/demo.ts'

/**
 * "Try the demo" posts here with no `intent` and gets a demo user of its own
 * (see createDemoCopy). The demo banner's "Sign up" posts `intent=end` with
 * `redirectTo=/signup`: the demo user goes at once, and the browser arrives
 * signed out, since /signup sends signed-in users away.
 *
 * Starts have a limit per client of their own (demo-start-limit.server.ts),
 * which ends never touch. Its refusal says so, since unlike a full demo it
 * can last up to an hour. The route is on the strong rate limit tier, so
 * starts don't use up the client's sign-in attempts.
 */

/** Where a demo starts, as after any sign-in. */
const APP_HOME = '/recipes'

export async function loader() {
	return redirect('/')
}

export async function action({ request }: Route.ActionArgs) {
	const formData = await request.formData().catch(() => null)
	const intent = formData?.get('intent') ?? null
	const redirectTo = safeRedirect(formData?.get('redirectTo'), '/')
	// Unlike getUserId, this doesn't send a dead session home: a visitor
	// whose last demo ran out still gets a new one in one tap.
	const browserSession = await getBrowserSession(request)
	const userId = browserSession?.userId ?? null

	if (intent === 'end') {
		if (!browserSession) return redirect(redirectTo)
		if (userId) {
			const user = await prisma.user.findUnique({
				where: { id: userId },
				select: { demoExpiresAt: true },
			})
			// A real user has no demo to end.
			if (user && !isDemoUser(user)) return redirect(redirectTo)
			await endDemoUser(userId)
		}
		// Deleting the user takes its sessions with it. When the delete
		// failed (and expiry is left to do it), the session row still goes,
		// so a kept copy of the cookie can't sign in.
		await prisma.session
			.deleteMany({ where: { id: browserSession.id } })
			.catch(() => {})
		// The cookie goes even when its session was already dead, or
		// /signup would send the visitor home to clear it.
		return redirect(redirectTo, {
			headers: await endSessionCookies(request),
		})
	}
	if (intent !== null) return redirect('/')

	if (userId) return redirect(APP_HOME)

	// Counted before the copy, so refusals count too. Ends never do.
	if (!takeDemoStart(request)) return refuse(redirectTo, 'start-limit')

	let copy: Awaited<ReturnType<typeof createDemoCopy>>
	try {
		copy = await createDemoCopy(prisma, { today: getRequestToday(request) })
	} catch (error) {
		reportServerError(error, request)
		return refuse(redirectTo, 'unavailable')
	}
	if (!copy.ok) return refuse(redirectTo, copy.reason)

	let headers: Headers
	try {
		headers = await startDemoSession(request, copy)
	} catch (error) {
		reportServerError(error, request)
		// createDemoCopy committed the user; it mustn't hold a live slot
		// for a demo nobody got.
		await endDemoUser(copy.userId)
		return refuse(redirectTo, 'unavailable')
	}
	captureServerEvent(copy.userId, DEMO_STARTED, { is_demo: true })
	return redirect(APP_HOME, { headers })
}

const REFUSALS = {
	full: 'The demo is full right now. Try again in a few minutes.',
	'start-limit': 'You’ve started the demo a few times. Try again in an hour.',
	unavailable: 'The demo isn’t available right now.',
}

/** Back to the page the visitor came from, with why there's no demo. */
function refuse(redirectTo: string, reason: keyof typeof REFUSALS) {
	return redirectWithToast(redirectTo, {
		type: 'error',
		description: REFUSALS[reason],
	})
}

/**
 * A session that ends with the demo: its expirationDate is the user's
 * `demoExpiresAt`, so getUserId stops honouring it then, before expiry gets
 * to the user. The cookie never gets an Expires, in the iOS app too, where
 * sign-ins are otherwise always remembered: a demo isn't meant to survive
 * closing the browser. A demo user has no 2FA, so this skips that step.
 */
async function startDemoSession(
	request: Request,
	{ userId, demoExpiresAt }: { userId: string; demoExpiresAt: Date },
) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: demoExpiresAt },
		select: { id: true },
	})
	// A fresh cookie: commitSession keeps any `expires` an earlier
	// remembered cookie on this browser stored.
	const authSession = await authSessionStorage.getSession()
	authSession.set(sessionKey, session.id)
	const headers = new Headers()
	headers.append(
		'set-cookie',
		await authSessionStorage.commitSession(authSession),
	)
	// A 2FA sign-in someone left pending on this browser doesn't carry over.
	headers.append(
		'set-cookie',
		await verifySessionStorage.destroySession(
			await verifySessionStorage.getSession(request.headers.get('cookie')),
		),
	)
	return headers
}
