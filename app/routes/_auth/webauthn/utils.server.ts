import {
	type AuthenticationResponseJSON,
	type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { createCookie } from 'react-router'
import { z } from 'zod'
import { getAppOrigin } from '#app/utils/app-origin.server.ts'

export const passkeyCookie = createCookie('webauthn-challenge', {
	path: '/',
	sameSite: 'lax',
	httpOnly: true,
	maxAge: 60 * 60 * 2,
	secure: process.env.NODE_ENV === 'production',
	secrets: [process.env.SESSION_SECRET],
})

/**
 * The challenge cookie while adding a passkey. It is only set after the
 * current password checks out, so the step that saves the passkey takes it as
 * proof of that check: for this account (`userId`), until `expiresAt`.
 * `webauthnUserId` is the WebAuthn user handle the options carried.
 */
export const AddPasskeyChallengeSchema = z.object({
	purpose: z.literal('add-passkey'),
	challenge: z.string(),
	webauthnUserId: z.string(),
	userId: z.string(),
	expiresAt: z.number(),
})

export const RegistrationResponseSchema = z.object({
	id: z.string(),
	rawId: z.string(),
	response: z.object({
		clientDataJSON: z.string(),
		attestationObject: z.string(),
		transports: z
			.array(
				z.enum([
					'ble',
					'cable',
					'hybrid',
					'internal',
					'nfc',
					'smart-card',
					'usb',
				]),
			)
			.optional(),
	}),
	authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional(),
	clientExtensionResults: z.object({
		credProps: z
			.object({
				rk: z.boolean(),
			})
			.optional(),
	}),
	type: z.literal('public-key'),
}) satisfies z.ZodType<RegistrationResponseJSON>

const AuthenticationResponseSchema = z.object({
	id: z.string(),
	rawId: z.string(),
	response: z.object({
		clientDataJSON: z.string(),
		authenticatorData: z.string(),
		signature: z.string(),
		userHandle: z.string().optional(),
	}),
	type: z.literal('public-key'),
	clientExtensionResults: z.object({
		appid: z.boolean().optional(),
		credProps: z
			.object({
				rk: z.boolean().optional(),
			})
			.optional(),
		hmacCreateSecret: z.boolean().optional(),
	}),
}) satisfies z.ZodType<AuthenticationResponseJSON>

export const PasskeyLoginBodySchema = z.object({
	authResponse: AuthenticationResponseSchema,
	remember: z.boolean().default(false),
	redirectTo: z.string().nullable(),
})

export function getWebAuthnConfig() {
	const url = new URL(getAppOrigin())

	return {
		rpName: url.hostname,
		rpID: url.hostname,
		origin: url.origin,
	} as const
}

/**
 * The WebAuthn user handle for an account: its id as UTF-8, in unpadded
 * base64url. Registration hands SimpleWebAuthn the same bytes, so this matches
 * `webauthnUserId` on every saved passkey.
 */
export function webauthnUserHandle(userId: string) {
	return Buffer.from(userId, 'utf8').toString('base64url')
}
