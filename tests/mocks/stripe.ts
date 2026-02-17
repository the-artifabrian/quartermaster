import { HttpResponse, http, type HttpHandler } from 'msw'

const { json } = HttpResponse

const passthroughStripe =
	!process.env.STRIPE_SECRET_KEY?.startsWith('MOCK_') &&
	process.env.NODE_ENV !== 'test'

export const handlers: Array<HttpHandler> = [
	http.post(
		'https://api.stripe.com/v1/checkout/sessions',
		async ({ request }) => {
			if (passthroughStripe) return HttpResponse.error()

			const body = await request.text()
			const params = new URLSearchParams(body)
			const clientReferenceId = params.get('client_reference_id')

			return json({
				id: 'cs_test_mock_session',
				object: 'checkout.session',
				url: 'https://checkout.stripe.com/mock-session',
				payment_status: 'unpaid',
				client_reference_id: clientReferenceId,
				customer: 'cus_mock_customer',
				subscription: 'sub_mock_subscription',
				mode: 'subscription',
			})
		},
	),

	http.get(
		'https://api.stripe.com/v1/checkout/sessions/:id',
		async ({ params }) => {
			if (passthroughStripe) return HttpResponse.error()

			return json({
				id: params.id,
				object: 'checkout.session',
				payment_status: 'paid',
				client_reference_id: 'mock_user_id',
				customer: 'cus_mock_customer',
				subscription: 'sub_mock_subscription',
				mode: 'subscription',
			})
		},
	),

	http.post('https://api.stripe.com/v1/billing_portal/sessions', async () => {
		if (passthroughStripe) return HttpResponse.error()

		return json({
			id: 'bps_mock_portal',
			object: 'billing_portal.session',
			url: 'https://billing.stripe.com/mock-portal',
		})
	}),

	http.get('https://api.stripe.com/v1/subscriptions/:id', async () => {
		if (passthroughStripe) return HttpResponse.error()

		const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600
		return json({
			id: 'sub_mock_subscription',
			object: 'subscription',
			status: 'active',
			current_period_end: periodEnd,
			items: {
				data: [
					{
						price: {
							id: 'price_mock_pro_monthly',
							product: 'prod_mock_pro',
						},
						current_period_end: periodEnd,
					},
				],
			},
			customer: 'cus_mock_customer',
		})
	}),
]
