import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	constructEventAsync: vi.fn(),
	handleCheckoutCompleted: vi.fn(),
	handleInvoicePaid: vi.fn(),
	handleSubscriptionUpdated: vi.fn(),
	handleSubscriptionDeleted: vi.fn(),
	captureServerEvent: vi.fn(),
}))

vi.mock('#app/utils/stripe.server.ts', () => ({
	getStripeClient: () => ({
		webhooks: { constructEventAsync: mocks.constructEventAsync },
	}),
	handleCheckoutCompleted: mocks.handleCheckoutCompleted,
	handleInvoicePaid: mocks.handleInvoicePaid,
	handleSubscriptionUpdated: mocks.handleSubscriptionUpdated,
	handleSubscriptionDeleted: mocks.handleSubscriptionDeleted,
}))

vi.mock('#app/utils/posthog.server.ts', () => ({
	captureServerEvent: mocks.captureServerEvent,
}))

import { action } from './stripe-webhook.tsx'

function webhookRequest() {
	return new Request('https://useqm.app/resources/stripe-webhook', {
		method: 'POST',
		headers: { 'stripe-signature': 'valid-signature' },
		body: '{}',
	})
}

describe('Stripe webhook', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
	})

	test('returns a retryable response when a verified event handler fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		mocks.constructEventAsync.mockResolvedValue({
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_retry',
					client_reference_id: 'user_test',
				},
			},
		})
		mocks.handleCheckoutCompleted.mockRejectedValue(
			new Error('database unavailable'),
		)

		const response = await action({ request: webhookRequest() } as never)

		expect(response.status).toBe(500)
		expect(await response.text()).toBe('Webhook handler failed')
		expect(mocks.handleCheckoutCompleted).toHaveBeenCalledOnce()
	})

	test('still rejects an invalid signature without dispatching an event', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		mocks.constructEventAsync.mockRejectedValue(new Error('bad signature'))

		const response = await action({ request: webhookRequest() } as never)

		expect(response.status).toBe(400)
		expect(await response.text()).toBe('Invalid signature')
		expect(mocks.handleCheckoutCompleted).not.toHaveBeenCalled()
	})

	test('acknowledges a successfully handled verified event', async () => {
		mocks.constructEventAsync.mockResolvedValue({
			type: 'invoice.paid',
			data: { object: { id: 'in_test_success' } },
		})

		const response = await action({ request: webhookRequest() } as never)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('ok')
		expect(mocks.handleInvoicePaid).toHaveBeenCalledOnce()
	})
})
