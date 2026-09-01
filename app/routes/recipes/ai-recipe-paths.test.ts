import { http, HttpResponse } from 'msw'
import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { server } from '#tests/mocks/index.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as enhanceAction } from '../resources/enhance-recipe.tsx'
import { action as recipeAction } from './$recipeId.tsx'
import { action as importAction } from './import.tsx'

async function setupProHousehold() {
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
				name: 'Surviving AI household',
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		return { ...session, householdId: household.id }
	})
}

async function postRequest(
	session: { id: string },
	path: string,
	fields: Record<string, string>,
) {
	const cookie = await getSessionCookieHeader(session)
	return new Request(`${BASE_URL}${path}`, {
		method: 'POST',
		headers: {
			cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams(fields).toString(),
	})
}

function routeArgs<
	TParams extends Record<string, string> = Record<string, never>,
>(path: string, params: TParams = {} as TParams) {
	return {
		params,
		context: new RouterContextProvider(),
		pattern: path,
		url: new URL(`${BASE_URL}${path}`),
	}
}

function unwrapData<T>(result: unknown): T {
	if (typeof result === 'object' && result !== null && 'data' in result) {
		return (result as { data: T }).data
	}
	return result as T
}

function respondWithAnthropicJson(value: unknown) {
	server.use(
		http.post('https://api.anthropic.com/v1/messages', () =>
			HttpResponse.json({
				content: [{ type: 'text', text: JSON.stringify(value) }],
			}),
		),
	)
}

function configureAnthropic() {
	const originalApiKey = process.env.ANTHROPIC_API_KEY
	process.env.ANTHROPIC_API_KEY = 'test-key'
	return {
		[Symbol.dispose]() {
			if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
			else process.env.ANTHROPIC_API_KEY = originalApiKey
		},
	}
}

describe('surviving AI Recipe paths', () => {
	test('text extraction previews a Recipe before an explicit reviewed save', async () => {
		using _anthropic = configureAnthropic()
		const session = await setupProHousehold()
		respondWithAnthropicJson({
			title: 'AI extraction preview',
			description: 'A proposed description.',
			activeTime: null,
			totalTime: null,
			yieldAmount: null,
			yieldLabel: null,
			ingredients: [
				{
					name: 'chickpeas',
					amount: '1',
					unit: 'can',
					notes: null,
					isHeading: false,
				},
			],
			instructions: [{ content: 'Warm the chickpeas.' }],
		})

		const extracted = await importAction({
			request: await postRequest(session, '/recipes/import', {
				intent: 'extract-text',
				rawText: 'Warm one can of chickpeas.',
			}),
			...routeArgs('/recipes/import'),
		})
		const preview = unwrapData<{
			error: string | null
			recipe: { title: string } | null
		}>(extracted)

		expect(preview).toMatchObject({
			error: null,
			recipe: { title: 'AI extraction preview' },
		})
		expect(
			await prisma.recipe.count({
				where: { householdId: session.householdId },
			}),
		).toBe(0)
		expect(
			await prisma.usageEvent.count({
				where: { userId: session.userId, type: 'recipe_extract_llm_call' },
			}),
		).toBe(1)

		const saved = await importAction({
			request: await postRequest(session, '/recipes/import', {
				intent: 'save',
				title: 'Reviewed chickpeas',
				description: 'The description after review.',
				'ingredients[0].name': 'chickpeas',
				'ingredients[0].amount': '1',
				'ingredients[0].unit': 'can',
				'instructions[0].content': 'Warm the chickpeas gently.',
			}),
			...routeArgs('/recipes/import'),
		})

		expect(saved).toBeInstanceOf(Response)
		expect((saved as Response).status).toBe(302)
		await expect(
			prisma.recipe.findFirstOrThrow({
				where: { householdId: session.householdId },
				select: { title: true, description: true },
			}),
		).resolves.toEqual({
			title: 'Reviewed chickpeas',
			description: 'The description after review.',
		})
	})

	test('enhancement suggestions do not write until explicitly applied', async () => {
		using _anthropic = configureAnthropic()
		const session = await setupProHousehold()
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Plain chickpeas',
				description: 'Original description.',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: { create: { name: 'chickpeas', order: 0 } },
				instructions: { create: { content: 'Warm them.', order: 0 } },
			},
		})
		respondWithAnthropicJson({
			description: 'Creamy chickpeas warmed with care.',
		})

		const suggested = await enhanceAction({
			request: await postRequest(session, '/resources/enhance-recipe', {
				recipeId: recipe.id,
			}),
			...routeArgs('/resources/enhance-recipe'),
		})
		expect(
			unwrapData<{
				error: string | null
				suggestions: { description: string | null } | null
			}>(suggested),
		).toEqual({
			error: null,
			suggestions: { description: 'Creamy chickpeas warmed with care.' },
		})
		await expect(
			prisma.recipe.findUniqueOrThrow({
				where: { id: recipe.id },
				select: { description: true },
			}),
		).resolves.toEqual({ description: 'Original description.' })

		const applied = await recipeAction({
			request: await postRequest(session, `/recipes/${recipe.id}`, {
				intent: 'applyEnhancement',
				enhance_description: 'Creamy chickpeas warmed with care.',
			}),
			...routeArgs('/recipes/:recipeId', { recipeId: recipe.id }),
		})
		expect(applied).toEqual({ success: true })
		await expect(
			prisma.recipe.findUniqueOrThrow({
				where: { id: recipe.id },
				select: { description: true },
			}),
		).resolves.toEqual({
			description: 'Creamy chickpeas warmed with care.',
		})
	})

	test('provider failures remain safe and leave Recipe data unchanged', async () => {
		using _anthropic = configureAnthropic()
		consoleError.mockImplementation(() => {})
		server.use(
			http.post(
				'https://api.anthropic.com/v1/messages',
				() => new HttpResponse(null, { status: 503 }),
			),
		)
		const session = await setupProHousehold()
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Untouched Recipe',
				description: 'Keep this.',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: { create: { name: 'lentils', order: 0 } },
				instructions: { create: { content: 'Simmer.', order: 0 } },
			},
		})

		const importFailure = unwrapData<{ error: string }>(
			await importAction({
				request: await postRequest(session, '/recipes/import', {
					intent: 'extract-text',
					rawText: 'A complete lentil recipe.',
				}),
				...routeArgs('/recipes/import'),
			}),
		)
		expect(importFailure.error).toContain('AI service returned an error')

		const enhancementFailure = unwrapData<{ error: string }>(
			await enhanceAction({
				request: await postRequest(session, '/resources/enhance-recipe', {
					recipeId: recipe.id,
				}),
				...routeArgs('/resources/enhance-recipe'),
			}),
		)
		expect(enhancementFailure.error).toContain('AI service returned an error')
		await expect(
			prisma.recipe.findUniqueOrThrow({
				where: { id: recipe.id },
				select: { description: true },
			}),
		).resolves.toEqual({ description: 'Keep this.' })
	})
})
