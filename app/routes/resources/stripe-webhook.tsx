import type Stripe from 'stripe'
import {
	getStripeClient,
	handleCheckoutCompleted,
	handleInvoicePaid,
	handleSubscriptionUpdated,
	handleSubscriptionDeleted,
} from '#app/utils/stripe.server.ts'
import { type Route } from './+types/stripe-webhook.ts'

/**
 * Stripe webhook endpoint. No session auth — uses Stripe signature verification.
 * Always returns 200 if signature is valid (even if handler errors) to avoid retries.
 */
export async function action({ request }: Route.ActionArgs) {
	const stripe = getStripeClient()
	if (!stripe) {
		return new Response('Stripe not configured', { status: 503 })
	}

	const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
	if (!webhookSecret) {
		return new Response('Webhook secret not configured', { status: 503 })
	}

	const signature = request.headers.get('stripe-signature')
	if (!signature) {
		return new Response('Missing stripe-signature header', { status: 400 })
	}

	// Critical: signature verification requires unmodified body bytes
	const rawBody = await request.text()

	let event
	try {
		event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
	} catch (err) {
		console.error('Stripe webhook signature verification failed:', err)
		return new Response('Invalid signature', { status: 400 })
	}

	try {
		switch (event.type) {
			case 'checkout.session.completed': {
				await handleCheckoutCompleted(
					event.data.object as Stripe.Checkout.Session,
				)
				break
			}
			case 'invoice.paid': {
				await handleInvoicePaid(event.data.object as Stripe.Invoice)
				break
			}
			case 'invoice.payment_failed': {
				const invoice = event.data.object as Stripe.Invoice
				console.warn(
					'Stripe invoice payment failed:',
					invoice.id,
					'customer:',
					invoice.customer,
				)
				break
			}
			case 'customer.subscription.updated': {
				await handleSubscriptionUpdated(
					event.data.object as Stripe.Subscription,
				)
				break
			}
			case 'customer.subscription.deleted': {
				await handleSubscriptionDeleted(
					event.data.object as Stripe.Subscription,
				)
				break
			}
			default: {
				// Unhandled event type — ignore
			}
		}
	} catch (err) {
		// Log but still return 200 to avoid Stripe retrying
		console.error(`Stripe webhook handler error for ${event.type}:`, err)
	}

	return new Response('ok', { status: 200 })
}
