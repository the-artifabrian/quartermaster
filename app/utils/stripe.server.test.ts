import { describe, expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	getSubscriptionTierFromPriceId,
	handleCheckoutCompleted,
	handleInvoicePaid,
	handleSubscriptionDeleted,
	handleSubscriptionUpdated,
} from './stripe.server.ts'

const mockPeriodEnd = Math.floor(Date.now() / 1000) + 30 * 86400

/** Mock retriever that mimics stripe.subscriptions.retrieve */
const mockRetrieveSubscription = async () => ({
	id: 'sub_test_123',
	items: {
		data: [
			{
				price: { id: 'price_pro_yearly_test' },
				current_period_end: mockPeriodEnd,
			},
		],
	},
})

async function setupUser() {
	return prisma.user.create({ data: createUser() })
}

describe('getSubscriptionTierFromPriceId', () => {
	test('returns pro for any price ID', () => {
		expect(getSubscriptionTierFromPriceId('price_random')).toBe('pro')
		expect(getSubscriptionTierFromPriceId('price_yearly_test')).toBe('pro')
	})
})

describe('handleCheckoutCompleted', () => {
	test('creates subscription for new user', async () => {
		const user = await setupUser()

		await handleCheckoutCompleted(
			{
				client_reference_id: user.id,
				subscription: 'sub_test_123',
				customer: 'cus_test_456',
				payment_status: 'paid',
			} as any,
			mockRetrieveSubscription,
		)

		const subscription = await prisma.subscription.findUnique({
			where: { userId: user.id },
		})
		expect(subscription).toBeTruthy()
		expect(subscription!.tier).toBe('pro')
		expect(subscription!.stripeCustomerId).toBe('cus_test_456')
		expect(subscription!.stripeSubscriptionId).toBe('sub_test_123')
		expect(subscription!.subscriptionExpiresAt).toBeTruthy()
	})

	test('updates existing subscription', async () => {
		const user = await setupUser()
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'free',
				trialEndsAt: new Date(Date.now() + 7 * 86400 * 1000),
			},
		})

		await handleCheckoutCompleted(
			{
				client_reference_id: user.id,
				subscription: 'sub_test_789',
				customer: 'cus_test_abc',
				payment_status: 'paid',
			} as any,
			mockRetrieveSubscription,
		)

		const subscription = await prisma.subscription.findUnique({
			where: { userId: user.id },
		})
		expect(subscription!.tier).toBe('pro')
		expect(subscription!.stripeCustomerId).toBe('cus_test_abc')
		expect(subscription!.stripeSubscriptionId).toBe('sub_test_789')
		// Trial should still be there (not cleared)
		expect(subscription!.trialEndsAt).toBeTruthy()
	})

	test('ignores session without client_reference_id', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			await handleCheckoutCompleted(
				{
					client_reference_id: null,
					subscription: 'sub_test_123',
					customer: 'cus_test_456',
				} as any,
				mockRetrieveSubscription,
			)
			expect(consoleError).toHaveBeenCalledWith(
				'Checkout session missing client_reference_id',
			)
		} finally {
			consoleError.mockRestore()
		}
	})
})

describe('handleInvoicePaid', () => {
	test('updates subscription expiry', async () => {
		const user = await setupUser()
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				stripeCustomerId: 'cus_invoice_test',
				stripeSubscriptionId: 'sub_test_123',
				subscriptionExpiresAt: new Date(Date.now() - 86400 * 1000),
			},
		})

		await handleInvoicePaid(
			{
				parent: {
					subscription_details: {
						subscription: 'sub_test_123',
					},
				},
			} as any,
			mockRetrieveSubscription,
		)

		const subscription = await prisma.subscription.findUnique({
			where: { userId: user.id },
		})
		// Should be updated to a future date (from mock period end)
		expect(subscription!.subscriptionExpiresAt!.getTime()).toBeGreaterThan(
			Date.now(),
		)
	})

	test('ignores invoice for unknown subscription', async () => {
		await handleInvoicePaid(
			{
				parent: {
					subscription_details: {
						subscription: 'sub_unknown_999',
					},
				},
			} as any,
			mockRetrieveSubscription,
		)
		// Should not throw
	})
})

describe('handleSubscriptionUpdated', () => {
	test('syncs tier and period end', async () => {
		const user = await setupUser()

		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				stripeCustomerId: 'cus_update_test',
				stripeSubscriptionId: 'sub_update_123',
			},
		})

		const newPeriodEnd = Math.floor(Date.now() / 1000) + 30 * 86400

		await handleSubscriptionUpdated({
			id: 'sub_update_123',
			items: {
				data: [
					{
						price: { id: 'price_pro_yearly' },
						current_period_end: newPeriodEnd,
					},
				],
			},
		} as any)

		const subscription = await prisma.subscription.findUnique({
			where: { userId: user.id },
		})
		expect(subscription!.tier).toBe('pro')
		expect(subscription!.subscriptionExpiresAt!.getTime()).toBeGreaterThan(
			Date.now(),
		)
	})
})

describe('handleSubscriptionDeleted', () => {
	test('downgrades to free and clears stripe fields', async () => {
		const user = await setupUser()
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				stripeCustomerId: 'cus_delete_test',
				stripeSubscriptionId: 'sub_delete_123',
				subscriptionExpiresAt: new Date(Date.now() + 30 * 86400 * 1000),
			},
		})

		await handleSubscriptionDeleted({
			id: 'sub_delete_123',
		} as any)

		const subscription = await prisma.subscription.findUnique({
			where: { userId: user.id },
		})
		expect(subscription!.tier).toBe('free')
		expect(subscription!.stripeSubscriptionId).toBeNull()
		expect(subscription!.subscriptionExpiresAt).toBeNull()
		// stripeCustomerId should be preserved for future resubscription
		expect(subscription!.stripeCustomerId).toBe('cus_delete_test')
	})

	test('ignores deletion for unknown subscription', async () => {
		await handleSubscriptionDeleted({
			id: 'sub_unknown_999',
		} as any)
		// Should not throw
	})
})
