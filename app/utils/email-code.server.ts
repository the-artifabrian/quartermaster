import crypto from 'node:crypto'
import { type Prisma } from '#app/generated/prisma/client.ts'
import { prisma } from './db.server.ts'
import { writeTransaction } from './write-transaction.server.ts'

// Codes emailed for signup, a password reset and an email change. How they
// work, and the guessing bound, is in docs/SECURITY.md under "Emailed codes".
// Authenticator (2FA) codes are a separate thing in Verification.

export const emailCodeTypes = [
	'onboarding',
	'reset-password',
	'change-email',
] as const
export type EmailCodeType = (typeof emailCodeTypes)[number]

export function isEmailCodeType(type: unknown): type is EmailCodeType {
	return emailCodeTypes.includes(type as EmailCodeType)
}

// Leaves out 0, O and I, which are easy to mix up.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789'
export const EMAIL_CODE_LENGTH = 8
export const EMAIL_CODE_LIFETIME_MS = 10 * 60 * 1000
/** Live codes one (type, target) can hold. Past it, nothing more is sent. */
export const MAX_LIVE_EMAIL_CODES = 5

function newCode() {
	let code = ''
	for (let i = 0; i < EMAIL_CODE_LENGTH; i++) {
		code += ALPHABET[crypto.randomInt(ALPHABET.length)]
	}
	return code
}

/**
 * The stored form of a code or link token: HMAC-SHA-256 keyed with the first
 * SESSION_SECRET, hex. A plain hash of an 8-character code could be reversed
 * by trying every code; this one can't be checked without the secret.
 * Rotating the secret makes codes in flight stop working.
 */
export function emailCodeDigest(value: string) {
	const [secret] = process.env.SESSION_SECRET.split(',').filter(Boolean)
	if (!secret) throw new Error('SESSION_SECRET is required for emailed codes')
	return crypto
		.createHmac('sha256', secret)
		.update(`email-code\n${value}`)
		.digest('hex')
}

function hashesMatch(storedHex: string, value: string) {
	const stored = Buffer.from(storedHex, 'hex')
	const given = Buffer.from(emailCodeDigest(value), 'hex')
	return stored.length === given.length && crypto.timingSafeEqual(stored, given)
}

/** What a person might type for a code: any case, spaces or dashes. */
export function normaliseEmailCode(code: string) {
	return code.replace(/[\s-]/g, '').toUpperCase()
}

type SendOutcome =
	{ status: 'success' } | { status: 'error'; error: { message: string } }

export type IssueResult =
	| { status: 'sent' }
	| { status: 'failed'; error: { message: string } }
	| { status: 'capped' }

/**
 * Makes a new code and its link token, and hands them to `send`.
 *
 * The cap is checked and a place taken in one write transaction, so requests
 * that arrive together can't all pass the count. The place can't match any
 * code until `send` succeeds; if it fails or throws, the place is removed.
 * Earlier codes are never touched. Past the cap nothing is made or sent.
 */
export async function issueEmailCode({
	type,
	target,
	address,
	send,
}: {
	type: EmailCodeType
	target: string
	address?: string
	send: (code: { code: string; token: string }) => Promise<SendOutcome>
}): Promise<IssueResult> {
	if (!isEmailCodeType(type)) throw new Error(`Not an emailed code: ${type}`)
	const code = newCode()
	const token = crypto.randomBytes(32).toString('base64url')

	const id = await writeTransaction(prisma, async (tx) => {
		const now = new Date()
		const live = await tx.emailCode.count({
			where: { type, target, expiresAt: { gt: now } },
		})
		if (live >= MAX_LIVE_EMAIL_CODES) return null
		const row = await tx.emailCode.create({
			data: {
				type,
				target,
				address: address ?? null,
				codeHash: emailCodeDigest(code),
				linkTokenHash: emailCodeDigest(token),
				expiresAt: new Date(now.getTime() + EMAIL_CODE_LIFETIME_MS),
			},
			select: { id: true },
		})
		return row.id
	})
	if (id === null) return { status: 'capped' }

	let sent: SendOutcome
	try {
		sent = await send({ code, token })
	} catch (error) {
		await prisma.emailCode.deleteMany({ where: { id } })
		throw error
	}
	if (sent.status !== 'success') {
		await prisma.emailCode.deleteMany({ where: { id } })
		return { status: 'failed', error: sent.error }
	}
	try {
		// updateMany: the place is gone if one of the target's codes was used
		// while this email went out, and then this code shouldn't work either.
		await prisma.emailCode.updateMany({
			where: { id },
			data: { sentAt: new Date() },
		})
	} catch (error) {
		// The email went out, but its code will never work. Free its place
		// and say the send failed, so the person asks again.
		console.error('Failed to mark an emailed code as sent:', error)
		await prisma.emailCode.deleteMany({ where: { id } }).catch(() => {})
		return {
			status: 'failed',
			error: { message: "We couldn't send the code. Try again in a minute." },
		}
	}
	return { status: 'sent' }
}

/**
 * Ends the user's live reset codes. A new password or email makes a reset
 * code sent earlier, maybe to an old address, pointless; run it in the same
 * transaction as that change.
 */
export function endResetCodes(db: Db, userId: string) {
	return db.emailCode.deleteMany({
		where: { type: 'reset-password', target: userId },
	})
}

type CodeQuery = {
	type: EmailCodeType
	target: string
	/** The typed code. Checked when given; otherwise the link token is. */
	code?: string
	token?: string
}

type Db = Pick<Prisma.TransactionClient, 'emailCode'>

async function findMatch(db: Db, { type, target, code, token }: CodeQuery) {
	if (!isEmailCodeType(type)) return null
	const typed = code ? normaliseEmailCode(code) : ''
	if (!typed && !token) return null
	const rows = await db.emailCode.findMany({
		where: {
			type,
			target,
			sentAt: { not: null },
			expiresAt: { gt: new Date() },
		},
		select: { id: true, codeHash: true, linkTokenHash: true, address: true },
	})
	// Every live row is compared, so the time taken doesn't depend on which
	// one matched.
	let match: (typeof rows)[number] | null = null
	for (const row of rows) {
		const matches = typed
			? hashesMatch(row.codeHash, typed)
			: hashesMatch(row.linkTokenHash, token!)
		if (matches && !match) match = row
	}
	return match ? { id: match.id, address: match.address } : null
}

/** The live code matching `code` (or else `token`), without using it. */
export async function checkEmailCode(query: CodeQuery) {
	return findMatch(prisma, query)
}

/**
 * Uses the matching live code: deletes it, and the target's other codes of
 * that type, in one write transaction. Of two submits of the same code only
 * one deletes the row, so only one gets a result; the other gets null.
 * `then` runs in the same transaction with the used code's row, so a change
 * it makes happens only if the code was used.
 */
export async function consumeEmailCode<T = true>(
	query: CodeQuery,
	then?: (
		tx: Prisma.TransactionClient,
		row: { id: string; address: string | null },
	) => Promise<T>,
): Promise<T | null> {
	if (!isEmailCodeType(query.type)) return null
	return writeTransaction(prisma, async (tx) => {
		const match = await findMatch(tx, query)
		if (!match) return null
		const { count } = await tx.emailCode.deleteMany({
			where: { id: match.id, expiresAt: { gt: new Date() } },
		})
		if (count !== 1) return null
		await tx.emailCode.deleteMany({
			where: { type: query.type, target: query.target },
		})
		return then ? then(tx, match) : (true as T)
	})
}
