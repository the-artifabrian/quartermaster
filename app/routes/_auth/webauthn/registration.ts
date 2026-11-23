import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { createElement } from 'react'
import { z } from 'zod'
import { requireRecentVerification } from '#app/routes/_auth/verify.server.ts'
import { requireUserId, verifyUserPassword } from '#app/utils/auth.server.ts'
import { runInBackground } from '#app/utils/background.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { getErrorMessage } from '#app/utils/misc.tsx'
import { type Route } from './+types/registration.ts'
import { PasskeyAddedEmail } from './passkey-added-email.server.tsx'
import {
	AddPasskeyChallengeSchema,
	RegistrationResponseSchema,
	passkeyCookie,
	getWebAuthnConfig,
	spendAddPasskeyChallenge,
} from './utils.server.ts'

/**
 * Why a save was refused, so the page can show the right message:
 * `enter-password` (the password check is missing, used or too old),
 * `already-registered` (that passkey is saved already) or `not-saved`
 * (anything else). The page never tells the browser to forget a passkey after
 * a refused save: a resend of a save that worked gets a refusal too.
 */
export type AddPasskeyErrorCode =
	'enter-password' | 'not-saved' | 'already-registered'

class AddPasskeyError extends Error {
	constructor(
		message: string,
		readonly code: AddPasskeyErrorCode,
	) {
		super(message)
	}
}

// Adding a passkey takes two requests: the options (which need the current
// password) and the response from the authenticator. The signed challenge
// cookie carries the password check from one to the other. It is only handed
// out after the check, names the account it was handed to, lasts five
// minutes, and saves one passkey at most: the server remembers each challenge
// it has spent (`spendAddPasskeyChallenge`).
const addPasskeyWindowMs = 5 * 60 * 1000

const passkeysPage = '/settings/profile/passkeys'

const RegistrationRequestSchema = z.discriminatedUnion('intent', [
	z.object({ intent: z.literal('options'), password: z.string() }),
	z.object({
		intent: z.literal('verify'),
		response: RegistrationResponseSchema,
	}),
])

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const body = RegistrationRequestSchema.safeParse(
		await request.json().catch(() => null),
	)
	if (!body.success) {
		return Response.json(
			{ status: 'error', error: 'Invalid request' } as const,
			{ status: 400 },
		)
	}
	return body.data.intent === 'options'
		? startAddingPasskey(request, userId, body.data.password)
		: finishAddingPasskey(request, userId, body.data.response)
}

/**
 * A 2FA user who hasn't verified lately reverifies first. The page asked with
 * fetch, so the redirect goes back as JSON for the page to follow, and it
 * returns to the Passkeys page rather than to this route.
 */
async function reverifyAnswer(request: Request) {
	const pageRequest = new Request(new URL(passkeysPage, request.url), {
		headers: request.headers,
	})
	const redirect = await requireRecentVerification(pageRequest).then(
		() => null,
		(thrown: unknown) => {
			if (thrown instanceof Response && thrown.headers.has('location')) {
				return thrown
			}
			throw thrown
		},
	)
	if (!redirect) return null
	const headers = new Headers()
	for (const cookie of redirect.headers.getSetCookie()) {
		headers.append('Set-Cookie', cookie)
	}
	return Response.json(
		{ status: 'reverify', location: redirect.headers.get('location') } as const,
		{ status: 403, headers },
	)
}

async function startAddingPasskey(
	request: Request,
	userId: string,
	password: string,
) {
	const reverify = await reverifyAnswer(request)
	if (reverify) return reverify

	const hasPassword = await prisma.password.findUnique({
		where: { userId },
		select: { userId: true },
	})
	if (!hasPassword) {
		return Response.json(
			{
				status: 'error',
				error:
					'Adding a passkey asks for your password. Reset your password to set one.',
			} as const,
			{ status: 400 },
		)
	}
	if (!(await verifyUserPassword({ id: userId }, password))) {
		return Response.json(
			{
				status: 'error',
				field: 'password',
				error: 'Incorrect password.',
			} as const,
			{ status: 400 },
		)
	}

	const passkeys = await prisma.passkey.findMany({
		where: { userId },
		select: { id: true },
	})
	const user = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: { email: true, name: true, username: true },
	})

	const config = getWebAuthnConfig()
	const options = await generateRegistrationOptions({
		rpName: config.rpName,
		rpID: config.rpID,
		userName: user.username,
		userID: new TextEncoder().encode(userId),
		userDisplayName: user.name ?? user.email,
		attestationType: 'none',
		excludeCredentials: passkeys,
		authenticatorSelection: {
			residentKey: 'required',
			userVerification: 'preferred',
		},
	})

	return Response.json({ status: 'ready', options } as const, {
		headers: {
			'Set-Cookie': await passkeyCookie.serialize(
				AddPasskeyChallengeSchema.parse({
					purpose: 'add-passkey',
					challenge: options.challenge,
					webauthnUserId: options.user.id,
					userId,
					expiresAt: Date.now() + addPasskeyWindowMs,
				}),
				{ maxAge: addPasskeyWindowMs / 1000 },
			),
		},
	})
}

async function finishAddingPasskey(
	request: Request,
	userId: string,
	response: RegistrationResponseJSON,
) {
	// Each password check is good for one try, kept or not.
	const clearChallenge = {
		'Set-Cookie': await passkeyCookie.serialize('', { maxAge: 0 }),
	}
	try {
		// A resend of a save that worked (its answer was lost) finds the
		// passkey here, before its spent challenge would refuse it.
		const savedHere = await prisma.passkey.findFirst({
			where: { id: response.id, userId },
			select: { id: true },
		})
		if (savedHere) {
			throw new AddPasskeyError(
				'This passkey is already registered.',
				'already-registered',
			)
		}

		const challengeCookie = AddPasskeyChallengeSchema.safeParse(
			await passkeyCookie.parse(request.headers.get('Cookie')),
		)
		if (
			!challengeCookie.success ||
			challengeCookie.data.userId !== userId ||
			challengeCookie.data.expiresAt < Date.now() ||
			!spendAddPasskeyChallenge(
				challengeCookie.data.challenge,
				challengeCookie.data.expiresAt,
			)
		) {
			throw new AddPasskeyError(
				'Enter your password and try again.',
				'enter-password',
			)
		}
		const { challenge, webauthnUserId } = challengeCookie.data

		const { origin, rpID } = getWebAuthnConfig()

		const verification = await verifyRegistrationResponse({
			response,
			expectedChallenge: challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			requireUserVerification: true,
		})

		const { verified, registrationInfo } = verification
		if (!verified || !registrationInfo) {
			throw new AddPasskeyError('Registration verification failed', 'not-saved')
		}
		const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
			registrationInfo

		const existingPasskey = await prisma.passkey.findUnique({
			where: { id: credential.id },
			select: { id: true },
		})

		if (existingPasskey) {
			throw new AddPasskeyError(
				'This passkey is already registered.',
				'already-registered',
			)
		}

		// Read before saving, so nothing after the save can fail.
		const user = await prisma.user.findUniqueOrThrow({
			where: { id: userId },
			select: { email: true, username: true },
		})

		await prisma.passkey.create({
			data: {
				id: credential.id,
				aaguid,
				publicKey: Buffer.from(credential.publicKey),
				userId,
				webauthnUserId,
				counter: credential.counter,
				deviceType: credentialDeviceType,
				backedUp: credentialBackedUp,
				transports: credential.transports?.join(','),
			},
		})

		runInBackground(
			sendEmail({
				to: user.email,
				subject: 'A passkey was added to your Quartermaster account',
				react: createElement(PasskeyAddedEmail, { username: user.username }),
			}),
			'sending a passkey-added notice',
		)

		return Response.json({ status: 'success' } as const, {
			headers: clearChallenge,
		})
	} catch (error) {
		if (error instanceof Response) throw error

		// Anything else (a malformed response, a failed write) left nothing saved.
		const code: AddPasskeyErrorCode =
			error instanceof AddPasskeyError ? error.code : 'not-saved'
		return Response.json(
			{ status: 'error', code, error: getErrorMessage(error) } as const,
			{ status: 400, headers: clearChallenge },
		)
	}
}
