import { redirect } from 'react-router'
import { prisma } from './db.server.ts'
import { requireUserWithHousehold } from './household.server.ts'

export type TierInfo = {
	tier: string
	isProActive: boolean
	isTrialing: boolean
	trialEndsAt: Date | null
}

/**
 * Queries the Subscription table and returns the user's current tier status.
 * Missing Subscription record → free, not active.
 */
export async function getUserTier(userId: string): Promise<TierInfo> {
	const subscription = await prisma.subscription.findUnique({
		where: { userId },
		select: {
			tier: true,
			trialEndsAt: true,
			subscriptionExpiresAt: true,
		},
	})

	if (!subscription) {
		return { tier: 'free', isProActive: false, isTrialing: false, trialEndsAt: null }
	}

	const now = new Date()

	// Check if trial is still active
	const isTrialing =
		subscription.trialEndsAt !== null && subscription.trialEndsAt > now

	// Pro is active if paid tier is not expired, OR trial is active
	const isPaidActive =
		(subscription.tier === 'pro' || subscription.tier === 'household') &&
		(subscription.subscriptionExpiresAt === null ||
			subscription.subscriptionExpiresAt > now)

	const isProActive = isPaidActive || isTrialing

	return {
		tier: subscription.tier,
		isProActive,
		isTrialing,
		trialEndsAt: subscription.trialEndsAt,
	}
}

/**
 * Drop-in replacement for `requireUserWithHousehold` on Pro-only routes.
 * Redirects to /upgrade if the user doesn't have an active Pro subscription.
 */
export async function requireProTier(request: Request) {
	const { userId, householdId, role } =
		await requireUserWithHousehold(request)
	const tierInfo = await getUserTier(userId)

	if (!tierInfo.isProActive) {
		throw redirect('/upgrade')
	}

	return { userId, householdId, role, ...tierInfo }
}
