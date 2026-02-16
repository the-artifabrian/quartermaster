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
})
