import Stripe from 'stripe'
import { prisma } from './db.server.ts'

let stripeClient: Stripe | null = null

/**
 * Returns the Stripe client singleton, or null if STRIPE_SECRET_KEY is not set.
 * Lazy-initialized on first call.
 */
export function getStripeClient(): Stripe | null {
	if (!process.env.STRIPE_SECRET_KEY) return null
	if (!stripeClient) {
		stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
			typescript: true,
		})
	}
	return stripeClient
}

/**
 * Whether Stripe is configured (price IDs are set).
 */
export function isStripeConfigured(): boolean {
	return Boolean(
		process.env.STRIPE_SECRET_KEY &&
			process.env.STRIPE_PRO_MONTHLY_PRICE_ID &&
			process.env.STRIPE_PRO_YEARLY_PRICE_ID,
	)
}

/**
 * Maps a Stripe Price ID to a subscription tier.
 */
export function getSubscriptionTierFromPriceId(
	priceId: string,
): 'pro' | 'household' {
	if (
		priceId === process.env.STRIPE_HOUSEHOLD_MONTHLY_PRICE_ID ||
		priceId === process.env.STRIPE_HOUSEHOLD_YEARLY_PRICE_ID
	) {
		return 'household'
	}
	return 'pro'
}

/**
 * Extracts the period end date from a Stripe Subscription.
 * In Stripe API v2025+, current_period_end is on SubscriptionItem, not Subscription.
 */
function getPeriodEndFromSubscription(
	subscription: Stripe.Subscription,
): Date {
	const periodEnd = subscription.items.data[0]?.current_period_end
	if (!periodEnd) {
		// Fallback: 30 days from now
		return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
	}
	return new Date(periodEnd * 1000)
}

/**
 * Creates a Stripe Checkout Session for a subscription purchase.
 */
export async function createCheckoutSession({
	userId,
	priceId,
	returnUrl,
}: {
	userId: string
	priceId: string
	returnUrl: string
}): Promise<Stripe.Checkout.Session> {
	const stripe = getStripeClient()
	if (!stripe) throw new Error('Stripe is not configured')

	// Look up existing Stripe customer ID for this user
	const subscription = await prisma.subscription.findUnique({
		where: { userId },
		select: { stripeCustomerId: true },
	})

	const sessionParams: Stripe.Checkout.SessionCreateParams = {
		mode: 'subscription',
		line_items: [{ price: priceId, quantity: 1 }],
		success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: returnUrl,
		client_reference_id: userId,
		automatic_tax: { enabled: true },
	}

	if (subscription?.stripeCustomerId) {
		sessionParams.customer = subscription.stripeCustomerId
	}

	return stripe.checkout.sessions.create(sessionParams)
}

/**
 * Creates a Stripe Customer Portal session for subscription management.
 */
export async function createPortalSession({
	stripeCustomerId,
	returnUrl,
}: {
	stripeCustomerId: string
	returnUrl: string
}): Promise<Stripe.BillingPortal.Session> {
	const stripe = getStripeClient()
	if (!stripe) throw new Error('Stripe is not configured')

	return stripe.billingPortal.sessions.create({
		customer: stripeCustomerId,
		return_url: returnUrl,
	})
}

type SubscriptionRetriever = (
	id: string,
) => Promise<{ items: { data: Array<{ price: { id: string }; current_period_end: number }> } }>

function defaultRetrieveSubscription(): SubscriptionRetriever {
	return async (id: string) => {
		const stripe = getStripeClient()
		if (!stripe) throw new Error('Stripe is not configured')
		return stripe.subscriptions.retrieve(id) as any
	}
}

/**
 * Handles checkout.session.completed webhook event.
 * Links the Stripe customer to the user and sets their tier.
 * Accepts an optional retrieveSubscription for testing.
 */
export async function handleCheckoutCompleted(
	session: Stripe.Checkout.Session,
	retrieveSubscription?: SubscriptionRetriever,
) {
	const userId = session.client_reference_id
	if (!userId) {
		console.error('Checkout session missing client_reference_id')
		return
	}

	const subscriptionId =
		typeof session.subscription === 'string'
			? session.subscription
			: session.subscription?.id
	if (!subscriptionId) {
		console.error('Checkout session missing subscription')
		return
	}

	const customerId =
		typeof session.customer === 'string'
			? session.customer
			: session.customer?.id
	if (!customerId) {
		console.error('Checkout session missing customer')
		return
	}

	const retrieve = retrieveSubscription ?? defaultRetrieveSubscription()
	const stripeSubscription = await retrieve(subscriptionId)
	const priceId = stripeSubscription.items.data[0]?.price.id
	if (!priceId) {
		console.error('Subscription missing price ID')
		return
	}

	const tier = getSubscriptionTierFromPriceId(priceId)
	const periodEnd = stripeSubscription.items.data[0]?.current_period_end
	const expiresAt = periodEnd
		? new Date(periodEnd * 1000)
		: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

	await prisma.subscription.upsert({
		where: { userId },
		create: {
			userId,
			tier,
			stripeCustomerId: customerId,
			stripeSubscriptionId: subscriptionId,
			subscriptionExpiresAt: expiresAt,
		},
		update: {
			tier,
			stripeCustomerId: customerId,
			stripeSubscriptionId: subscriptionId,
			subscriptionExpiresAt: expiresAt,
		},
	})
}

/**
 * Handles invoice.paid webhook event.
 * Updates subscriptionExpiresAt from the subscription's current_period_end.
 */
export async function handleInvoicePaid(
	invoice: Stripe.Invoice,
	retrieveSubscription?: SubscriptionRetriever,
) {
	const subRef = invoice.parent?.subscription_details?.subscription
	const subscriptionId =
		typeof subRef === 'string' ? subRef : subRef?.id
	if (!subscriptionId) return

	const retrieve = retrieveSubscription ?? defaultRetrieveSubscription()
	const stripeSubscription = await retrieve(subscriptionId)
	const periodEnd = stripeSubscription.items.data[0]?.current_period_end
	const expiresAt = periodEnd
		? new Date(periodEnd * 1000)
		: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

	const existing = await prisma.subscription.findUnique({
		where: { stripeSubscriptionId: subscriptionId },
	})
	if (!existing) return

	await prisma.subscription.update({
		where: { stripeSubscriptionId: subscriptionId },
		data: { subscriptionExpiresAt: expiresAt },
	})
}

/**
 * Handles customer.subscription.updated webhook event.
 * Syncs tier changes (upgrade/downgrade between Pro and Household).
 */
export async function handleSubscriptionUpdated(
	subscription: Stripe.Subscription,
) {
	const existing = await prisma.subscription.findUnique({
		where: { stripeSubscriptionId: subscription.id },
	})
	if (!existing) return

	const priceId = subscription.items.data[0]?.price.id
	if (!priceId) return

	const tier = getSubscriptionTierFromPriceId(priceId)
	const periodEnd = getPeriodEndFromSubscription(subscription)

	await prisma.subscription.update({
		where: { stripeSubscriptionId: subscription.id },
		data: {
			tier,
			subscriptionExpiresAt: periodEnd,
		},
	})
}

/**
 * Handles customer.subscription.deleted webhook event.
 * Downgrades user to free tier and clears Stripe fields.
 */
export async function handleSubscriptionDeleted(
	subscription: Stripe.Subscription,
) {
	const existing = await prisma.subscription.findUnique({
		where: { stripeSubscriptionId: subscription.id },
	})
	if (!existing) return

	await prisma.subscription.update({
		where: { stripeSubscriptionId: subscription.id },
		data: {
			tier: 'free',
			stripeSubscriptionId: null,
			subscriptionExpiresAt: null,
		},
	})
}

/**
 * Looks up a user by their Stripe customer ID.
 */
export async function getUserByStripeCustomerId(customerId: string) {
	const subscription = await prisma.subscription.findUnique({
		where: { stripeCustomerId: customerId },
		select: { userId: true },
	})
	return subscription?.userId ?? null
}
