/**
 * The daily caps on paid AI calls, at the routes. A use comes back only when
 * the call failed in a way a user can't cause, such as no key, a bad key or
 * retired model (401, 403, 404), a 429, a 5xx, or a dropped connection.
 * Refunding anything else would let slow or bad input buy unlimited paid
 * calls.
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

async function proUser({ demo = false } = {}) {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: {
					create: {
						...createUser(),
						demoExpiresAt: demo ? new Date(Date.now() + 3_600_000) : null,
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
	// Every new signup gets a Pro trial, so voice input needs a cap too.
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

	// Groq may have finished and billed the call.
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
			'That took too long to turn into text. Try again.',
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
			'Reading the Recipe took too long. Try again.',
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

// A user can send these at will, and each one costs CPU.
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
		'We couldn’t read these images. Try other screenshots.',
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

// Its header says what it would cost to decode.
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
		error: 'We couldn’t read these images. Try other screenshots.',
		refundable: false,
	})
	expect(modelCalls).toBe(0)
})

// The photo is small on disk as a flat baseline JPEG and shrinks as it loads,
// so the decoded-size check lets it through.
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
			'Too many suggestion requests at once. Wait a moment and try again.',
		)
		expect(await uses(session.userId)).toBe(0)
	})
})

describe('demo users', () => {
	/** A demo user who has already spent the demo's uses of `type` today. */
	async function demoUserAtCap(type: string) {
		const session = await proUser({ demo: true })
		await prisma.usageEvent.createMany({
			data: Array.from({ length: 3 }, () => ({ type, userId: session.userId })),
		})
		return session
	}

	function countProviderCalls() {
		let calls = 0
		server.use(
			http.post(GROQ_URL, () => {
				calls++
				return HttpResponse.json({ text: '2 lb apples' })
			}),
			http.post(ANTHROPIC_URL, () => {
				calls++
				return HttpResponse.json({ content: [] })
			}),
		)
		return () => calls
	}

	test('voice adds stop after the demo allows, and say so', async () => {
		using _groq = withEnv('GROQ_API_KEY', 'test-key')
		const calls = countProviderCalls()
		const session = await demoUserAtCap('voice_transcribe_call')

		const refused = await call(
			transcribeAction,
			'/resources/transcribe',
			session,
			audioForm(),
		)

		expect(refused.status).toBe(429)
		expect(refused.body.error).toBe(
			'The demo allows 3 voice entries. Sign up to keep adding by voice.',
		)
		expect(calls()).toBe(0)
	})

	test('enhances stop after the demo allows, and say so', async () => {
		using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
		const calls = countProviderCalls()
		const session = await demoUserAtCap('recipe_enhance_llm_call')
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Soup',
				userId: session.userId,
				householdId: session.householdId,
			},
		})

		const refused = await call(
			enhanceAction,
			'/resources/enhance-recipe',
			session,
			form({ recipeId: recipe.id }),
		)

		expect(refused.status).toBe(429)
		expect(refused.body.error).toBe(
			'The demo allows 3 suggestion requests. Sign up to keep getting suggestions.',
		)
		expect(calls()).toBe(0)
	})

	test('imports stop after the demo allows, and say so', async () => {
		using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
		const calls = countProviderCalls()
		const session = await demoUserAtCap('recipe_extract_llm_call')

		const refused = await call(
			importAction,
			'/recipes/import',
			session,
			form({ intent: 'extract-text', rawText: 'Soup. Boil water.' }),
		)

		expect(refused.status).toBe(429)
		expect(refused.body.error).toBe(
			'The demo allows 3 AI imports. Sign up to keep importing.',
		)
		expect(calls()).toBe(0)
	})

	test("a demo user is refused once the demo's AI is used up for today", async () => {
		using _anthropic = withEnv('ANTHROPIC_API_KEY', 'test-key')
		const calls = countProviderCalls()
		const session = await proUser({ demo: true })
		await prisma.demoAiUsage.createMany({
			data: Array.from({ length: 60 }, () => ({
				type: 'recipe_extract_llm_call',
			})),
		})

		const refused = await call(
			importAction,
			'/recipes/import',
			session,
			form({ intent: 'extract-text', rawText: 'Soup. Boil water.' }),
		)

		expect(refused.status).toBe(429)
		expect(refused.body.error).toBe(
			"The demo's AI is used up for today. Try again tomorrow, or sign up.",
		)
		expect(calls()).toBe(0)
	})
})
