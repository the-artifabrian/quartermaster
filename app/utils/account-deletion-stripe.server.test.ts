// Failure list for cancelling Pro when an account is deleted:
// - the user has a live Stripe subscription: Stripe is asked to cancel that
//   subscription, by the id the local row held before the delete removed it,
//   and only once the account is gone
// - the delete itself fails: Stripe is never asked, so nobody is left with an
//   account whose Pro was cancelled under them
// - Stripe refuses or errors: the account is still deleted, and the failure
//   is logged and captured with the subscription id, so it can be cancelled
//   by hand
// - Stripe hangs: the request has a short timeout and at most one retry, so
//   the delete doesn't wait out Stripe's defaults (80 seconds a try, retried
//   twice, since a timeout counts as a reason to retry)
// - no Subscription row, or one with no Stripe subscription (a trial, or one
//   Stripe already ended): Stripe is never asked
// - Stripe isn't configured but the row names a subscription: the account is
//   still deleted, and the failure is logged and captured
// - a member of a shared Household deletes: only their own subscription is
//   cancelled, never the remaining member's
import type Stripe from 'stripe'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import type * as WriteTransactionModule from '#app/utils/write-transaction.server.ts'
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

const failingDelete = vi.hoisted(() => ({ on: false }))
vi.mock('#app/utils/write-transaction.server.ts', async (importOriginal) => {
	const original = await importOriginal<typeof WriteTransactionModule>()
	return {
		...original,
		writeTransaction: ((
			...args: Parameters<typeof original.writeTransaction>
		) => {
			if (failingDelete.on) throw new Error('The delete failed')
			return original.writeTransaction(...args)
		}) as typeof original.writeTransaction,
	}
})

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
	failingDelete.on = false
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

test('a live subscription is cancelled with Stripe once the account is gone', async () => {
	const user = await userWithSubscription('sub_live_one')
	const goneWhenCancelled: Array<boolean> = []
	cancel.mockImplementation(async (id: string) => {
		goneWhenCancelled.push(await userGone(user.id))
		return { id, status: 'canceled' }
	})

	await deleteAccount(user.id)

	expect(cancel.mock.calls.map(([id]) => id)).toEqual(['sub_live_one'])
	expect(goneWhenCancelled).toEqual([true])
})

test('a delete that fails leaves the subscription alone', async () => {
	const user = await userWithSubscription('sub_kept')
	failingDelete.on = true

	await expect(deleteAccount(user.id)).rejects.toThrow('The delete failed')

	expect(cancel).not.toHaveBeenCalled()
	expect(await userGone(user.id)).toBe(false)
})

test('a hung Stripe holds the delete for seconds, not minutes', async () => {
	const user = await userWithSubscription('sub_live_two')

	await deleteAccount(user.id)

	const [, , options] = cancel.mock.calls[0]!
	const tries = (options?.maxNetworkRetries ?? 2) + 1
	expect(options?.timeout).toBeGreaterThan(0)
	expect(tries * options?.timeout).toBeLessThanOrEqual(12_000)
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
