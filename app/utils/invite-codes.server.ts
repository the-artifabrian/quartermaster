import { prisma } from './db.server.ts'
import { getUserTier } from './subscription.server.ts'

// Human-friendly alphabet — no ambiguous chars (0/O/1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Number of invite codes granted when a user redeems a code and becomes Pro. */
const STARTER_CODE_COUNT = 2

/**
 * Generate a random invite code string in "QM-XXXXXX" format.
 * ~729M possible codes (31^6).
 */
export function generateCodeString(): string {
	let result = ''
	const bytes = crypto.getRandomValues(new Uint8Array(6))
	for (const byte of bytes) {
		result += ALPHABET[byte % ALPHABET.length]
	}
	return `QM-${result}`
}

// ---------------------------------------------------------------------------
// Admin code generation
// ---------------------------------------------------------------------------

export async function createAdminCodes(
	createdById: string,
	count: number,
	options?: { grantsDays?: number; expiresAt?: Date },
) {
	const codes: Array<{ id: string; code: string }> = []
	for (let i = 0; i < count; i++) {
		const code = await prisma.inviteCode.create({
			data: {
				code: generateCodeString(),
				type: 'admin',
				grantsDays: options?.grantsDays ?? 60,
				expiresAt: options?.expiresAt ?? null,
				createdById,
			},
			select: { id: true, code: true },
		})
		codes.push(code)
	}
	return codes
}

// ---------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------

type RedeemResult =
	| { success: true; trialEndsAt: Date }
	| { success: false; error: string }

export async function redeemInviteCode(
	rawCode: string,
	userId: string,
): Promise<RedeemResult> {
	const code = rawCode.trim().toUpperCase()

	// Check user's current subscription state
	const tierInfo = await getUserTier(userId)

	if (tierInfo.tier === 'pro') {
		// Paid Pro (not trial) — reject
		if (!tierInfo.isTrialing) {
			return {
				success: false,
				error: 'You already have an active Pro subscription.',
			}
		}
		// Active trial — reject
		if (tierInfo.isProActive && tierInfo.isTrialing) {
			const dateStr = tierInfo.trialEndsAt
				? tierInfo.trialEndsAt.toLocaleDateString('en-US', {
						month: 'long',
						day: 'numeric',
						year: 'numeric',
					})
				: 'soon'
			return {
				success: false,
				error: `You have Pro access until ${dateStr}.`,
			}
		}
	}

	// Active trial on free tier
	if (tierInfo.isTrialing && tierInfo.trialEndsAt) {
		const dateStr = tierInfo.trialEndsAt.toLocaleDateString('en-US', {
			month: 'long',
			day: 'numeric',
			year: 'numeric',
		})
		return {
			success: false,
			error: `You have Pro access until ${dateStr}.`,
		}
	}

	// Find the invite code
	const inviteCode = await prisma.inviteCode.findUnique({
		where: { code },
		select: {
			id: true,
			grantsDays: true,
			expiresAt: true,
			redeemedAt: true,
		},
	})

	if (!inviteCode) {
		return { success: false, error: 'Invalid invite code.' }
	}

	if (inviteCode.redeemedAt) {
		return { success: false, error: 'This code has already been redeemed.' }
	}

	if (inviteCode.expiresAt && inviteCode.expiresAt < new Date()) {
		return { success: false, error: 'This code has expired.' }
	}

	// Atomically mark as redeemed (concurrent-use guard)
	const updated = await prisma.inviteCode.updateMany({
		where: { id: inviteCode.id, redeemedAt: null },
		data: {
			redeemedAt: new Date(),
			redeemedById: userId,
		},
	})

	if (updated.count === 0) {
		return { success: false, error: 'This code has already been redeemed.' }
	}

	// Apply Pro trial
	const trialEndsAt = new Date(
		Date.now() + inviteCode.grantsDays * 24 * 60 * 60 * 1000,
	)

	await prisma.subscription.upsert({
		where: { userId },
		update: { trialEndsAt },
		create: { userId, tier: 'free', trialEndsAt },
	})

	// Grant starter invite codes so the new Pro user can share immediately
	for (let i = 0; i < STARTER_CODE_COUNT; i++) {
		await prisma.inviteCode.create({
			data: {
				code: generateCodeString(),
				type: 'earned',
				grantsDays: 60,
				createdById: userId,
				expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
			},
		})
	}

	return { success: true, trialEndsAt }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getAvailableCodeCount(userId: string): Promise<number> {
	return prisma.inviteCode.count({
		where: {
			createdById: userId,
			redeemedAt: null,
			OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
		},
	})
}

export async function getUserInviteCodes(userId: string) {
	return prisma.inviteCode.findMany({
		where: { createdById: userId },
		select: {
			id: true,
			code: true,
			type: true,
			grantsDays: true,
			expiresAt: true,
			redeemedAt: true,
			createdAt: true,
			redeemedBy: {
				select: { username: true },
			},
		},
		orderBy: { createdAt: 'desc' },
	})
}
