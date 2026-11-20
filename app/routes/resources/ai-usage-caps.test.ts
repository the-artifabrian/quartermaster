/**
 * Failure list for the daily caps on paid AI calls, at the routes. A use comes
 * back only when the call failed in a way a user can't cause: no key, a bad
 * key or retired model (401, 403, 404), a 429, a 5xx, or a dropped
 * connection. Refunding anything else would let slow or bad input buy
 * unlimited paid calls.
 *
 * 1. Voice input has no cap, and every new signup gets a Pro trial. After 30
 *    uses in a day it must be refused before Whisper is called.
 * 2. A voice request without usable audio spends a use.
 * 3. Whisper answers 401, 403, 404, 429 or 503, or the connection drops: the
 *    use must come back.
 * 4. Whisper answers 400 for the audio it was sent: the use stays spent.
 * 5. Whisper times out: Groq may have finished and billed it, so the use
 *    stays spent.
 * 6. Whisper answers but the audio held nothing usable: the use stays spent.
 * 7. Text extraction gets a 503, or the connection drops: the use must come
 *    back.
 * 8. Text extraction times out: the use stays spent.
 * 9. The model refuses: the use stays spent.
 * 10. Screenshot import with a file that is not an image spends a use.
 * 11. An image that passes the byte check but can't be prepared: the user
 *     can send these at will and each costs us CPU, so the use stays spent.
 * 11a. An image that costs more to decode than a photo may: its header says
 *     so, so it must be refused before a use is spent or it is decoded.
 * 11c. A 24 MP photo of a cookbook page, small on disk as a flat baseline
 *     JPEG, is not refused that way: it shrinks as it loads.
 * 11b. An image over the limit that reaches the extraction anyway must not be
 *     decoded or sent to the model.
 * 12. Enhance on a Recipe that does not exist spends a use.
 * 13. Enhance on another household's Recipe spends a use.
 * 14. Enhance gets a 429: the use must come back.
 * 15. The use can't be recorded: the call must be refused with a 503 and a
 *     message that says to try again soon, without calling the model.
 */
import { http, HttpResponse } from 'msw'
import { RouterContextProvider } from 'react-router'
import sharp from 'sharp'
import { describe, expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { extractRecipeFromImages } from '#app/utils/recipe-extract-llm.server.ts'
import { MAX_DECODED_BYTES } from '#app/utils/recipe-photo.server.ts'
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
	test('is refused after 30 uses in a day, without calling Whisper', async () => {
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

		for (let i = 0; i < 30; i++) {
			const result = await call(
				transcribeAction,
				'/resources/transcribe',
				session,
				audioForm(),
			)
			expect(result.status).toBe(200)
		}
		const refused = await call(
			transcribeAction,
			'/resources/transcribe',
			session,
			audioForm(),
		)

		expect(refused).toEqual({
			status: 429,
			body: {
				error: "You've used today's 30 voice entries. Try again tomorrow.",
				items: [],
				transcription: null,
			},
		})
		expect(whisperCalls).toBe(30)
		expect(await uses(session.userId)).toBe(30)
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

	test.each([
		['401', () => new HttpResponse(null, { status: 401 })],
		['403', () => new HttpResponse(null, { status: 403 })],
		['404', () => new HttpResponse(null, { status: 404 })],
		['429', () => new HttpResponse(null, { status: 429 })],
		['503', () => new HttpResponse(null, { status: 503 })],
		['a dropped connection', () => HttpResponse.error()],
	])('Whisper failing with %s gives the use back', async (_name, respond) => {
		using _groq = withEnv('GROQ_API_KEY', 'test-key')
		consoleError.mockImplementation(() => {})
		const session = await proUser()
		server.use(http.post(GROQ_URL, respond))

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
	test.each([
		['a 503', () => new HttpResponse(null, { status: 503 })],
		['a dropped connection', () => HttpResponse.error()],
	])('%s gives the use back', async (_name, respond) => {
		using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
		consoleError.mockImplementation(() => {})
		const session = await proUser()
		server.use(http.post(ANTHROPIC_URL, respond))

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
			'We can’t use one of the images. Choose a JPG, PNG or WebP.',
		)
		expect(modelCalls).toBe(0)
		expect(await uses(session.userId)).toBe(0)
	})
})

test('an image that can’t be prepared keeps the use spent', async () => {
	using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
	consoleError.mockImplementation(() => {})
	const session = await proUser()
	let modelCalls = 0
	server.use(
		http.post(ANTHROPIC_URL, () => {
			modelCalls++
			return new HttpResponse(null, { status: 500 })
		}),
	)
	const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
	const broken = new Uint8Array([...pngSignature, ...new Uint8Array(32)])

	const result = await call(
		importAction,
		'/recipes/import',
		session,
		form({
			intent: 'extract-image',
			image: new File([broken], 'recipe.png', { type: 'image/png' }),
		}),
	)

	expect(result.body.error).toBe(
		'Could not process the image(s). Please try different images or formats.',
	)
	expect(modelCalls).toBe(0)
	expect(await uses(session.userId)).toBe(1)
})

/** A small 8-bit RGB PNG one row over the decoded-size limit. */
function screenshotOverCap() {
	const width = 4096
	return sharp({
		create: {
			width,
			height: Math.floor(MAX_DECODED_BYTES / (width * 3)) + 1,
			channels: 3,
			background: '#ffffff',
		},
		limitInputPixels: false,
	})
		.png()
		.toBuffer()
}

test('an image over the decoded-size limit is refused before it spends a use', async () => {
	using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
	const session = await proUser()
	let modelCalls = 0
	server.use(
		http.post(ANTHROPIC_URL, () => {
			modelCalls++
			return new HttpResponse(null, { status: 500 })
		}),
	)
	const png = new Uint8Array(await screenshotOverCap())

	const result = await call(
		importAction,
		'/recipes/import',
		session,
		form({
			intent: 'extract-image',
			image: new File([png], 'long.png', { type: 'image/png' }),
		}),
	)

	expect(result.body.error).toBe(
		'One of the images is too big to read. Try a smaller one.',
	)
	expect(modelCalls).toBe(0)
	expect(await uses(session.userId)).toBe(0)
})

test('the extraction refuses an image over the decoded-size limit without sending it', async () => {
	using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
	consoleError.mockImplementation(() => {})
	let modelCalls = 0
	server.use(
		http.post(ANTHROPIC_URL, () => {
			modelCalls++
			return new HttpResponse(null, { status: 500 })
		}),
	)

	const result = await extractRecipeFromImages([
		{
			base64: (await screenshotOverCap()).toString('base64'),
			mediaType: 'image/png',
		},
	])

	expect(result).toEqual({
		error:
			'Could not process the image(s). Please try different images or formats.',
		refundable: false,
	})
	expect(modelCalls).toBe(0)
})

test('a 24 MP photo of a cookbook page reaches the model', async () => {
	using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
	consoleError.mockImplementation(() => {})
	const session = await proUser()
	let modelCalls = 0
	server.use(
		http.post(ANTHROPIC_URL, () => {
			modelCalls++
			return new HttpResponse(null, { status: 500 })
		}),
	)
	const jpeg = await sharp({
		create: { width: 5712, height: 4284, channels: 3, background: '#f4efe6' },
	})
		.jpeg()
		.toBuffer()

	await call(
		importAction,
		'/recipes/import',
		session,
		form({
			intent: 'extract-image',
			image: new File([new Uint8Array(jpeg)], 'IMG_0001.JPG', {
				type: 'image/jpeg',
			}),
		}),
	)

	expect(modelCalls).toBe(1)
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

	test('another household’s Recipe spends nothing', async () => {
		using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
		const session = await proUser()
		const other = await proUser()
		const theirs = await prisma.recipe.create({
			data: {
				title: 'Their chickpeas',
				userId: other.userId,
				householdId: other.householdId,
			},
			select: { id: true },
		})

		const result = await call(
			enhanceAction,
			'/resources/enhance-recipe',
			session,
			form({ recipeId: theirs.id }),
		)

		expect(result.status).toBe(404)
		expect(await uses(session.userId)).toBe(0)
		expect(await uses(other.userId)).toBe(0)
	})

	test('a use that can’t be recorded is refused with a 503', async () => {
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
		let modelCalls = 0
		server.use(
			http.post(ANTHROPIC_URL, () => {
				modelCalls++
				return new HttpResponse(null, { status: 500 })
			}),
		)
		const failure = vi
			.spyOn(prisma, '$transaction')
			.mockRejectedValueOnce(new Error('database is locked'))

		const result = await call(
			enhanceAction,
			'/resources/enhance-recipe',
			session,
			form({ recipeId: recipe.id }),
		)
		failure.mockRestore()

		expect(result).toEqual({
			status: 503,
			body: {
				error: "Couldn't get suggestions just now. Try again in a minute.",
				suggestions: null,
			},
		})
		expect(modelCalls).toBe(0)
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
