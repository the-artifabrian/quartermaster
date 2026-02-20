import { prisma } from './db.server.ts'
import { requireUserWithHousehold } from './household.server.ts'
import { FREE_INVENTORY_LIMIT } from './subscription.ts'
import { redirectWithToast } from './toast.server.ts'

export { FREE_INVENTORY_LIMIT }

export type InventoryUsage = {
	count: number
	limit: number | null
	remaining: number | null
	isAtLimit: boolean
}

export async function getInventoryUsage(
	householdId: string,
	isProActive: boolean,
): Promise<InventoryUsage> {
	const count = await prisma.inventoryItem.count({ where: { householdId } })
	if (isProActive) {
		return { count, limit: null, remaining: null, isAtLimit: false }
	}
	const remaining = Math.max(0, FREE_INVENTORY_LIMIT - count)
	return {
		count,
		limit: FREE_INVENTORY_LIMIT,
		remaining,
		isAtLimit: remaining === 0,
	}
}

export type TierInfo = {
	tier: string
	isProActive: boolean
	isTrialing: boolean
	trialEndsAt: Date | null
	subscriptionExpiresAt: Date | null
	hasStripeSubscription: boolean
	proExpiresAt: Date | null
	daysUntilExpiry: number | null
	wasProPreviously: boolean
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
			stripeCustomerId: true,
		},
	})

	if (!subscription) {
		return {
			tier: 'free',
			isProActive: false,
			isTrialing: false,
			trialEndsAt: null,
			subscriptionExpiresAt: null,
			hasStripeSubscription: false,
			proExpiresAt: null,
			daysUntilExpiry: null,
			wasProPreviously: false,
		}
	}

	const now = new Date()

	// Check if trial is still active
	const isTrialing =
		subscription.trialEndsAt !== null && subscription.trialEndsAt > now

	// Pro is active if paid tier is not expired, OR trial is active
	const isPaidActive =
		subscription.tier === 'pro' &&
		(subscription.subscriptionExpiresAt === null ||
			subscription.subscriptionExpiresAt > now)

	const isProActive = isPaidActive || isTrialing

	// Compute effective expiry date — the date when ALL Pro access ends.
	// Indefinite Stripe (no subscriptionExpiresAt) wins over any trial countdown.
	// When both trial and paid have concrete dates, pick the later one.
	let proExpiresAt: Date | null = null
	if (isPaidActive && subscription.subscriptionExpiresAt === null) {
		// Indefinite paid subscription — no expiry regardless of trial
		proExpiresAt = null
	} else if (
		isTrialing &&
		isPaidActive &&
		subscription.trialEndsAt &&
		subscription.subscriptionExpiresAt
	) {
		// Both active with concrete dates — use the later one
		proExpiresAt =
			subscription.trialEndsAt > subscription.subscriptionExpiresAt
				? subscription.trialEndsAt
				: subscription.subscriptionExpiresAt
	} else if (isTrialing && subscription.trialEndsAt) {
		proExpiresAt = subscription.trialEndsAt
	} else if (isPaidActive && subscription.subscriptionExpiresAt) {
		proExpiresAt = subscription.subscriptionExpiresAt
	}

	const daysUntilExpiry =
		proExpiresAt !== null
			? Math.ceil(
					(proExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
				)
			: null

	// User previously had Pro but it lapsed
	const wasProPreviously =
		!isProActive &&
		((subscription.trialEndsAt !== null && subscription.trialEndsAt <= now) ||
			(subscription.subscriptionExpiresAt !== null &&
				subscription.subscriptionExpiresAt <= now))

	return {
		tier: subscription.tier,
		isProActive,
		isTrialing,
		trialEndsAt: subscription.trialEndsAt,
		subscriptionExpiresAt: subscription.subscriptionExpiresAt,
		hasStripeSubscription: Boolean(subscription.stripeCustomerId),
		proExpiresAt,
		daysUntilExpiry,
		wasProPreviously,
	}
}

/**
 * Drop-in replacement for `requireUserWithHousehold` on Pro-only routes.
 * Redirects to /upgrade if the user doesn't have an active Pro subscription.
 */
export async function requireProTier(request: Request) {
	const { userId, householdId, role } = await requireUserWithHousehold(request)
	const tierInfo = await getUserTier(userId)

	if (!tierInfo.isProActive) {
		if (tierInfo.wasProPreviously) {
			throw await redirectWithToast('/upgrade', {
				type: 'message',
				title: 'Pro access ended',
				description:
					'Your data is safe. Subscribe or redeem a code to continue.',
			})
		}
		throw await redirectWithToast('/upgrade', {
			type: 'message',
			title: 'Pro feature',
			description: 'Upgrade to Pro to access this feature.',
		})
	}

	return { userId, householdId, role, ...tierInfo }
}
