/**
 * Failure list for the daily caps on paid AI calls, at the routes. A use is
 * given back only when the provider cannot have billed the call (no response,
 * 429 or 5xx); a refund for anything else would let slow or bad input buy
 * unlimited paid calls.
 *
 * 1. Voice input has no cap, and every new signup gets a Pro trial. Once the
 *    day's uses run out it must be refused before Whisper is called.
 * 2. A voice request without usable audio spends a use.
 * 3. Whisper answers 503: nothing was billed, so the use must come back.
 * 4. Whisper answers 400 for the audio it was sent: that may be billed, so
 *    the use stays spent.
 * 5. Whisper times out: Groq may have finished and billed it, so the use
 *    stays spent.
 * 6. Whisper answers but the audio held nothing usable: the use stays spent.
 * 7. Text extraction gets a 503: the use must come back.
 * 8. Text extraction times out: the use stays spent.
 * 9. The model refuses: the use stays spent.
 * 10. Screenshot import with a file that is not an image spends a use.
 * 11. Enhance on a Recipe that does not exist (or is another household's)
 *     spends a use.
 * 12. Enhance gets a 429: the use must come back.
 */
import { http, HttpResponse } from 'msw'
import { RouterContextProvider } from 'react-router'
import { describe, expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { server } from '#tests/setup/mocks-setup.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as importAction } from '../recipes/import.tsx'
import { action as enhanceAction } from './enhance-recipe.tsx'
import { action as transcribeAction } from './transcribe.tsx'
import '#tests/setup/db-setup.ts'

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

async function proUser() {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: {
					create: {
						...createUser(),
						subscription: { create: { tier: 'pro' } },
					},
				},
			},
			select: { id: true, userId: true },
		})
		const household = await tx.household.create({
			data: {
				name: 'Capped household',
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		return { ...session, householdId: household.id }
	})
}

function withEnv(name: string, value: string) {
	const original = process.env[name]
	process.env[name] = value
	return {
		[Symbol.dispose]() {
			if (original === undefined) delete process.env[name]
			else process.env[name] = original
		},
	}
}

/** Every provider request times out at once, as if no answer came in time. */
function timeOutRequests() {
	const spy = vi
		.spyOn(AbortSignal, 'timeout')
		.mockImplementation(() =>
			AbortSignal.abort(new DOMException('timed out', 'TimeoutError')),
		)
	return { [Symbol.dispose]: () => spy.mockRestore() }
}

async function call(
	action: typeof transcribeAction | typeof enhanceAction | typeof importAction,
	path: string,
	session: { id: string },
	body: FormData,
) {
	const result: unknown = await action({
		request: new Request(`${BASE_URL}${path}`, {
			method: 'POST',
			headers: { cookie: await getSessionCookieHeader(session) },
			body,
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: path,
		url: new URL(`${BASE_URL}${path}`),
	} as never)
	if (result instanceof Response) {
		return { status: result.status, body: {} as { error?: string | null } }
	}
	const { data, init } = result as {
		data: { error?: string | null }
		init: ResponseInit | null
	}
	return { status: init?.status ?? 200, body: data }
}

function audioForm() {
	const body = new FormData()
	body.set(
		'audio',
		new File([new Uint8Array(64)], 'clip.webm', { type: 'audio/webm' }),
	)
	return body
}

function form(fields: Record<string, string | File>) {
	const body = new FormData()
	for (const [key, value] of Object.entries(fields)) body.set(key, value)
	return body
}

function uses(userId: string) {
	return prisma.usageEvent.count({ where: { userId } })
}

describe('voice input', () => {
	test('is refused once the day’s uses run out, without calling Whisper', async () => {
		using _groq = withEnv('GROQ_API_KEY', 'test-key')
		using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
		const session = await proUser()
		let whisperCalls = 0
		server.use(
			http.post(GROQ_URL, () => {
				whisperCalls++
				return HttpResponse.json({ text: '2 lb apples' })
			}),
			http.post(ANTHROPIC_URL, () =>
				HttpResponse.json({
					content: [
						{
							type: 'text',
							text: '[{"name":"apples","quantity":"2","unit":"lb"}]',
						},
					],
				}),
			),
		)

		let allowed = 0
		let refused: Awaited<ReturnType<typeof call>> | null = null
		for (let i = 0; i < 200 && !refused; i++) {
			const result = await call(
				transcribeAction,
				'/resources/transcribe',
				session,
				audioForm(),
			)
			if (result.status === 429) refused = result
			else allowed++
		}

		expect(refused?.body.error).toMatch(
			/^That's \d+ voice entries today\. Try again tomorrow\.$/,
		)
		expect(allowed).toBeGreaterThan(0)
		expect(whisperCalls).toBe(allowed)
		expect(await uses(session.userId)).toBe(allowed)
	})

	test('a request without audio spends nothing', async () => {
		using _groq = withEnv('GROQ_API_KEY', 'test-key')
		const session = await proUser()

		const result = await call(
			transcribeAction,
			'/resources/transcribe',
			session,
			form({ note: 'no audio here' }),
		)

		expect(result.status).toBe(400)
		expect(await uses(session.userId)).toBe(0)
	})

	test('a Whisper 503 gives the use back', async () => {
		using _groq = withEnv('GROQ_API_KEY', 'test-key')
		consoleError.mockImplementation(() => {})
		const session = await proUser()
		server.use(
			http.post(GROQ_URL, () => new HttpResponse(null, { status: 503 })),
		)

		const result = await call(
			transcribeAction,
			'/resources/transcribe',
			session,
			audioForm(),
		)

		expect(result.status).toBe(422)
		expect(await uses(session.userId)).toBe(0)
	})

	test('a Whisper 400 keeps the use spent', async () => {
		using _groq = withEnv('GROQ_API_KEY', 'test-key')
		consoleError.mockImplementation(() => {})
		const session = await proUser()
		server.use(
			http.post(GROQ_URL, () => new HttpResponse(null, { status: 400 })),
		)

		const result = await call(
			transcribeAction,
			'/resources/transcribe',
			session,
			audioForm(),
		)

		expect(result.status).toBe(422)
		expect(await uses(session.userId)).toBe(1)
	})

	test('a Whisper timeout keeps the use spent', async () => {
		using _groq = withEnv('GROQ_API_KEY', 'test-key')
		using _timeout = timeOutRequests()
		consoleError.mockImplementation(() => {})
		const session = await proUser()
		server.use(http.post(GROQ_URL, () => HttpResponse.json({ text: 'eggs' })))

		const result = await call(
			transcribeAction,
			'/resources/transcribe',
			session,
			audioForm(),
		)

		expect(result.body.error).toBe(
			'Voice transcription timed out. Please try again.',
		)
		expect(await uses(session.userId)).toBe(1)
	})

	test('audio Whisper heard but could not use keeps the use spent', async () => {
		using _groq = withEnv('GROQ_API_KEY', 'test-key')
		const session = await proUser()
		server.use(
			http.post(GROQ_URL, () => HttpResponse.json({ text: 'Thank you.' })),
		)

		const result = await call(
			transcribeAction,
			'/resources/transcribe',
			session,
			audioForm(),
		)

		expect(result.status).toBe(422)
		expect(await uses(session.userId)).toBe(1)
	})
})

describe('AI extraction', () => {
	test('a 503 gives the use back', async () => {
		using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
		consoleError.mockImplementation(() => {})
		const session = await proUser()
		server.use(
			http.post(ANTHROPIC_URL, () => new HttpResponse(null, { status: 503 })),
		)

		const result = await call(
			importAction,
			'/recipes/import',
			session,
			form({ intent: 'extract-text', rawText: 'Warm a can of chickpeas.' }),
		)

		expect(result.status).toBe(422)
		expect(await uses(session.userId)).toBe(0)
	})

	test('a timeout keeps the use spent', async () => {
		using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
		using _timeout = timeOutRequests()
		consoleError.mockImplementation(() => {})
		const session = await proUser()
		server.use(
			http.post(ANTHROPIC_URL, () => new HttpResponse(null, { status: 500 })),
		)

		const result = await call(
			importAction,
			'/recipes/import',
			session,
			form({ intent: 'extract-text', rawText: 'Warm a can of chickpeas.' }),
		)

		expect(result.body.error).toBe(
			'Recipe extraction timed out. Please try again.',
		)
		expect(await uses(session.userId)).toBe(1)
	})

	test('a refusal keeps the use spent', async () => {
		using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
		consoleError.mockImplementation(() => {})
		const session = await proUser()
		server.use(
			http.post(ANTHROPIC_URL, () =>
				HttpResponse.json({
					stop_reason: 'refusal',
					content: [{ type: 'text', text: '{"title":' }],
				}),
			),
		)

		const result = await call(
			importAction,
			'/recipes/import',
			session,
			form({ intent: 'extract-text', rawText: 'Warm a can of chickpeas.' }),
		)

		expect(result.status).toBe(422)
		expect(await uses(session.userId)).toBe(1)
	})

	test('a file that is not an image spends nothing', async () => {
		using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
		const session = await proUser()
		let modelCalls = 0
		server.use(
			http.post(ANTHROPIC_URL, () => {
				modelCalls++
				return new HttpResponse(null, { status: 500 })
			}),
		)

		const result = await call(
			importAction,
			'/recipes/import',
			session,
			form({
				intent: 'extract-image',
				image: new File(
					[new TextEncoder().encode('this is plain text, not a PNG')],
					'recipe.png',
					{ type: 'image/png' },
				),
			}),
		)

		expect(result.status).toBe(400)
		expect(result.body.error).toBe(
			'Invalid image file. Please upload JPEG, PNG, or WebP images.',
		)
		expect(modelCalls).toBe(0)
		expect(await uses(session.userId)).toBe(0)
	})
})

describe('Recipe enhance', () => {
	test('a Recipe that does not exist spends nothing', async () => {
		using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
		const session = await proUser()

		const result = await call(
			enhanceAction,
			'/resources/enhance-recipe',
			session,
			form({ recipeId: 'no_such_recipe' }),
		)

		expect(result.status).toBe(404)
		expect(await uses(session.userId)).toBe(0)
	})

	test('a 429 gives the use back', async () => {
		using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
		consoleError.mockImplementation(() => {})
		const session = await proUser()
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Plain chickpeas',
				userId: session.userId,
				householdId: session.householdId,
			},
			select: { id: true },
		})
		server.use(
			http.post(ANTHROPIC_URL, () => new HttpResponse(null, { status: 429 })),
		)

		const result = await call(
			enhanceAction,
			'/resources/enhance-recipe',
			session,
			form({ recipeId: recipe.id }),
		)

		expect(result.body.error).toBe(
			'Recipe enhance hit a rate limit. Please wait a moment and try again.',
		)
		expect(await uses(session.userId)).toBe(0)
	})
})
