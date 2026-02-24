import { faker } from '@faker-js/faker'
import { describe, expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { AUTO_TRIAL_DAYS, signup } from './auth.server.ts'
import { getUserTier } from './subscription.server.ts'

async function setupUser() {
	const user = await prisma.user.create({ data: createUser() })
	return user
}

/** Ensure the 'user' role exists (migrations create the table but tests skip seed). */
async function ensureUserRole() {
	await prisma.role.upsert({
		where: { name: 'user' },
		create: { name: 'user' },
		update: {},
	})
}

describe('auto-trial on signup', () => {
	test('AUTO_TRIAL_DAYS is 14', () => {
		expect(AUTO_TRIAL_DAYS).toBe(14)
	})

	test('signup() creates subscription with trialEndsAt ~14 days out', async () => {
		await ensureUserRole()

		const before = Date.now()
		const session = await signup({
			email: `${faker.string.alphanumeric(8)}@example.com`,
			username: faker.string.alphanumeric(10).toLowerCase(),
			name: faker.person.fullName(),
			password: faker.internet.password({ length: 12 }),
		})
		const after = Date.now()

		const sub = await prisma.subscription.findUnique({
			where: { userId: session.userId },
		})
		expect(sub).toBeTruthy()
		expect(sub!.tier).toBe('free')
		expect(sub!.trialEndsAt).toBeInstanceOf(Date)

		const trialEnd = sub!.trialEndsAt!.getTime()
		const expectedMin = before + 14 * 24 * 60 * 60 * 1000
		const expectedMax = after + 14 * 24 * 60 * 60 * 1000
		expect(trialEnd).toBeGreaterThanOrEqual(expectedMin)
		expect(trialEnd).toBeLessThanOrEqual(expectedMax)

		// Verify getUserTier sees the trial as active
		const tier = await getUserTier(session.userId)
		expect(tier.isProActive).toBe(true)
		expect(tier.isTrialing).toBe(true)
		expect(tier.daysUntilExpiry).toBe(14)
	})
})

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

describe('proExpiresAt', () => {
	test('returns trialEndsAt when trialing', async () => {
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

		expect(tier.proExpiresAt).toEqual(futureDate)
	})

	test('returns subscriptionExpiresAt when paid', async () => {
		const user = await setupUser()
		const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				stripeCustomerId: 'cus_test',
				subscriptionExpiresAt: futureDate,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.proExpiresAt).toEqual(futureDate)
	})

	test('returns null for indefinite Stripe (no subscriptionExpiresAt)', async () => {
		const user = await setupUser()
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				stripeCustomerId: 'cus_test_indef',
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.proExpiresAt).toBeNull()
		expect(tier.isProActive).toBe(true)
	})

	test('returns null for no subscription', async () => {
		const user = await setupUser()

		const tier = await getUserTier(user.id)

		expect(tier.proExpiresAt).toBeNull()
	})

	test('returns null when trial active but Stripe is indefinite', async () => {
		const user = await setupUser()
		const trialEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				stripeCustomerId: 'cus_test_indef',
				trialEndsAt: trialEnd,
				// no subscriptionExpiresAt → indefinite Stripe
			},
		})

		const tier = await getUserTier(user.id)

		// Indefinite Stripe wins — should NOT show trial countdown
		expect(tier.proExpiresAt).toBeNull()
		expect(tier.daysUntilExpiry).toBeNull()
		expect(tier.isProActive).toBe(true)
	})

	test('picks later date when both trial and paid have concrete dates', async () => {
		const user = await setupUser()
		const trialEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
		const subEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				stripeCustomerId: 'cus_test',
				trialEndsAt: trialEnd,
				subscriptionExpiresAt: subEnd,
			},
		})

		const tier = await getUserTier(user.id)

		// Should pick the later date (subscription), not the trial
		expect(tier.proExpiresAt).toEqual(subEnd)
		expect(tier.daysUntilExpiry).toBe(30)
	})
})

describe('daysUntilExpiry', () => {
	test('calculates correctly for trial ending in 5 days', async () => {
		const user = await setupUser()
		const fiveDaysFromNow = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'free',
				trialEndsAt: fiveDaysFromNow,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.daysUntilExpiry).toBe(5)
	})

	test('returns null when no expiry', async () => {
		const user = await setupUser()
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.daysUntilExpiry).toBeNull()
	})

	test('returns null when no subscription', async () => {
		const user = await setupUser()

		const tier = await getUserTier(user.id)

		expect(tier.daysUntilExpiry).toBeNull()
	})
})

describe('wasProPreviously', () => {
	test('is true for expired trial', async () => {
		const user = await setupUser()
		const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'free',
				trialEndsAt: pastDate,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.wasProPreviously).toBe(true)
		expect(tier.isProActive).toBe(false)
	})

	test('is true for expired Stripe subscription', async () => {
		const user = await setupUser()
		const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				stripeCustomerId: 'cus_test_expired',
				subscriptionExpiresAt: pastDate,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.wasProPreviously).toBe(true)
		expect(tier.isProActive).toBe(false)
	})

	test('is false for never-Pro user', async () => {
		const user = await setupUser()

		const tier = await getUserTier(user.id)

		expect(tier.wasProPreviously).toBe(false)
	})

	test('is false for active Pro user', async () => {
		const user = await setupUser()
		const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'free',
				trialEndsAt: futureDate,
			},
		})

		const tier = await getUserTier(user.id)

		expect(tier.wasProPreviously).toBe(false)
		expect(tier.isProActive).toBe(true)
	})
})
