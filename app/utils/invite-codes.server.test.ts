import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
	householdEventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}))

import {
	generateCodeString,
	createAdminCodes,
	redeemInviteCode,
	getAvailableCodeCount,
	getUserInviteCodes,
} from './invite-codes.server.ts'

async function setupUser() {
	const user = await prisma.user.create({ data: createUser() })
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	return { userId: user.id, householdId: household.id }
}

describe('generateCodeString', () => {
	it('produces QM- prefix + 6 chars', () => {
		const code = generateCodeString()
		expect(code).toMatch(/^QM-[A-Z2-9]{6}$/)
	})

	it('never contains ambiguous characters', () => {
		for (let i = 0; i < 100; i++) {
			const code = generateCodeString()
			expect(code).not.toMatch(/[01OIL]/)
		}
	})

	it('generates unique codes', () => {
		const codes = new Set<string>()
		for (let i = 0; i < 50; i++) {
			codes.add(generateCodeString())
		}
		expect(codes.size).toBe(50)
	})
})

describe('createAdminCodes', () => {
	let adminUser: { userId: string; householdId: string }

	beforeEach(async () => {
		adminUser = await setupUser()
	})

	it('creates the requested number of codes', async () => {
		const codes = await createAdminCodes(adminUser.userId, 3)
		expect(codes).toHaveLength(3)
		for (const c of codes) {
			expect(c.code).toMatch(/^QM-/)
		}
	})

	it('respects custom grantsDays', async () => {
		const codes = await createAdminCodes(adminUser.userId, 1, {
			grantsDays: 30,
		})
		const stored = await prisma.inviteCode.findUnique({
			where: { id: codes[0]!.id },
		})
		expect(stored?.grantsDays).toBe(30)
	})
})

describe('redeemInviteCode', () => {
	let creator: { userId: string; householdId: string }
	let redeemer: { userId: string; householdId: string }

	beforeEach(async () => {
		creator = await setupUser()
		redeemer = await setupUser()
		// Ensure redeemer has a free subscription with no trial
		await prisma.subscription.create({
			data: { userId: redeemer.userId, tier: 'free' },
		})
	})

	it('successfully redeems a valid code', async () => {
		const [code] = await createAdminCodes(creator.userId, 1)
		const result = await redeemInviteCode(code!.code, redeemer.userId)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.trialEndsAt).toBeInstanceOf(Date)
		}

		// Check subscription was updated
		const sub = await prisma.subscription.findUnique({
			where: { userId: redeemer.userId },
		})
		expect(sub?.trialEndsAt).toBeTruthy()
	})

	it('grants 2 starter invite codes on redemption', async () => {
		const [code] = await createAdminCodes(creator.userId, 1)
		await redeemInviteCode(code!.code, redeemer.userId)

		const earnedCodes = await prisma.inviteCode.findMany({
			where: { createdById: redeemer.userId, type: 'earned' },
		})
		expect(earnedCodes).toHaveLength(2)
		for (const c of earnedCodes) {
			expect(c.grantsDays).toBe(60)
			expect(c.expiresAt).toBeTruthy()
			expect(c.redeemedAt).toBeNull()
		}
	})

	it('rejects invalid code', async () => {
		const result = await redeemInviteCode('QM-ZZZZZZ', redeemer.userId)
		expect(result).toEqual({
			success: false,
			error: 'Invalid invite code.',
		})
	})

	it('rejects already-redeemed code', async () => {
		const [code] = await createAdminCodes(creator.userId, 1)
		await redeemInviteCode(code!.code, redeemer.userId)

		const redeemer2 = await setupUser()
		await prisma.subscription.create({
			data: { userId: redeemer2.userId, tier: 'free' },
		})
		const result = await redeemInviteCode(code!.code, redeemer2.userId)
		expect(result).toEqual({
			success: false,
			error: 'This code has already been redeemed.',
		})
	})

	it('rejects expired code', async () => {
		const [code] = await createAdminCodes(creator.userId, 1, {
			expiresAt: new Date(Date.now() - 1000),
		})
		const result = await redeemInviteCode(code!.code, redeemer.userId)
		expect(result).toEqual({
			success: false,
			error: 'This code has expired.',
		})
	})

	it('rejects if user has active trial', async () => {
		await prisma.subscription.update({
			where: { userId: redeemer.userId },
			data: { trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
		})

		const [code] = await createAdminCodes(creator.userId, 1)
		const result = await redeemInviteCode(code!.code, redeemer.userId)
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toMatch(/You have Pro access until/)
		}
	})

	it('succeeds for user with expired trial', async () => {
		await prisma.subscription.update({
			where: { userId: redeemer.userId },
			data: { trialEndsAt: new Date(Date.now() - 1000) },
		})

		const [code] = await createAdminCodes(creator.userId, 1)
		const result = await redeemInviteCode(code!.code, redeemer.userId)
		expect(result.success).toBe(true)
	})

	it('normalizes code to uppercase', async () => {
		const [code] = await createAdminCodes(creator.userId, 1)
		const result = await redeemInviteCode(
			code!.code.toLowerCase(),
			redeemer.userId,
		)
		expect(result.success).toBe(true)
	})
})

describe('getAvailableCodeCount', () => {
	it('counts only unredeemed unexpired codes', async () => {
		const user = await setupUser()

		// Create 2 available codes
		await createAdminCodes(user.userId, 2)

		// Create 1 expired code
		await prisma.inviteCode.create({
			data: {
				code: generateCodeString(),
				type: 'admin',
				grantsDays: 60,
				createdById: user.userId,
				expiresAt: new Date(Date.now() - 1000),
			},
		})

		const count = await getAvailableCodeCount(user.userId)
		expect(count).toBe(2) // Only the 2 non-expired ones
	})
})
