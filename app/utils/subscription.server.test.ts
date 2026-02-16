import { describe, expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getUserTier } from './subscription.server.ts'

async function setupUser() {
	const user = await prisma.user.create({ data: createUser() })
	return user
}

describe('getUserTier', () => {
	test('returns free tier when no Subscription record exists', async () => {
		const user = await setupUser()
		const tier = await getUserTier(user.id)

		expect(tier.tier).toBe('free')
		expect(tier.isProActive).toBe(false)
		expect(tier.isTrialing).toBe(false)
		expect(tier.trialEndsAt).toBeNull()
	})

	test('returns pro active when trial is still active', async () => {
		const user = await setupUser()
		const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'free',
				trialEndsAt: futureDate,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.tier).toBe('free')
		expect(tier.isProActive).toBe(true)
		expect(tier.isTrialing).toBe(true)
		expect(tier.trialEndsAt).toEqual(futureDate)
	})

	test('returns not pro when trial has expired', async () => {
		const user = await setupUser()
		const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // 1 day ago
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'free',
				trialEndsAt: pastDate,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.tier).toBe('free')
		expect(tier.isProActive).toBe(false)
		expect(tier.isTrialing).toBe(false)
	})

	test('returns pro active for tier=pro with no expiry', async () => {
		const user = await setupUser()
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.tier).toBe('pro')
		expect(tier.isProActive).toBe(true)
		expect(tier.isTrialing).toBe(false)
	})

	test('returns not pro when subscription has expired', async () => {
		const user = await setupUser()
		const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				subscriptionExpiresAt: pastDate,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.tier).toBe('pro')
		expect(tier.isProActive).toBe(false)
		expect(tier.isTrialing).toBe(false)
	})

	test('returns pro active for household tier', async () => {
		const user = await setupUser()
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'household',
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.tier).toBe('household')
		expect(tier.isProActive).toBe(true)
		expect(tier.isTrialing).toBe(false)
	})

	test('expired subscription with active trial is still pro', async () => {
		const user = await setupUser()
		const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
		const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				subscriptionExpiresAt: pastDate,
				trialEndsAt: futureDate,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.isProActive).toBe(true)
		expect(tier.isTrialing).toBe(true)
	})

	test('Stripe-subscribed user with no trial is pro', async () => {
		const user = await setupUser()
		const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				stripeCustomerId: 'cus_test_stripe',
				stripeSubscriptionId: 'sub_test_stripe',
				subscriptionExpiresAt: futureDate,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.tier).toBe('pro')
		expect(tier.isProActive).toBe(true)
		expect(tier.hasStripeSubscription).toBe(true)
		expect(tier.isTrialing).toBe(false)
		expect(tier.subscriptionExpiresAt).toEqual(futureDate)
	})

	test('Stripe subscription expired returns not pro', async () => {
		const user = await setupUser()
		const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				stripeCustomerId: 'cus_test_expired',
				stripeSubscriptionId: 'sub_test_expired',
				subscriptionExpiresAt: pastDate,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.isProActive).toBe(false)
		expect(tier.hasStripeSubscription).toBe(true)
	})

	test('both Stripe and invite code active returns pro', async () => {
		const user = await setupUser()
		const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
		const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				stripeCustomerId: 'cus_test_both',
				stripeSubscriptionId: 'sub_test_both',
				subscriptionExpiresAt: futureDate,
				trialEndsAt: trialEnd,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.isProActive).toBe(true)
		expect(tier.hasStripeSubscription).toBe(true)
		expect(tier.isTrialing).toBe(true)
	})

	test('Stripe active with expired invite code is still pro', async () => {
		const user = await setupUser()
		const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
		const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				stripeCustomerId: 'cus_test_stripe_only',
				stripeSubscriptionId: 'sub_test_stripe_only',
				subscriptionExpiresAt: futureDate,
				trialEndsAt: pastDate,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.isProActive).toBe(true)
		expect(tier.isTrialing).toBe(false)
		expect(tier.hasStripeSubscription).toBe(true)
	})

	test('no Stripe subscription returns hasStripeSubscription false', async () => {
		const user = await setupUser()
		const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'free',
				trialEndsAt: futureDate,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.hasStripeSubscription).toBe(false)
		expect(tier.subscriptionExpiresAt).toBeNull()
	})
})
