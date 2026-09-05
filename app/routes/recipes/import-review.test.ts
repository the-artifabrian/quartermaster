import { http, HttpResponse } from 'msw'
import sharp from 'sharp'
import { server } from '#tests/mocks/index.ts'
import { RouterContextProvider } from 'react-router'
import { expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as importAction, type ExtractedRecipe } from './import.tsx'
import { loader as detailLoader } from './$recipeId.tsx'
import { action as editAction } from './$recipeId_.edit.tsx'
import { action as saveJsonAction } from '../resources/save-import.tsx'
import { loader as fullExport } from '../resources/export-all-data.tsx'
import { loader as recipeExport } from '../resources/export-recipes.tsx'
import { action as restoreAction } from '../settings/profile/import.tsx'
import {
	loader as shareLoader,
	action as shareAction,
} from '../share.$recipeId.tsx'

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
function reviewFields(recipe: ExtractedRecipe): Record<string, string> {
	const fields: Record<string, string> = {
		intent: 'save',
		title: recipe.title,
		rawText: recipe.rawText,
		sourceUrl: recipe.sourceUrl,
	}
	for (const name of [
		'description',
		'activeTime',
		'totalTime',
		'yieldAmount',
		'yieldLabel',
	] as const) {
		fields[name] = String(recipe[name] ?? '')
	}
	recipe.ingredients.forEach((ingredient, index) => {
		for (const name of [
			'name',
			'amount',
			'unit',
			'notes',
			'isHeading',
		] as const) {
			fields[`ingredients[${index}].${name}`] = String(ingredient[name] ?? '')
		}
	})
	recipe.instructions.forEach(
		(instruction, index) =>
			(fields[`instructions[${index}].content`] = instruction.content),
	)
	return fields
}
async function extract(
	session: { id: string },
	fields: Record<string, string> = { intent: 'parse-text', rawText: source },
) {
	const result = await importAction(
		await args(session, '/recipes/import', fields),
	)
	expect(result).toMatchObject({ data: { error: null } })
	return (result as { data: { recipe: ExtractedRecipe } }).data.recipe
}
async function save(session: { id: string }) {
	const recipe = await extract(session)
	const response = await importAction(
		await args(session, '/recipes/import', reviewFields(recipe)),
	)
	expect(response).toBeInstanceOf(Response)
	return (response as Response).headers.get('location')!.split('/').at(-1)!
}
test('Text import retains the long chickpea amount and preparation note through reload and normal editing', async () => {
	const session = await user()
	const recipeId = await save(session)
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
	const recipe = await extract(session, { intent: 'parse-text', rawText })
	expect(recipe.rawText).toBe(rawText)
	const response = await importAction(
		await args(session, '/recipes/import', reviewFields(recipe)),
	)
	expect(response).toBeInstanceOf(Response)
	expect(
		await prisma.recipe.findFirst({
			where: { householdId: session.householdId },
		}),
	).toMatchObject({ rawText, yieldAmount: 2 })
})
test('source survives full household and Recipe-only JSON recovery; older exports still import', async () => {
	const session = await user()
	await save(session)
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
	const recipeId = await save(session)
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
test('validation and persistence failures retain the entire corrected review; retry saves without extraction', async () => {
	const session = await user()
	const fields = reviewFields(await extract(session))
	fields['ingredients[0].amount'] = '3'
	fields['instructions[0].content'] = 'Serve with extra lemon.'
	const invalid = await importAction(
		await args(session, '/recipes/import', { ...fields, title: '' }),
	)
	expect(invalid).toMatchObject({
		init: { status: 400 },
		data: {
			result: {
				initialValue: {
					rawText: source,
					ingredients: [
						expect.objectContaining({ amount: '3' }),
						expect.anything(),
					],
					instructions: [{ content: 'Serve with extra lemon.' }],
				},
			},
		},
	})
	const failure = vi
		.spyOn(prisma.recipe, 'create')
		.mockRejectedValueOnce(new Error('Synthetic persistence failure'))
	const failed = await importAction(
		await args(session, '/recipes/import', fields),
	)
	failure.mockRestore()
	expect(failed).toMatchObject({
		init: { status: 503 },
		data: { result: { initialValue: { title, rawText: source } } },
	})
	expect(
		await prisma.recipe.count({ where: { householdId: session.householdId } }),
	).toBe(0)
	expect(
		await importAction(await args(session, '/recipes/import', fields)),
	).toBeInstanceOf(Response)
	expect(
		await prisma.recipe.findFirst({
			where: { householdId: session.householdId },
			include: { ingredients: true, instructions: true },
		}),
	).toMatchObject({
		ingredients: expect.arrayContaining([
			expect.objectContaining({ amount: '3' }),
		]),
		instructions: [
			expect.objectContaining({ content: 'Serve with extra lemon.' }),
		],
	})
	expect(
		await prisma.usageEvent.count({ where: { userId: session.userId } }),
	).toBe(0)
})

test('rejects oversized, sparse, empty and malformed rows without dropping entered content or creating a Recipe', async () => {
	const session = await user()
	const fields = reviewFields(await extract(session))
	const tooMany = Object.fromEntries(
		Array.from({ length: 201 }, (_, i) => [
			`ingredients[${i}].name`,
			`Ingredient ${i}`,
		]),
	)
	for (const patch of [
		tooMany,
		{ 'ingredients[4].name': 'Sparse row' },
		{ 'ingredients[0].notes': 'x'.repeat(501) },
		{ 'instructions[0].content': '' },
		{ title: 'x'.repeat(101) },
		{ 'ingredients[0].name': '' },
		{ yieldAmount: '2', yieldLabel: '' },
	]) {
		const result = await importAction(
			await args(session, '/recipes/import', { ...fields, ...patch }),
		)
		expect(result).toMatchObject({
			init: { status: 400 },
			data: {
				result: {
					initialValue: { rawText: source },
					error: expect.any(Object),
				},
			},
		})
	}
	expect(
		await prisma.recipe.count({ where: { householdId: session.householdId } }),
	).toBe(0)
})

test('repeated sections and headings remain editable while unstructured input stays recoverable', async () => {
	const session = await user()
	const recipe = await extract(session, {
		intent: 'parse-text',
		rawText:
			'Supper\nIngredients\nFor the dressing:\n1 lemon\nInstructions\nSqueeze.\nIngredients\n2 cans chickpeas\nInstructions\nToss.',
	})
	expect(recipe.ingredients).toHaveLength(3)
	expect(recipe.instructions).toHaveLength(2)
	const fields = reviewFields(recipe)
	fields['ingredients[0].name'] = 'For the sauce'
	await importAction(await args(session, '/recipes/import', fields))
	expect(
		await prisma.ingredient.findFirst({
			where: { recipe: { householdId: session.householdId } },
			orderBy: { order: 'asc' },
		}),
	).toMatchObject({ name: 'For the sauce', isHeading: true, amount: null })
	const unstructured = await extract(session, {
		intent: 'parse-text',
		rawText: 'Family notes\nServe with whatever greens are left.',
	})
	expect(unstructured.rawText).toContain('whatever greens')
	expect(unstructured.warnings).toEqual(
		expect.arrayContaining(['No ingredients found', 'No instructions found']),
	)
})

test('URL extraction retains original structured Recipe content and URL, keeps duplicate warnings and URL restrictions', async () => {
	const session = await user()
	const url = 'https://recipes.example.test/source'
	const original = {
		'@type': 'Recipe',
		name: 'Chickpea lunch (Serves 2)',
		recipeIngredient: [chickpeaLine, '1 lemon'],
		recipeInstructions: ['Serve.'],
		unusualNote: 'Keep this recoverable.',
	}
	server.use(
		http.get(url, () =>
			HttpResponse.html(
				`<script type="application/ld+json">${JSON.stringify(original)}</script>`,
			),
		),
	)
	const recipe = await extract(session, { intent: 'fetch', url })
	expect(JSON.parse(recipe.rawText)).toEqual(original)
	expect(recipe.sourceUrl).toBe(url)
	await importAction(
		await args(session, '/recipes/import', reviewFields(recipe)),
	)
	const duplicate = await importAction(
		await args(session, '/recipes/import', { intent: 'fetch', url }),
	)
	expect(duplicate).toMatchObject({
		data: {
			duplicates: [expect.objectContaining({ matchReason: 'same-url' })],
		},
	})
	const blocked = await importAction(
		await args(session, '/recipes/import', {
			intent: 'fetch',
			url: 'http://127.0.0.1/internal',
		}),
	)
	expect(blocked).toMatchObject({
		init: { status: 400 },
		data: { recipe: null },
	})
})

test('image extraction preserves the extracted structure through edited save without another provider call', async () => {
	const session = await user()
	const oldKey = process.env.ANTHROPIC_API_KEY
	process.env.ANTHROPIC_API_KEY = 'test-key'
	try {
		let calls = 0
		const structure = {
			title: 'Image chickpeas',
			description: null,
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
		expect(result).toMatchObject({ data: { error: null } })
		const recipe = (result as { data: { recipe: ExtractedRecipe } }).data.recipe
		expect(JSON.parse(recipe.rawText)).toEqual(structure)
		const fields = reviewFields(recipe)
		fields['ingredients[0].amount'] = '3'
		await importAction(await args(session, '/recipes/import', fields))
		expect(calls).toBe(1)
		expect(
			await prisma.usageEvent.count({
				where: { userId: session.userId, type: 'recipe_extract_llm_call' },
			}),
		).toBe(1)
		expect(
			await prisma.recipe.findFirst({
				where: { householdId: session.householdId },
			}),
		).toMatchObject({ rawText: recipe.rawText })
	} finally {
		if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY
		else process.env.ANTHROPIC_API_KEY = oldKey
	}
})

test('JSON review save is authenticated, validates all fields and writes only to the signed-in household', async () => {
	const session = await user()
	const other = await user()
	const fields = reviewFields(await extract(session))
	await expect(
		saveJsonAction(await args(null, '/resources/save-import', fields)),
	).rejects.toMatchObject({ status: 302 })
	const invalid = (await saveJsonAction(
		await args(session, '/resources/save-import', { ...fields, title: '' }),
	)) as Response
	expect(invalid.status).toBe(400)
	expect(await invalid.json()).toMatchObject({
		result: {
			error: { title: ['Title is required'] },
			initialValue: { rawText: source },
		},
	})
	const saved = (await saveJsonAction(
		await args(session, '/resources/save-import', {
			...fields,
			userId: other.userId,
			householdId: other.householdId,
		}),
	)) as Response
	expect(saved.status).toBe(200)
	const { recipeId } = (await saved.json()) as { recipeId: string }
	expect(
		await prisma.recipe.findUnique({ where: { id: recipeId } }),
	).toMatchObject({ userId: session.userId, householdId: session.householdId })
	expect(
		await prisma.recipe.count({ where: { householdId: other.householdId } }),
	).toBe(0)
})
