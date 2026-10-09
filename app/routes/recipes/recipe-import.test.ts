import { http, HttpResponse } from 'msw'
import sharp from 'sharp'
import { server } from '#tests/setup/mocks-setup.ts'
import { RouterContextProvider } from 'react-router'
import { expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { ACCEPT_ENCODING } from '#app/utils/bounded-body.server.ts'
import { MAX_RECIPE_TITLE_LENGTH } from '#app/utils/recipe-validation.ts'
import { action as importAction, loader as importLoader } from './import.tsx'
import { loader as detailLoader } from './$recipeId.tsx'
import { action as editAction } from './$recipeId_.edit.tsx'
import { loader as fullExport } from '../resources/export-all-data.tsx'
import { loader as recipeExport } from '../resources/export-recipes.tsx'
import { action as restoreAction } from '../settings/profile/import.tsx'
import {
	loader as shareLoader,
	action as shareAction,
} from '../share.$recipeId.tsx'
import '#tests/setup/db-setup.ts'

const posthog = vi.hoisted(() => ({
	captureServerEvent:
		vi.fn<
			(
				userId: string,
				event: string,
				properties?: Record<string, unknown>,
			) => void
		>(),
}))
vi.mock('#app/utils/posthog.server.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	captureServerEvent: posthog.captureServerEvent,
}))

/** The `ai_feature_used` properties the last extraction reported. */
function lastExtractionEvent() {
	const call = posthog.captureServerEvent.mock.calls
		.filter(([, event]) => event === 'ai_feature_used')
		.at(-1)
	return call?.[2] as Record<string, unknown> | undefined
}

// URL imports resolve their host once, then connect to the checked address
// and name the host in the Host header. This file's hosts are fictional, so
// they resolve to a public address here, and their pages are mocked there.
vi.mock('node:dns/promises', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:dns/promises')>()),
	lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}))
const CHECKED_ORIGIN = 'https://93.184.216.34'

const chickpeaLine =
	'2 cans chickpeas, drained and rinsed thoroughly under cold running water (reserve the liquid for another recipe; if using dried chickpeas instead, soak them overnight and simmer until completely tender before measuring the equivalent cooked weight)'
const title = 'Chickpea lunch'
const rawText = `Ingredients\n${chickpeaLine}\n1 lemon\nInstructions\nToss the chickpeas with lemon juice and serve.`
const source = `${title}\n\n${rawText}`
async function user() {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: {
				create: { ...createUser(), subscription: { create: { tier: 'pro' } } },
			},
		},
	})
	const household = await prisma.household.create({
		data: {
			name: 'Disposable capture household',
			members: { create: { userId: session.userId, role: 'owner' } },
		},
	})
	return { ...session, householdId: household.id }
}
async function args(
	session: { id: string } | null,
	path: string,
	fields?: Record<string, string>,
	params: Record<string, string> = {},
) {
	return {
		params: params as { recipeId: string },
		context: new RouterContextProvider(),
		pattern: path,
		url: new URL(`${BASE_URL}${path}`),
		request: new Request(`${BASE_URL}${path}`, {
			headers: session ? { cookie: await getSessionCookieHeader(session) } : {},
			...(fields ? { method: 'POST', body: new URLSearchParams(fields) } : {}),
		}),
	}
}
/**
 * Runs one import, which saves at once, and returns the saved Recipe's id and
 * the notice its redirect asks the Recipe page for.
 */
async function importRecipe(
	session: { id: string },
	fields: Record<string, string> = { intent: 'parse-text', rawText: source },
) {
	const response = await importAction(
		await args(session, '/recipes/import', fields),
	)
	expect(response).toBeInstanceOf(Response)
	const location = new URL(
		(response as Response).headers.get('location')!,
		BASE_URL,
	)
	expect(location.pathname).toMatch(/^\/recipes\/[a-z0-9]+$/)
	return {
		id: location.pathname.split('/').at(-1)!,
		notice: location.searchParams,
	}
}
async function recipeCount(householdId: string) {
	return prisma.recipe.count({ where: { householdId } })
}
test('Text import saves at once and retains the long chickpea amount and preparation note through reload and normal editing', async () => {
	const session = await user()
	const { id: recipeId, notice } = await importRecipe(session)
	expect(notice.get('imported')).toBe('text')
	expect(notice.has('shortened')).toBe(false)
	const loaded = await detailLoader(
		await args(session, `/recipes/${recipeId}`, undefined, { recipeId }),
	)
	expect(loaded.recipe.ingredients).toHaveLength(2)
	const chickpea = loaded.recipe.ingredients[0]!
	expect(chickpea).toMatchObject({
		name: 'chickpeas',
		amount: '2',
		unit: 'cans',
	})
	expect(chickpea.notes).toContain('drained and rinsed thoroughly')
	expect(chickpea.notes).toContain('equivalent cooked weight')
	expect(loaded.recipe.ingredients[1]).toMatchObject({
		name: 'lemon',
		amount: '1',
	})
	expect(loaded.recipe.rawText).toBe(source)
	const edited = await editAction(
		await args(
			session,
			`/recipes/${recipeId}/edit`,
			{
				title,
				'ingredients[0].name': chickpea.name,
				'ingredients[0].amount': chickpea.amount!,
				'ingredients[0].unit': chickpea.unit!,
				'ingredients[0].notes': chickpea.notes!,
				'ingredients[1].name': 'lemon',
				'ingredients[1].amount': '1',
				'instructions[0].content':
					'Toss the chickpeas with lemon juice and serve.',
			},
			{ recipeId },
		),
	)
	expect(edited).toBeInstanceOf(Response)
	expect(
		(
			await detailLoader(
				await args(session, `/recipes/${recipeId}`, undefined, { recipeId }),
			)
		).recipe.rawText,
	).toBe(source)
})
test('text source preserves the original title and exact text before normalization', async () => {
	const session = await user()
	const rawText =
		'  Pho (Serves 2)\n\nIngredients\n1 lemon\nInstructions\nKeep “this” exactly.\n'
	await importRecipe(session, { intent: 'parse-text', rawText })
	expect(
		await prisma.recipe.findFirst({
			where: { householdId: session.householdId },
		}),
		// Deterministic parsing produces no cook's notes.
	).toMatchObject({ rawText, yieldAmount: 2, notes: null })
})
test('source survives full household and Recipe-only JSON recovery; older exports still import', async () => {
	const session = await user()
	await importRecipe(session)
	for (const exporter of [fullExport, recipeExport]) {
		const exported = (await (
			await exporter(await args(session, '/resources/export'))
		).json()) as { recipes: Array<{ rawText?: string }> }
		expect(exported.recipes[0]!.rawText).toBe(source)
		const recipient = await user()
		await restoreAction(
			await args(recipient, '/settings/profile/import', {
				importData: JSON.stringify(exported),
			}),
		)
		expect(
			await prisma.recipe.findFirst({
				where: { householdId: recipient.householdId },
			}),
		).toMatchObject({ rawText: source })
		delete exported.recipes[0]!.rawText
		const olderRecipient = await user()
		await restoreAction(
			await args(olderRecipient, '/settings/profile/import', {
				importData: JSON.stringify(exported),
			}),
		)
		expect(
			await prisma.recipe.findFirst({
				where: { householdId: olderRecipient.householdId },
			}),
		).toMatchObject({ rawText: null })
	}
})
test('anonymous share omits source; authenticated Save to my Recipes copies it into the recipient household', async () => {
	const session = await user()
	const { id: recipeId } = await importRecipe(session)
	const displayed = await shareLoader(
		await args(null, `/share/${recipeId}`, undefined, { recipeId }),
	)
	expect(displayed.recipe).not.toHaveProperty('rawText')
	const recipient = await user()
	await shareAction(
		await args(recipient, `/share/${recipeId}`, {}, { recipeId }),
	)
	expect(
		await prisma.recipe.findFirst({
			where: { householdId: recipient.householdId },
		}),
	).toMatchObject({ rawText: source })
})
test('a failed save writes nothing and says so on the form; trying again saves without extraction', async () => {
	const session = await user()
	// The save writes the Recipe and its classifications in one transaction.
	const failure = vi
		.spyOn(prisma, '$transaction')
		.mockRejectedValueOnce(new Error('Synthetic persistence failure'))
	consoleError.mockImplementation(() => {})
	const failed = await importAction(
		await args(session, '/recipes/import', {
			intent: 'parse-text',
			rawText: source,
		}),
	)
	failure.mockRestore()
	expect(failed).toMatchObject({
		init: { status: 503 },
		data: {
			intent: 'parse-text',
			error: 'Nothing was saved. Try again in a moment.',
			existing: null,
		},
	})
	expect(consoleError).toHaveBeenCalledTimes(1)
	expect(await recipeCount(session.householdId)).toBe(0)
	await importRecipe(session)
	expect(await recipeCount(session.householdId)).toBe(1)
	expect(
		await prisma.usageEvent.count({ where: { userId: session.userId } }),
	).toBe(0)
})

test('an import over the field limits saves, and its redirect names what was shortened', async () => {
	const session = await user()
	const longTitle = 'Lemony chickpea and herb salad '.repeat(5).trim()
	const { id, notice } = await importRecipe(session, {
		intent: 'parse-text',
		rawText: `${longTitle}\nIngredients\n1 lemon\nInstructions\nSqueeze.`,
	})
	expect(notice.get('shortened')).toBe('title')
	const saved = await prisma.recipe.findUniqueOrThrow({ where: { id } })
	expect(saved.title.length).toBeLessThanOrEqual(100)
	expect(saved.title).toMatch(/^Lemony chickpea .*…$/)
	expect(saved.rawText).toContain(longTitle)
})

test('headings stay headings; an import missing its steps saves without them; text with neither ingredients nor steps saves nothing', async () => {
	const session = await user()
	const { id } = await importRecipe(session, {
		intent: 'parse-text',
		rawText:
			'Supper\nIngredients\nFor the dressing:\n1 lemon\nInstructions\nSqueeze.\nIngredients\n2 cans chickpeas\nInstructions\nToss.',
	})
	const supper = await prisma.recipe.findUniqueOrThrow({
		where: { id },
		include: {
			ingredients: { orderBy: { order: 'asc' } },
			instructions: true,
		},
	})
	expect(supper.ingredients).toHaveLength(3)
	expect(supper.ingredients[0]).toMatchObject({
		name: 'Dressing',
		isHeading: true,
		amount: null,
	})
	expect(supper.instructions).toHaveLength(2)

	const { id: lemonId } = await importRecipe(session, {
		intent: 'parse-text',
		rawText: 'Lemon\nIngredients\n1 lemon',
	})
	expect(
		await prisma.recipe.findUniqueOrThrow({
			where: { id: lemonId },
			include: { ingredients: true, instructions: true },
		}),
	).toMatchObject({
		title: 'Lemon',
		ingredients: [expect.objectContaining({ name: 'lemon', amount: '1' })],
		instructions: [],
	})

	const nothing = await importAction(
		await args(session, '/recipes/import', {
			intent: 'parse-text',
			rawText: 'Family notes\nServe with whatever greens are left.',
		}),
	)
	expect(nothing).toMatchObject({
		init: { status: 400 },
		data: { intent: 'parse-text', existing: null },
	})
	expect(await recipeCount(session.householdId)).toBe(2)
})

test('URL import saves the structured Recipe with its source, and a second import of the link opens the saved one without fetching again', async () => {
	const session = await user()
	const url = 'https://recipes.example.test/source'
	const description = 'Bright, quick and good cold the next day. '.repeat(14)
	const original = {
		'@type': 'Recipe',
		name: 'Chickpea lunch (Serves 2)',
		description,
		recipeIngredient: [chickpeaLine, '1 lemon'],
		recipeInstructions: ['Serve.'],
		unusualNote: 'Keep this recoverable.',
	}
	let fetches = 0
	server.use(
		http.get(`${CHECKED_ORIGIN}/source`, () => {
			fetches++
			return HttpResponse.html(
				`<script type="application/ld+json">${JSON.stringify(original)}</script>`,
			)
		}),
	)
	const { id, notice } = await importRecipe(session, { intent: 'fetch', url })
	expect(notice.get('imported')).toBe('url')
	// A description over the limit moved whole into Notes: nothing was cut.
	expect(notice.has('shortened')).toBe(false)
	const saved = await prisma.recipe.findUniqueOrThrow({ where: { id } })
	expect(JSON.parse(saved.rawText!)).toEqual(original)
	expect(saved).toMatchObject({
		title: 'Chickpea lunch',
		sourceUrl: url,
		description: null,
		notes: description.trim(),
	})

	const again = await importAction(
		await args(session, '/recipes/import', { intent: 'fetch', url }),
	)
	expect(again).toMatchObject({
		data: {
			intent: 'fetch',
			error: null,
			existing: { id, title: 'Chickpea lunch' },
		},
	})
	expect(fetches).toBe(1)
	expect(await recipeCount(session.householdId)).toBe(1)

	const blocked = await importAction(
		await args(session, '/recipes/import', {
			intent: 'fetch',
			url: 'http://127.0.0.1/internal',
		}),
	)
	expect(blocked).toMatchObject({
		init: { status: 400 },
		data: { existing: null },
	})
})

test('an import with no ingredients or instructions to read saves nothing, so the link still imports once it has them', async () => {
	const session = await user()
	const url = 'https://recipes.example.test/members-only'
	let recipe: Record<string, unknown> = {
		'@type': 'Recipe',
		name: 'Members-only stew',
		description: 'Subscribe to read this recipe.',
	}
	server.use(
		http.get(`${CHECKED_ORIGIN}/members-only`, () =>
			HttpResponse.html(
				`<script type="application/ld+json">${JSON.stringify(recipe)}</script>`,
			),
		),
	)
	const importUrl = async () =>
		importAction(
			await args(session, '/recipes/import', { intent: 'fetch', url }),
		)
	const nothingToRead = {
		init: { status: 400 },
		data: {
			intent: 'fetch',
			error: expect.stringContaining('no ingredients or instructions'),
			existing: null,
		},
	}

	expect(await importUrl()).toMatchObject(nothingToRead)
	// A heading is not something to cook from.
	recipe = { ...recipe, recipeIngredient: ['For the stew:'] }
	expect(await importUrl()).toMatchObject(nothingToRead)
	expect(
		await importAction(
			await args(session, '/recipes/import', {
				intent: 'parse-text',
				rawText: 'Stew\nIngredients\nFor the stew:',
			}),
		),
	).toMatchObject({
		init: { status: 400 },
		data: { intent: 'parse-text', existing: null },
	})
	expect(await recipeCount(session.householdId)).toBe(0)

	recipe = {
		...recipe,
		recipeIngredient: ['For the stew:', '1 kg beef'],
		recipeInstructions: ['Simmer.'],
	}
	const { id } = await importRecipe(session, { intent: 'fetch', url })
	expect(
		await prisma.recipe.findUniqueOrThrow({ where: { id } }),
	).toMatchObject({ title: 'Members-only stew', sourceUrl: url })
})

test('Import names a shared link its Household already has before anything is tapped, and only for that Household', async () => {
	const session = await user()
	const other = await user()
	const url = 'https://recipes.example.test/stew?utm_source=share'
	const saved = await prisma.recipe.create({
		data: {
			title: 'Shared stew',
			sourceUrl: url,
			userId: session.userId,
			householdId: session.householdId,
		},
		select: { id: true, title: true },
	})
	const path = `/recipes/import?url=${encodeURIComponent(url)}`
	expect(await importLoader(await args(session, path))).toMatchObject({
		sharedUrl: url,
		sharedExisting: saved,
	})
	expect(await importLoader(await args(other, path))).toMatchObject({
		sharedUrl: url,
		sharedExisting: null,
	})
})

test('URL extraction refuses a public page that redirects into the private network', async () => {
	const session = await user()
	const internalHits: Array<string> = []
	server.use(
		http.get(`${CHECKED_ORIGIN}/moved`, () =>
			HttpResponse.redirect('http://169.254.169.254/latest/meta-data', 302),
		),
		http.get('http://169.254.169.254/latest/meta-data', ({ request }) => {
			internalHits.push(request.url)
			return HttpResponse.text('secret')
		}),
	)

	const result = await importAction(
		await args(session, '/recipes/import', {
			intent: 'fetch',
			url: 'https://recipes.example.test/moved',
		}),
	)

	expect(result).toMatchObject({
		init: { status: 400 },
		data: { existing: null },
	})
	expect(internalHits).toEqual([])
})

test('URL extraction times out on a page that sends its headers and then stalls', async () => {
	const session = await user()
	let bodyStarted!: () => void
	const started = new Promise<void>((resolve) => (bodyStarted = resolve))
	server.use(
		http.get(
			`${CHECKED_ORIGIN}/stalls`,
			() =>
				new HttpResponse(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode('<html><head>'))
						},
						pull() {
							bodyStarted()
							return new Promise(() => {})
						},
					}),
					{ headers: { 'Content-Type': 'text/html' } },
				),
		),
	)

	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
	try {
		const result = importAction(
			await args(session, '/recipes/import', {
				intent: 'fetch',
				url: 'https://recipes.example.test/stalls',
			}),
		)
		await started
		await vi.advanceTimersByTimeAsync(10_000)

		expect(await result).toMatchObject({
			init: { status: 400 },
			data: {
				existing: null,
				error: 'Request timed out. The site took too long to respond.',
			},
		})
	} finally {
		vi.useRealTimers()
	}
})

test('URL extraction refuses a page that decodes past 5 MB whatever its Content-Length says, and stops reading it', async () => {
	const session = await user()
	const chunk = new Uint8Array(64 * 1024).fill(97)
	let servedBytes = 0
	let pageRequest: Request | undefined
	server.use(
		http.get(`${CHECKED_ORIGIN}/huge`, ({ request }) => {
			pageRequest = request
			return new HttpResponse(
				new ReadableStream({
					pull(controller) {
						if (servedBytes >= 16 * 1024 * 1024) return controller.close()
						servedBytes += chunk.byteLength
						controller.enqueue(chunk)
					},
				}),
				{
					headers: { 'Content-Type': 'text/html', 'Content-Length': '2048' },
				},
			)
		}),
	)

	const result = await importAction(
		await args(session, '/recipes/import', {
			intent: 'fetch',
			url: 'https://recipes.example.test/huge',
		}),
	)

	expect(result).toMatchObject({
		init: { status: 400 },
		data: { existing: null, error: 'Page is too large to import.' },
	})
	expect(servedBytes).toBeLessThan(6 * 1024 * 1024)
	// Bun keeps downloading a cancelled body until its request is aborted.
	expect(pageRequest?.signal.aborted).toBe(true)
})

test('URL extraction aborts a page that answers with an error status instead of leaving its body streaming', async () => {
	const session = await user()
	let pageRequest: Request | undefined
	server.use(
		http.get(`${CHECKED_ORIGIN}/gone`, ({ request }) => {
			pageRequest = request
			return new HttpResponse(
				new ReadableStream({
					pull(controller) {
						controller.enqueue(new Uint8Array(64 * 1024).fill(97))
					},
				}),
				{ status: 404, headers: { 'Content-Type': 'text/html' } },
			)
		}),
	)

	const result = await importAction(
		await args(session, '/recipes/import', {
			intent: 'fetch',
			url: 'https://recipes.example.test/gone',
		}),
	)

	expect(result).toMatchObject({
		init: { status: 400 },
		data: { existing: null, error: 'Failed to fetch URL (404)' },
	})
	expect(pageRequest?.signal.aborted).toBe(true)
})

test('URL extraction reports unreadable recipe data as a parse error, not a fetch error', async () => {
	const session = await user()
	server.use(
		http.get(`${CHECKED_ORIGIN}/string-ingredients`, () =>
			HttpResponse.html(
				`<script type="application/ld+json">${JSON.stringify({
					'@type': 'Recipe',
					name: title,
					recipeIngredient: '2 cans chickpeas\n1 lemon',
				})}</script>`,
			),
		),
	)

	const result = await importAction(
		await args(session, '/recipes/import', {
			intent: 'fetch',
			url: 'https://recipes.example.test/string-ingredients',
		}),
	)

	expect(result).toMatchObject({
		init: { status: 400 },
		data: {
			intent: 'fetch',
			existing: null,
			error: 'The recipe data on this page could not be read.',
		},
	})
})

test('URL extraction asks only for the encodings it can decode', async () => {
	const session = await user()
	let acceptEncoding: string | null = null
	server.use(
		http.get(`${CHECKED_ORIGIN}/plain`, ({ request }) => {
			acceptEncoding = request.headers.get('Accept-Encoding')
			return HttpResponse.html('<p>No recipe here.</p>')
		}),
	)

	await importAction(
		await args(session, '/recipes/import', {
			intent: 'fetch',
			url: 'https://recipes.example.test/plain',
		}),
	)

	expect(acceptEncoding).toBe(ACCEPT_ENCODING)
})

test('image extraction saves the extracted structure and its notes with one provider call', async () => {
	const session = await user()
	const oldKey = process.env.ANTHROPIC_API_KEY
	process.env.ANTHROPIC_API_KEY = 'test-key'
	try {
		let calls = 0
		const structure = {
			title: 'Image chickpeas',
			description: null,
			notes: 'Keeps three days in the fridge. Swap in butter beans.',
			activeTime: 5,
			totalTime: 20,
			yieldAmount: 2,
			yieldLabel: 'bowls',
			ingredients: [
				{
					name: 'chickpeas',
					amount: '2',
					unit: 'cans',
					notes: null,
					isHeading: false,
				},
			],
			instructions: [{ content: 'Warm and serve.' }],
			// The response now carries a group per dimension; this one suggests
			// nothing, and the household has no values to match anyway.
			metadata: { cuisine: [], season: [], course: [] },
		}
		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				calls++
				return HttpResponse.json({
					content: [{ type: 'text', text: JSON.stringify(structure) }],
				})
			}),
		)
		const body = new FormData()
		body.set('intent', 'extract-image')
		body.set(
			'image',
			new File(
				[
					new Uint8Array(
						await sharp({
							create: {
								width: 10,
								height: 10,
								channels: 3,
								background: '#ffffff',
							},
						})
							.png()
							.toBuffer(),
					),
				],
				'fixture.png',
				{ type: 'image/png' },
			),
		)
		const routeArgs = await args(session, '/recipes/import')
		routeArgs.request = new Request(`${BASE_URL}/recipes/import`, {
			method: 'POST',
			body,
			headers: { cookie: await getSessionCookieHeader(session) },
		})
		const result = await importAction(routeArgs)
		expect(result).toBeInstanceOf(Response)
		expect((result as Response).headers.get('location')).toMatch(
			/\?imported=images$/,
		)
		// How long the extraction took, in whole milliseconds, so the model
		// change can be compared in PostHog.
		expect(lastExtractionEvent()).toMatchObject({
			feature: 'recipe_extract',
			source: 'image',
			duration_ms: expect.any(Number),
		})
		expect(Number.isInteger(lastExtractionEvent()!.duration_ms)).toBe(true)
		expect(calls).toBe(1)
		expect(
			await prisma.usageEvent.count({
				where: { userId: session.userId, type: 'recipe_extract_llm_call' },
			}),
		).toBe(1)
		const saved = await prisma.recipe.findFirstOrThrow({
			where: { householdId: session.householdId },
		})
		expect(JSON.parse(saved.rawText!)).toEqual(structure)
		// The cook's notes reach Recipe.notes.
		expect(saved.notes).toBe(structure.notes)
	} finally {
		if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY
		else process.env.ANTHROPIC_API_KEY = oldKey
	}
})

test('AI suggestions the household can name are saved as the classification; others are dropped, never created', async () => {
	const session = await user()
	const oldKey = process.env.ANTHROPIC_API_KEY
	process.env.ANTHROPIC_API_KEY = 'test-key'
	try {
		await Promise.all(
			[
				{ dimension: 'cuisine', name: 'Italian' },
				{ dimension: 'season', name: 'Summer' },
			].map((value) =>
				prisma.recipeMetadataValue.create({
					data: {
						...value,
						nameKey: value.name.toLowerCase(),
						householdId: session.householdId,
					},
					select: { id: true, name: true },
				}),
			),
		)
		server.use(
			http.post('https://api.anthropic.com/v1/messages', () =>
				HttpResponse.json({
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								title: 'Suggested pasta',
								description: null,
								notes: null,
								activeTime: null,
								totalTime: null,
								yieldAmount: null,
								yieldLabel: null,
								ingredients: [
									{
										name: 'pasta',
										amount: '200',
										unit: 'g',
										notes: null,
										isHeading: false,
									},
								],
								instructions: [{ content: 'Boil the pasta.' }],
								metadata: {
									// One match per dimension the household can name, plus a
									// Course it cannot: that one is dropped, never created.
									cuisine: ['italian'],
									season: ['Summer'],
									course: ['Supper'],
								},
							}),
						},
					],
				}),
			),
		)

		await importRecipe(session, {
			intent: 'extract-text',
			rawText: 'Boil 200g of pasta.',
		})
		expect(lastExtractionEvent()).toMatchObject({
			feature: 'recipe_extract',
			source: 'text',
			duration_ms: expect.any(Number),
		})
		expect(Number.isInteger(lastExtractionEvent()!.duration_ms)).toBe(true)
		expect(
			await prisma.recipeMetadataValue.count({
				where: { householdId: session.householdId },
			}),
		).toBe(2)
		const saved = await prisma.recipe.findFirstOrThrow({
			where: { householdId: session.householdId },
			select: {
				metadataAssignments: { select: { value: { select: { name: true } } } },
			},
		})
		expect(saved.metadataAssignments.map((a) => a.value.name).sort()).toEqual([
			'Italian',
			'Summer',
		])
	} finally {
		if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY
		else process.env.ANTHROPIC_API_KEY = oldKey
	}
})

test('an AI import with only ingredients saves and leaves the steps to the cook; one with nothing to cook from saves nothing', async () => {
	const session = await user()
	const oldKey = process.env.ANTHROPIC_API_KEY
	process.env.ANTHROPIC_API_KEY = 'test-key'
	const answer = (ingredients: unknown[]) => ({
		title: 'Garlic noodles',
		description: null,
		notes: null,
		activeTime: null,
		totalTime: null,
		yieldAmount: null,
		yieldLabel: null,
		ingredients,
		instructions: [],
		metadata: { cuisine: [], season: [], course: [] },
	})
	const answers = [
		answer([
			{
				name: 'garlic',
				amount: '3',
				unit: 'cloves',
				notes: 'minced',
				isHeading: false,
			},
		]),
		answer([
			{ name: 'Sauce', amount: null, unit: null, notes: null, isHeading: true },
		]),
	]
	try {
		server.use(
			http.post('https://api.anthropic.com/v1/messages', () =>
				HttpResponse.json({
					content: [{ type: 'text', text: JSON.stringify(answers.shift()) }],
				}),
			),
		)
		const { id, notice } = await importRecipe(session, {
			intent: 'extract-text',
			rawText: 'Garlic noodles\n3 cloves garlic, minced\nMethod in the video!',
		})
		expect(notice.get('imported')).toBe('text')
		expect(
			await prisma.recipe.findUniqueOrThrow({
				where: { id },
				include: { ingredients: true, instructions: true },
			}),
		).toMatchObject({
			ingredients: [
				expect.objectContaining({
					name: 'garlic',
					amount: '3',
					unit: 'cloves',
				}),
			],
			instructions: [],
		})

		// A refused answer is logged as a schema failure.
		consoleError.mockImplementation(() => {})
		const nothing = await importAction(
			await args(session, '/recipes/import', {
				intent: 'extract-text',
				rawText: 'Sauce',
			}),
		)
		expect(consoleError).toHaveBeenCalledTimes(1)
		expect(nothing).toMatchObject({
			data: {
				intent: 'extract-text',
				error: expect.stringMatching(/Couldn't find a recipe/),
				existing: null,
			},
		})
		expect(await recipeCount(session.householdId)).toBe(1)
	} finally {
		if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY
		else process.env.ANTHROPIC_API_KEY = oldKey
	}
})

test('an AI import over a limit is shortened at a word and the notice says so, like every other import', async () => {
	const session = await user()
	const oldKey = process.env.ANTHROPIC_API_KEY
	process.env.ANTHROPIC_API_KEY = 'test-key'
	const longTitle = `${'Slow-cooked '.repeat(12)}beans`
	const longDescription = `${'A bowl of beans for a cold evening. '.repeat(20)}Serve hot.`
	try {
		server.use(
			http.post('https://api.anthropic.com/v1/messages', () =>
				HttpResponse.json({
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								title: longTitle,
								description: longDescription,
								notes: null,
								activeTime: null,
								totalTime: null,
								yieldAmount: null,
								yieldLabel: null,
								ingredients: [
									{
										name: 'beans',
										amount: '2',
										unit: 'cans',
										notes: null,
										isHeading: false,
									},
								],
								instructions: [{ content: 'Warm the beans.' }],
								metadata: { cuisine: [], season: [], course: [] },
							}),
						},
					],
				}),
			),
		)
		const { id, notice } = await importRecipe(session, {
			intent: 'extract-text',
			rawText: `${longTitle}\n${longDescription}\n2 cans beans\nWarm the beans.`,
		})
		expect(notice.get('shortened')).toBe('title')
		const saved = await prisma.recipe.findUniqueOrThrow({ where: { id } })
		expect(saved.title).toMatch(/^Slow-cooked( Slow-cooked)+…$/)
		expect(saved.title.length).toBeLessThanOrEqual(MAX_RECIPE_TITLE_LENGTH)
		// A long description moves whole into Notes instead of being cut.
		expect(saved.description).toBeNull()
		expect(saved.notes).toBe(longDescription)
	} finally {
		if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY
		else process.env.ANTHROPIC_API_KEY = oldKey
	}
})

test("an import needs a signed-in user and saves into that user's household, whatever the form says", async () => {
	const session = await user()
	const other = await user()
	await expect(
		importAction(
			await args(null, '/recipes/import', {
				intent: 'parse-text',
				rawText: source,
			}),
		),
	).rejects.toMatchObject({ status: 302 })
	const { id } = await importRecipe(session, {
		intent: 'parse-text',
		rawText: source,
		userId: other.userId,
		householdId: other.householdId,
	})
	expect(await prisma.recipe.findUnique({ where: { id } })).toMatchObject({
		userId: session.userId,
		householdId: session.householdId,
	})
	expect(await recipeCount(other.householdId)).toBe(0)
})
