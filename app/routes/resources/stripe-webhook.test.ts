import Stripe from 'stripe'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	handleCheckoutCompleted: vi.fn(),
	handleInvoicePaid: vi.fn(),
	handleSubscriptionUpdated: vi.fn(),
	handleSubscriptionDeleted: vi.fn(),
	captureServerEvent: vi.fn(),
}))

// A real client, so the route's signature check runs the SDK's own
// verification against the bytes and secret the route hands it.
vi.mock('#app/utils/stripe.server.ts', async () => {
	const { default: StripeSdk } = await import('stripe')
	const stripe = new StripeSdk('sk_test_webhook')
	return {
		// Only the async check: Node's Stripe build allows the sync
		// constructEvent, but the worker build Bun loads in production throws.
		getStripeClient: () => ({
			webhooks: {
				constructEventAsync: (
					...args: Parameters<typeof stripe.webhooks.constructEventAsync>
				) => stripe.webhooks.constructEventAsync(...args),
			},
		}),
		handleCheckoutCompleted: mocks.handleCheckoutCompleted,
		handleInvoicePaid: mocks.handleInvoicePaid,
		handleSubscriptionUpdated: mocks.handleSubscriptionUpdated,
		handleSubscriptionDeleted: mocks.handleSubscriptionDeleted,
	}
})

vi.mock('#app/utils/posthog.server.ts', () => ({
	captureServerEvent: mocks.captureServerEvent,
}))

import { action } from './stripe-webhook.tsx'

const WEBHOOK_SECRET = 'whsec_test'
const sdk = new Stripe('sk_test_signer')

/**
 * A delivery signed the way Stripe signs it. The body is pretty-printed like
 * Stripe's, so a route that re-serializes it no longer matches the signature.
 */
async function signedWebhookRequest(
	event: { type: string; data: { object: Record<string, unknown> } },
	{ secret = WEBHOOK_SECRET }: { secret?: string } = {},
) {
	const payload = JSON.stringify(
		{ id: 'evt_test', object: 'event', ...event },
		null,
		2,
	)
	const signature = await sdk.webhooks.generateTestHeaderStringAsync({
		payload,
		secret,
	})
	return new Request('https://useqm.app/resources/stripe-webhook', {
		method: 'POST',
		headers: { 'stripe-signature': signature },
		body: payload,
	})
}

describe('Stripe webhook', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
	})

	test('returns a retryable response when a verified event handler fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		mocks.handleCheckoutCompleted.mockRejectedValue(
			new Error('database unavailable'),
		)

		const response = await action({
			request: await signedWebhookRequest({
				type: 'checkout.session.completed',
				data: {
					object: {
						id: 'cs_test_retry',
						client_reference_id: 'user_test',
					},
				},
			}),
		} as never)

		expect(response.status).toBe(500)
		expect(await response.text()).toBe('Webhook handler failed')
		expect(mocks.handleCheckoutCompleted).toHaveBeenCalledOnce()
	})

	test('still rejects an invalid signature without dispatching an event', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})

		const response = await action({
			request: await signedWebhookRequest(
				{
					type: 'checkout.session.completed',
					data: {
						object: { id: 'cs_test_forged', client_reference_id: 'user_x' },
					},
				},
				{ secret: 'whsec_someone_else' },
			),
		} as never)

		expect(response.status).toBe(400)
		expect(await response.text()).toBe('Invalid signature')
		expect(mocks.handleCheckoutCompleted).not.toHaveBeenCalled()
	})

	test('acknowledges a successfully handled verified event', async () => {
		const response = await action({
			request: await signedWebhookRequest({
				type: 'invoice.paid',
				data: { object: { id: 'in_test_success' } },
			}),
		} as never)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('ok')
		expect(mocks.handleInvoicePaid).toHaveBeenCalledOnce()
	})
})
