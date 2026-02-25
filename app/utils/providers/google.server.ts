import { SetCookie } from '@mjackson/headers'
import { createId as cuid } from '@paralleldrive/cuid2'
import { redirect } from 'react-router'
import { OAuth2Strategy } from 'remix-auth-oauth2'
import { z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { MOCK_CODE_GOOGLE_HEADER, MOCK_CODE_GOOGLE } from './constants.ts'
import { type AuthProvider } from './provider.ts'

const GoogleUserSchema = z.object({
	id: z.string(),
	email: z.string(),
	name: z.string().optional(),
	picture: z.string().optional(),
})

const shouldMock =
	process.env.GOOGLE_CLIENT_ID?.startsWith('MOCK_') ||
	process.env.NODE_ENV === 'test'

export class GoogleProvider implements AuthProvider {
	getAuthStrategy() {
		if (
			!process.env.GOOGLE_CLIENT_ID ||
			!process.env.GOOGLE_CLIENT_SECRET ||
			!process.env.GOOGLE_REDIRECT_URI
		) {
			console.log(
				'Google OAuth strategy not available because environment variables are not set',
			)
			return null
		}
		return new OAuth2Strategy(
			{
				cookie: 'google',
				clientId: process.env.GOOGLE_CLIENT_ID,
				clientSecret: process.env.GOOGLE_CLIENT_SECRET,
				authorizationEndpoint:
					'https://accounts.google.com/o/oauth2/v2/auth',
				tokenEndpoint: 'https://oauth2.googleapis.com/token',
				redirectURI: process.env.GOOGLE_REDIRECT_URI,
				scopes: ['openid', 'email', 'profile'],
			},
			async ({ tokens }) => {
				const response = await fetch(
					'https://www.googleapis.com/oauth2/v2/userinfo',
					{
						headers: {
							Authorization: `Bearer ${tokens.accessToken()}`,
						},
					},
				)
				const rawUser = await response.json()
				const user = GoogleUserSchema.parse(rawUser)

				const emailPrefix = user.email.split('@')[0] ?? user.email

				return {
					id: user.id,
					email: user.email,
					name: user.name,
					username: emailPrefix,
				}
			},
		)
	}

	async resolveConnectionData(providerId: string) {
		const connection = await prisma.connection.findFirst({
			select: { user: { select: { email: true, name: true } } },
			where: { providerId, providerName: 'google' },
		})
		return {
			displayName:
				connection?.user.name ?? connection?.user.email ?? 'Unknown',
			link: null,
		} as const
	}

	async handleMockAction(request: Request) {
		if (!shouldMock) return

		const state = cuid()
		const codeVerifier = cuid()
		const code =
			request.headers.get(MOCK_CODE_GOOGLE_HEADER) || MOCK_CODE_GOOGLE
		// remix-auth-oauth2 StateStore format: state={state}&{state}={codeVerifier}
		// Cookie name must be {cookieName}:{uuid}
		const storeParams = new URLSearchParams()
		storeParams.set('state', state)
		storeParams.set(state, codeVerifier)
		const cookieId = cuid()
		const cookie = new SetCookie({
			name: `google:${cookieId}`,
			value: storeParams.toString(),
			path: '/',
			sameSite: 'Lax',
			httpOnly: true,
			maxAge: 60 * 5,
			secure: process.env.NODE_ENV === 'production' || undefined,
		})
		const callbackParams = new URLSearchParams({ code, state })
		throw redirect(`/auth/google/callback?${callbackParams}`, {
			headers: {
				'Set-Cookie': cookie.toString(),
			},
		})
	}
}
