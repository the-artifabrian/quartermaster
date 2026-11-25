// Starting a Pro checkout, and coming back from one at
// `/upgrade?session_id=…`.
import { RouterContextProvider } from 'react-router'
import type Stripe from 'stripe'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { getStripeClient } from '#app/utils/stripe.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action, loader } from './upgrade.tsx'
import '#tests/setup/db-setup.ts'

const SERVER_PRICE = 'price_server_yearly'

// Stripe's Node HTTP client never reaches MSW under Vitest (the request
// hangs), so the Checkout Session call is replaced on the client itself.
let checkoutBodies: Array<Stripe.Checkout.SessionCreateParams>

beforeEach(() => {
	vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_upgrade')
	vi.stubEnv('STRIPE_PRO_YEARLY_PRICE_ID', SERVER_PRICE)
	checkoutBodies = []
	vi.spyOn(getStripeClient()!.checkout.sessions, 'create').mockImplementation(
		(async (params: Stripe.Checkout.SessionCreateParams) => {
			checkoutBodies.push(params)
			return { url: 'https://checkout.stripe.com/upgrade-test' }
		}) as never,
	)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

async function signedIn() {
	return prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
		select: { id: true },
	})
}

async function checkout(
	fields: Record<string, string>,
	session?: { id: string },
) {
	const url = new URL(`${BASE_URL}/upgrade`)
	const headers = new Headers({
		'Content-Type': 'application/x-www-form-urlencoded',
	})
	if (session) headers.set('cookie', await getSessionCookieHeader(session))
	const result: unknown = await action({
		request: new Request(url, {
			method: 'POST',
			headers,
			body: new URLSearchParams({ intent: 'checkout', ...fields }).toString(),
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/upgrade',
		url,
	}).catch((error: unknown) => error)
	if (result instanceof Response) {
		return { status: result.status, location: result.headers.get('location') }
	}
	const { init } = result as { init?: { status?: number } }
	return { status: init?.status ?? 200, location: null }
}

const priceSent = () =>
	checkoutBodies.flatMap((body) => body.line_items?.map((item) => item.price))

test('a posted price id is ignored, and checkout uses the configured price', async () => {
	const session = await signedIn()

	const result = await checkout(
		{ plan: 'yearly', priceId: 'price_someone_elses' },
		session,
	)

	expect(result).toEqual({
		status: 302,
		location: 'https://checkout.stripe.com/upgrade-test',
	})
	expect(priceSent()).toEqual([SERVER_PRICE])
})

test('a page cached before plans existed, posting only a price id, gets the configured price', async () => {
	const session = await signedIn()

	const result = await checkout({ priceId: 'price_someone_elses' }, session)

	expect(result.status).toBe(302)
	expect(priceSent()).toEqual([SERVER_PRICE])
})

test('a plan the server does not offer is refused before Stripe is asked', async () => {
	const session = await signedIn()

	for (const plan of ['monthly', 'price_someone_elses', '']) {
		const result = await checkout({ plan }, session)
		expect(result.status, plan).toBe(400)
	}
	expect(checkoutBodies).toEqual([])
})

test('checkout is refused when no price is configured', async () => {
	vi.stubEnv('STRIPE_PRO_YEARLY_PRICE_ID', '')
	const session = await signedIn()

	const result = await checkout({ plan: 'yearly' }, session)

	expect(result.status).toBe(400)
	expect(checkoutBodies).toEqual([])
})

test('a visitor who is not signed in is sent to log in', async () => {
	const result = await checkout({ plan: 'yearly' })

	expect(result).toEqual({
		status: 302,
		location: '/login?redirectTo=/upgrade',
	})
	expect(checkoutBodies).toEqual([])
})

test('the upgrade page does not hand the price id to the browser', async () => {
	const session = await signedIn()
	const url = new URL(`${BASE_URL}/upgrade`)

	const data = await loader({
		request: new Request(url, {
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/upgrade',
		url,
	})

	expect(data).not.toBeInstanceOf(Response)
	expect((data as { stripeConfigured: boolean }).stripeConfigured).toBe(true)
	expect(JSON.stringify(data)).not.toContain(SERVER_PRICE)
})

async function returnFromCheckout(
	session: { id: string },
	checkoutSession: Partial<Stripe.Checkout.Session>,
) {
	const stripe = getStripeClient()!
	const retrieved: string[] = []
	vi.spyOn(stripe.checkout.sessions, 'retrieve').mockImplementation((async (
		id: string,
	) => {
		retrieved.push(id)
		return { id, ...checkoutSession }
	}) as never)
	vi.spyOn(stripe.subscriptions, 'retrieve').mockImplementation((async () => ({
		items: { data: [{ price: { id: SERVER_PRICE }, current_period_end: 2e9 }] },
	})) as never)
	const url = new URL(`${BASE_URL}/upgrade?session_id=cs_test_return`)
	await loader({
		request: new Request(url, {
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/upgrade',
		url,
	}).catch((error: unknown) => error)
	return retrieved
}

async function subscriptionOf(userId: string) {
	return prisma.subscription.findUnique({
		where: { userId },
		select: { tier: true, stripeCustomerId: true },
	})
}

test("a paid checkout that names another user changes no one's subscription", async () => {
	const session = await signedIn()
	const { userId } = await prisma.session.findUniqueOrThrow({
		where: { id: session.id },
		select: { userId: true },
	})
	const other = await prisma.user.create({ data: createUser() })

	await returnFromCheckout(session, {
		payment_status: 'paid',
		client_reference_id: other.id,
		customer: 'cus_return',
		subscription: 'sub_return',
	})

	expect(await subscriptionOf(userId)).toBeNull()
	expect(await subscriptionOf(other.id)).toBeNull()
})

test("a demo user's paid checkout leaves the demo's subscription as it is", async () => {
	const demo = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: {
				create: {
					...createUser(),
					demoExpiresAt: new Date(Date.now() + 3_600_000),
					subscription: { create: { tier: 'pro' } },
				},
			},
		},
		select: { id: true, userId: true },
	})

	const retrieved = await returnFromCheckout(demo, {
		payment_status: 'paid',
		client_reference_id: demo.userId,
		customer: 'cus_demo_return',
		subscription: 'sub_demo_return',
	})

	expect(retrieved).toEqual([])
	expect(await subscriptionOf(demo.userId)).toEqual({
		tier: 'pro',
		stripeCustomerId: null,
	})
})

test('a real user back from their own paid checkout is made Pro', async () => {
	const session = await signedIn()
	const { userId } = await prisma.session.findUniqueOrThrow({
		where: { id: session.id },
		select: { userId: true },
	})

	await returnFromCheckout(session, {
		payment_status: 'paid',
		client_reference_id: userId,
		customer: 'cus_real_return',
		subscription: 'sub_real_return',
	})

	expect(await subscriptionOf(userId)).toEqual({
		tier: 'pro',
		stripeCustomerId: 'cus_real_return',
	})
})
