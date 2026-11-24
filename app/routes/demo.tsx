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
import { DEMO_STARTED } from '#app/utils/posthog-events.ts'
import { captureServerEvent } from '#app/utils/posthog.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { getRequestToday } from '#app/utils/today.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { type Route } from './+types/demo.ts'

/**
 * "Try the demo" posts here with no `intent` and gets a demo user of its own
 * (see createDemoCopy). The demo banner's "Sign up" posts `intent=end` with
 * `redirectTo=/signup`: the demo user goes at once, and the browser arrives
 * signed out, since /signup sends signed-in users away.
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
		// The cookie goes even when its session was already dead, or
		// /signup would send the visitor home to clear it.
		return redirect(redirectTo, {
			headers: await endSessionCookies(request),
		})
	}
	if (intent !== null) return redirect('/')

	if (userId) return redirect(APP_HOME)

	const copy = await createDemoCopy(prisma, {
		today: getRequestToday(request),
	})
	if (!copy.ok) {
		return redirectWithToast(redirectTo, {
			type: 'error',
			description:
				copy.reason === 'full'
					? 'The demo is full right now. Try again in a few minutes.'
					: 'The demo isn’t available right now.',
		})
	}
	captureServerEvent(copy.userId, DEMO_STARTED)
	return redirect(APP_HOME, { headers: await startDemoSession(request, copy) })
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
	{ userId }: { userId: string },
) {
	const user = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: { demoExpiresAt: true },
	})
	const session = await prisma.session.create({
		data: { userId, expirationDate: user.demoExpiresAt! },
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
