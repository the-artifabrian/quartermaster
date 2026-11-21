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
} from './utils.server.ts'

// Adding a passkey takes two requests: the options (which need the current
// password) and the response from the authenticator. The signed challenge
// cookie carries the password check from one to the other. It is only handed
// out after the check, names the account it was handed to, and lasts a few
// minutes.
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
				error: 'Create a password first. Adding a passkey asks for it.',
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
	// Each password check is good for one try.
	const clearChallenge = {
		'Set-Cookie': await passkeyCookie.serialize('', { maxAge: 0 }),
	}
	try {
		const challengeCookie = AddPasskeyChallengeSchema.safeParse(
			await passkeyCookie.parse(request.headers.get('Cookie')),
		)
		if (
			!challengeCookie.success ||
			challengeCookie.data.userId !== userId ||
			challengeCookie.data.expiresAt < Date.now()
		) {
			throw new Error('Enter your password and try again.')
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
			throw new Error('Registration verification failed')
		}
		const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
			registrationInfo

		const existingPasskey = await prisma.passkey.findUnique({
			where: { id: credential.id },
			select: { id: true },
		})

		if (existingPasskey) {
			throw new Error('This passkey has already been registered')
		}

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

		const user = await prisma.user.findUniqueOrThrow({
			where: { id: userId },
			select: { email: true, username: true },
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

		return Response.json(
			{ status: 'error', error: getErrorMessage(error) } as const,
			{ status: 400, headers: clearChallenge },
		)
	}
}
