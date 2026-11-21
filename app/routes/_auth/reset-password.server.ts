import crypto from 'node:crypto'
import { invariant } from '@epic-web/invariant'
import { data, redirect } from 'react-router'
import { z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { EMAIL_CODE_LIFETIME_MS } from '#app/utils/email-code.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { type VerifyFunctionArgs } from './verify.server.ts'

/**
 * The verify cookie's hand-off from a used reset code to the new-password
 * form: the account's id, when it runs out, and a mark of the account's
 * password and email at the time. Once either changes, by this reset or any
 * other way, the mark no longer matches and the hand-off is refused. That
 * makes it single use without storing anything.
 */
const resetPasswordSessionKey = 'resetPassword'

const HandOffSchema = z.object({
	userId: z.string(),
	expiresAt: z.number(),
	mark: z.string(),
})

/**
 * HMAC-SHA-256 of the account's email and stored password hash (or none),
 * keyed with the first SESSION_SECRET. The cookie is signed but readable, so
 * it carries this rather than the hash.
 */
function accountMark(user: {
	id: string
	email: string
	password: { hash: string } | null
}) {
	const [secret] = process.env.SESSION_SECRET.split(',').filter(Boolean)
	if (!secret) throw new Error('SESSION_SECRET is required for resets')
	return crypto
		.createHmac('sha256', secret)
		.update(
			`reset-password\n${user.id}\n${user.email}\n${user.password?.hash ?? ''}`,
		)
		.digest('hex')
}

function marksMatch(a: string, b: string) {
	const left = Buffer.from(a, 'hex')
	const right = Buffer.from(b, 'hex')
	return left.length === right.length && crypto.timingSafeEqual(left, right)
}

const accountSelect = {
	id: true,
	email: true,
	username: true,
	password: { select: { hash: true } },
} as const

export async function handleVerification({ submission }: VerifyFunctionArgs) {
	invariant(
		submission.status === 'success',
		'Submission should be successful by now',
	)
	// The verify step has turned the target into the account's id.
	const user = await prisma.user.findUnique({
		where: { id: submission.value.target },
		select: accountSelect,
	})
	// we don't want to say the user is not found if the email is not found
	// because that would allow an attacker to check if an email is registered
	if (!user) {
		return data(
			{ result: submission.reply({ fieldErrors: { code: ['Invalid code'] } }) },
			{ status: 400 },
		)
	}

	const verifySession = await verifySessionStorage.getSession()
	verifySession.set(resetPasswordSessionKey, {
		userId: user.id,
		expiresAt: Date.now() + EMAIL_CODE_LIFETIME_MS,
		mark: accountMark(user),
	} satisfies z.infer<typeof HandOffSchema>)
	return redirect('/reset-password', {
		headers: {
			'set-cookie': await verifySessionStorage.commitSession(verifySession),
		},
	})
}

/**
 * The account a reset is for. Without a hand-off the form goes to /login, as
 * before; with one that has run out or no longer matches the account, to
 * /forgot-password to ask for a new code.
 */
export async function requireResetPasswordUser(request: Request) {
	const verifySession = await verifySessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const handOff = HandOffSchema.safeParse(
		verifySession.get(resetPasswordSessionKey),
	)
	if (!handOff.success) throw redirect('/login')
	const { userId, expiresAt, mark } = handOff.data
	const user =
		expiresAt > Date.now()
			? await prisma.user.findUnique({
					where: { id: userId },
					select: accountSelect,
				})
			: null
	if (!user || !marksMatch(mark, accountMark(user))) {
		throw await redirectWithToast(
			'/forgot-password',
			{
				title: 'Ask for a new code',
				description:
					'That reset has run out, or your password or email has changed since.',
			},
			{
				headers: {
					'set-cookie':
						await verifySessionStorage.destroySession(verifySession),
				},
			},
		)
	}
	return { id: user.id, username: user.username }
}
