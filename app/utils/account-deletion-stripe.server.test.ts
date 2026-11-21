// Failure list for cancelling Pro when an account is deleted:
// - the user has a live Stripe subscription: Stripe is asked to cancel that
//   subscription, by the id the local row held before the delete removed it,
//   and the account is deleted
// - Stripe refuses or errors: the account is still deleted, and the failure
//   is logged and captured with the subscription id, so it can be cancelled
//   by hand
// - Stripe hangs: the request has a short timeout, so the delete doesn't wait
//   on Stripe's default of 80 seconds
// - no Subscription row, or one with no Stripe subscription (a trial, or one
//   Stripe already ended): Stripe is never asked
// - Stripe isn't configured but the row names a subscription: the account is
//   still deleted, and the failure is logged and captured
// - a member of a shared Household deletes: only their own subscription is
//   cancelled, never the remaining member's
import type Stripe from 'stripe'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { captureServerEvent } from '#app/utils/posthog.server.ts'
import { getStripeClient } from '#app/utils/stripe.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { deleteAccount } from './account-deletion.server.ts'
import '#tests/setup/db-setup.ts'

vi.mock('#app/utils/posthog.server.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	captureServerEvent: vi.fn(),
}))

// Stripe's Node HTTP client never reaches MSW under Vitest (the request
// hangs), so the cancel call is replaced on the client itself.
let cancel: ReturnType<typeof vi.fn>

beforeEach(() => {
	vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_account_deletion')
	cancel = vi.fn(async (id: string) => ({ id, status: 'canceled' }))
	vi.spyOn(getStripeClient()!.subscriptions, 'cancel').mockImplementation(
		cancel as unknown as Stripe['subscriptions']['cancel'],
	)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	vi.mocked(captureServerEvent).mockClear()
})

async function userWithSubscription(stripeSubscriptionId: string | null) {
	const user = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})
	await prisma.subscription.create({
		data: {
			userId: user.id,
			tier: stripeSubscriptionId ? 'pro' : 'free',
			stripeCustomerId: `cus_${user.id}`,
			stripeSubscriptionId,
			subscriptionExpiresAt: new Date(Date.now() + 30 * 86_400_000),
		},
	})
	return user
}

const userGone = async (userId: string) =>
	(await prisma.user.findUnique({ where: { id: userId } })) === null

test('a live subscription is cancelled with Stripe, and the account is deleted', async () => {
	const user = await userWithSubscription('sub_live_one')

	await deleteAccount(user.id)

	expect(cancel.mock.calls.map(([id]) => id)).toEqual(['sub_live_one'])
	expect(await userGone(user.id)).toBe(true)
})

test('the cancel request has a short timeout', async () => {
	const user = await userWithSubscription('sub_live_two')

	await deleteAccount(user.id)

	const [, , options] = cancel.mock.calls[0]!
	expect(options?.timeout).toBeGreaterThan(0)
	expect(options?.timeout).toBeLessThanOrEqual(15_000)
})

test('a Stripe failure still deletes the account, and is logged and captured', async () => {
	consoleError.mockImplementation(() => {})
	cancel.mockRejectedValue(new Error('Stripe is down'))
	const user = await userWithSubscription('sub_stripe_down')

	await deleteAccount(user.id)

	expect(await userGone(user.id)).toBe(true)
	expect(consoleError).toHaveBeenCalledWith(
		expect.stringContaining('sub_stripe_down'),
		expect.any(Error),
	)
	expect(captureServerEvent).toHaveBeenCalledWith(
		'server',
		'stripe_cancel_failed',
		expect.objectContaining({ subscription_id: 'sub_stripe_down' }),
	)
})

test('without Stripe configured, the account is still deleted and the leftover subscription logged', async () => {
	vi.stubEnv('STRIPE_SECRET_KEY', '')
	consoleError.mockImplementation(() => {})
	const user = await userWithSubscription('sub_no_stripe')

	await deleteAccount(user.id)

	expect(await userGone(user.id)).toBe(true)
	expect(cancel).not.toHaveBeenCalled()
	expect(captureServerEvent).toHaveBeenCalledWith(
		'server',
		'stripe_cancel_failed',
		expect.objectContaining({ subscription_id: 'sub_no_stripe' }),
	)
})

test('no Stripe subscription means Stripe is never asked', async () => {
	const trial = await userWithSubscription(null)
	const plain = await prisma.user.create({
		data: createUser(),
		select: { id: true },
	})

	await deleteAccount(trial.id)
	await deleteAccount(plain.id)

	expect(cancel).not.toHaveBeenCalled()
	expect(await userGone(trial.id)).toBe(true)
	expect(await userGone(plain.id)).toBe(true)
})

test("a member deleting cancels only their own subscription, not the remaining member's", async () => {
	const leaving = await userWithSubscription('sub_leaving')
	const staying = await userWithSubscription('sub_staying')
	await prisma.household.create({
		data: {
			name: 'Shared Household',
			members: {
				create: [
					{ userId: staying.id, role: 'owner' },
					{ userId: leaving.id, role: 'member' },
				],
			},
		},
	})

	await deleteAccount(leaving.id)

	expect(cancel.mock.calls.map(([id]) => id)).toEqual(['sub_leaving'])
	expect(
		await prisma.subscription.findUnique({
			where: { userId: staying.id },
			select: { stripeSubscriptionId: true },
		}),
	).toEqual({ stripeSubscriptionId: 'sub_staying' })
})
