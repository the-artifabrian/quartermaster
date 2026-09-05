import { RouterContextProvider } from 'react-router'
import { expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as quickAction } from './quick.tsx'
import { loader as detailLoader } from './$recipeId.tsx'
import { action as editAction } from './$recipeId_.edit.tsx'
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
async function save(session: { id: string }, fields = { title, rawText }) {
	const response = await quickAction(
		await args(session, '/recipes/quick', fields),
	)
	expect(response).toBeInstanceOf(Response)
	return (response as Response).headers
		.get('location')!
		.split('?')[0]!
		.split('/')
		.at(-1)!
}
test('Quick Entry saves the long chickpea amount and preparation note through reload and normal editing', async () => {
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
test('Quick Entry preserves the submitted title and exact original text before normalization', async () => {
	const session = await user()
	const fields = {
		title: 'Pho (Serves 2)',
		rawText: '  **Family notes**\nKeep “this” exactly.\n',
	}
	const id = await save(session, fields)
	const recipe = await prisma.recipe.findUniqueOrThrow({ where: { id } })
	expect(recipe.title).toBe(fields.title)
	expect(recipe.rawText).toBe(`${fields.title}\n\n${fields.rawText}`)
	expect(recipe.description).toBeNull()
	expect(recipe.yieldAmount).toBe(2)
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
test('invalid and failed saves return submitted input with a recoverable error', async () => {
	const session = await user()
	const invalid = await quickAction(
		await args(session, '/recipes/quick', { title: '', rawText }),
	)
	expect(invalid).toMatchObject({
		init: { status: 400 },
		data: { result: { initialValue: { rawText } } },
	})
	vi.spyOn(prisma.recipe, 'create').mockRejectedValueOnce(
		new Error('Synthetic persistence failure'),
	)
	const failed = await quickAction(
		await args(session, '/recipes/quick', { title, rawText }),
	)
	expect(failed).toMatchObject({
		init: { status: 500 },
		data: {
			result: {
				initialValue: { title, rawText },
				error: { '': expect.any(Array) },
			},
		},
	})
	expect(
		await prisma.recipe.count({ where: { householdId: session.householdId } }),
	).toBe(0)
})

test('Quick Entry rejects extracted content outside normal edit limits without creating or losing input', async () => {
	const session = await user()
	const oversized = {
		title,
		rawText: `Ingredients\n1 lemon, ${'preparation '.repeat(60)}\nInstructions\nServe.`,
	}
	const result = await quickAction(
		await args(session, '/recipes/quick', oversized),
	)
	expect(result).toMatchObject({
		init: { status: 400 },
		data: { result: { initialValue: oversized } },
	})
	expect(
		await prisma.recipe.count({ where: { householdId: session.householdId } }),
	).toBe(0)
})

test('Quick Entry with missing structure keeps source and explains the missing sections only on exceptional captures', async () => {
	const session = await user()
	const unstructured = await quickAction(
		await args(session, '/recipes/quick', {
			title,
			rawText: 'Serve the leftover chickpeas with lemon.',
		}),
	)
	expect((unstructured as Response).headers.get('set-cookie')).toContain(
		'en_toast',
	)
	const normal = await quickAction(
		await args(session, '/recipes/quick', { title, rawText }),
	)
	expect((normal as Response).headers.get('set-cookie')).toBeNull()
})
