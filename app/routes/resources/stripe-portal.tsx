import { redirect } from 'react-router'
import { getAppOrigin } from '#app/utils/app-origin.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createPortalSession } from '#app/utils/stripe.server.ts'
import { type Route } from './+types/stripe-portal.ts'

/**
 * POST-only route that creates a Stripe Customer Portal session
 * and redirects the user to it. Requires authentication.
 */
export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)

	const subscription = await prisma.subscription.findUnique({
		where: { userId },
		select: { stripeCustomerId: true },
	})

	if (!subscription?.stripeCustomerId) {
		return redirect('/upgrade')
	}

	const origin = getAppOrigin()
	const portalSession = await createPortalSession({
		stripeCustomerId: subscription.stripeCustomerId,
		returnUrl: `${origin}/upgrade`,
	})

	return redirect(portalSession.url)
}
