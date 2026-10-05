import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { SAFARI_UA, SHELL_UA } from '#tests/native-shell.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as enhanceAction } from './enhance-recipe.tsx'
import { action as transcribeAction } from './transcribe.tsx'
import '#tests/setup/db-setup.ts'

// The recipe page and the voice button call these from a fetcher or fetch.
// In the iOS app a caller without Pro gets an error they can show in place:
// a thrown 403 would reach the root error boundary and blank the screen, and
// a redirect to /upgrade points at buying Pro (ADR 0001).

async function signedInUser(subscription: { tier: string } | null) {
	return prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: {
				create: {
					...createUser(),
					...(subscription ? { subscription: { create: subscription } } : {}),
				},
			},
		},
		select: { id: true, userId: true },
	})
}

async function post(
	path: string,
	session: { id: string },
	userAgent: string,
	fields: Record<string, string> = {},
) {
	const action =
		path === '/resources/enhance-recipe' ? enhanceAction : transcribeAction
	const result = await action({
		request: new Request(`${BASE_URL}${path}`, {
			method: 'POST',
			headers: {
				cookie: await getSessionCookieHeader(session),
				'User-Agent': userAgent,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams(fields).toString(),
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: path,
		url: new URL(`${BASE_URL}${path}`),
	})
	const { data, init } = result as unknown as {
		data: unknown
		init: ResponseInit | null
	}
	return { status: init?.status ?? 200, body: data }
}

describe('Pro-only resources', () => {
	test('in the iOS app, enhance answers a free user with a 403 it can show', async () => {
		const session = await signedInUser(null)

		expect(
			await post('/resources/enhance-recipe', session, SHELL_UA, {
				recipeId: 'any',
			}),
		).toEqual({
			status: 403,
			body: {
				error: 'Recipe enhancement is not available.',
				suggestions: null,
			},
		})
		expect(
			await prisma.usageEvent.count({ where: { userId: session.userId } }),
		).toBe(0)
	})

	test('in the iOS app, transcribe answers a free user with a 403 it can show', async () => {
		const session = await signedInUser(null)

		expect(await post('/resources/transcribe', session, SHELL_UA)).toEqual({
			status: 403,
			body: {
				error: 'Voice input is not available.',
				items: [],
				transcription: null,
			},
		})
	})

	test('in the iOS app, a Pro user gets past the gate', async () => {
		const session = await signedInUser({ tier: 'pro' })

		expect(
			await post('/resources/enhance-recipe', session, SHELL_UA),
		).toMatchObject({ status: 400, body: { error: 'Invalid request' } })
	})

	test('in a browser, a free user is still sent to /upgrade', async () => {
		const session = await signedInUser(null)

		const thrown = await post(
			'/resources/enhance-recipe',
			session,
			SAFARI_UA,
		).then(
			() => null,
			(error: unknown) => error,
		)

		expect(thrown).toBeInstanceOf(Response)
		expect((thrown as Response).status).toBe(302)
		expect((thrown as Response).headers.get('Location')).toBe('/upgrade')
	})
})
