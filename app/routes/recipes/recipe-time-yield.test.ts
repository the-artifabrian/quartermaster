import { http, HttpResponse } from 'msw'
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { server } from '#tests/mocks/index.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader as detailLoader } from './$recipeId.tsx'
import { action as editAction } from './$recipeId_.edit.tsx'
import { action as importAction } from './import.tsx'
import { action as newAction } from './new.tsx'

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

async function setupUser() {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: { create: createUser() },
			},
			select: { id: true, userId: true },
		})
		const household = await tx.household.create({
			data: {
				name: 'Recipe metadata household',
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		return { ...session, householdId: household.id }
	})
}

async function requestFor(
	session: { id: string },
	path: string,
	fields?: Record<string, string>,
) {
	const cookie = await getSessionCookieHeader(session)
	if (!fields) return new Request(`${BASE_URL}${path}`, { headers: { cookie } })
	return new Request(`${BASE_URL}${path}`, {
		method: 'POST',
		headers: {
			cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams(fields).toString(),
	})
}

const requiredRecipeFields = {
	title: 'Braided loaf',
	servings: '4',
	'ingredients[0].name': 'flour',
	'instructions[0].content': 'Knead the dough.',
}

function recipeIdFromRedirect(response: unknown) {
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(302)
	const location = (response as Response).headers.get('location')
	expect(location).toMatch(/^\/recipes\/[a-z0-9]+$/)
	return { recipeId: location!.split('/').at(-1)!, location: location! }
}

test('create persists explicit Recipe time and typed yield metadata', async () => {
	const session = await setupUser()
	const response = await newAction({
		request: await requestFor(session, '/recipes/new', {
			...requiredRecipeFields,
			activeTime: '25',
			totalTime: '180',
			yieldAmount: '2.5',
			yieldLabel: 'large braided loaves',
		}),
		...routeArgs('/recipes/new'),
	})

	const { recipeId, location } = recipeIdFromRedirect(response)

	const result = await detailLoader({
		request: await requestFor(session, location!),
		...routeArgs('/recipes/:recipeId', { recipeId }),
	})
	expect(result.recipe).toEqual(
		expect.objectContaining({
			title: 'Braided loaf',
			servings: 4,
			activeTime: 25,
			totalTime: 180,
			yieldAmount: 2.5,
			yieldLabel: 'large braided loaves',
		}),
	)
})

test('edit persists explicit Recipe time and typed yield metadata', async () => {
	const session = await setupUser()
	const created = await newAction({
		request: await requestFor(session, '/recipes/new', requiredRecipeFields),
		...routeArgs('/recipes/new'),
	})
	const { recipeId, location } = recipeIdFromRedirect(created)

	const edited = await editAction({
		request: await requestFor(session, `${location}/edit`, {
			...requiredRecipeFields,
			activeTime: '40',
			totalTime: '240',
			yieldAmount: '18',
			yieldLabel: 'filled dumplings',
		}),
		...routeArgs('/recipes/:recipeId/edit', { recipeId }),
	})
	recipeIdFromRedirect(edited)

	const result = await detailLoader({
		request: await requestFor(session, location),
		...routeArgs('/recipes/:recipeId', { recipeId }),
	})
	expect(result.recipe).toEqual(
		expect.objectContaining({
			activeTime: 40,
			totalTime: 240,
			yieldAmount: 18,
			yieldLabel: 'filled dumplings',
		}),
	)
})

test('edit turns blank Recipe time and typed yield fields back into unknown values', async () => {
	const session = await setupUser()
	const created = await newAction({
		request: await requestFor(session, '/recipes/new', {
			...requiredRecipeFields,
			activeTime: '25',
			totalTime: '180',
			yieldAmount: '2.5',
			yieldLabel: 'large braided loaves',
		}),
		...routeArgs('/recipes/new'),
	})
	const { recipeId, location } = recipeIdFromRedirect(created)

	const edited = await editAction({
		request: await requestFor(session, `${location}/edit`, {
			...requiredRecipeFields,
			activeTime: '',
			totalTime: '',
			yieldAmount: '',
			yieldLabel: '   ',
		}),
		...routeArgs('/recipes/:recipeId/edit', { recipeId }),
	})
	recipeIdFromRedirect(edited)

	const result = await detailLoader({
		request: await requestFor(session, location),
		...routeArgs('/recipes/:recipeId', { recipeId }),
	})
	expect(result.recipe).toEqual(
		expect.objectContaining({
			servings: 4,
			activeTime: null,
			totalTime: null,
			yieldAmount: null,
			yieldLabel: null,
		}),
	)
})

test('create rejects an incomplete typed yield', async () => {
	const session = await setupUser()
	for (const partialYield of [
		{ yieldAmount: '12', yieldLabel: '' },
		{ yieldAmount: '', yieldLabel: 'dumplings' },
	]) {
		const result = await newAction({
			request: await requestFor(session, '/recipes/new', {
				...requiredRecipeFields,
				...partialYield,
			}),
			...routeArgs('/recipes/new'),
		})
		expect(result).toEqual(expect.objectContaining({ init: { status: 400 } }))
	}
})

test('edit rejects zero and negative Recipe time or yield amounts', async () => {
	const session = await setupUser()
	const created = await newAction({
		request: await requestFor(session, '/recipes/new', {
			...requiredRecipeFields,
			activeTime: '25',
			totalTime: '180',
			yieldAmount: '2.5',
			yieldLabel: 'large braided loaves',
		}),
		...routeArgs('/recipes/new'),
	})
	const { recipeId, location } = recipeIdFromRedirect(created)
	const validMetadata = {
		activeTime: '25',
		totalTime: '180',
		yieldAmount: '2.5',
		yieldLabel: 'large braided loaves',
	}

	for (const invalidMetadata of [
		{ activeTime: '0' },
		{ activeTime: '-5' },
		{ totalTime: '0' },
		{ totalTime: '-10' },
		{ yieldAmount: '0' },
		{ yieldAmount: '-0.5' },
	]) {
		const result = await editAction({
			request: await requestFor(session, `${location}/edit`, {
				...requiredRecipeFields,
				...validMetadata,
				...invalidMetadata,
			}),
			...routeArgs('/recipes/:recipeId/edit', { recipeId }),
		})
		expect(result).toEqual(expect.objectContaining({ init: { status: 400 } }))
	}

	const result = await detailLoader({
		request: await requestFor(session, location),
		...routeArgs('/recipes/:recipeId', { recipeId }),
	})
	expect(result.recipe).toEqual(
		expect.objectContaining({
			activeTime: 25,
			totalTime: 180,
			yieldAmount: 2.5,
			yieldLabel: 'large braided loaves',
		}),
	)
})

test('Recipe metadata cannot be read or changed from another household', async () => {
	const owner = await setupUser()
	const outsider = await setupUser()
	const created = await newAction({
		request: await requestFor(owner, '/recipes/new', {
			...requiredRecipeFields,
			activeTime: '25',
			totalTime: '180',
			yieldAmount: '2.5',
			yieldLabel: 'large braided loaves',
		}),
		...routeArgs('/recipes/new'),
	})
	const { recipeId, location } = recipeIdFromRedirect(created)

	await expect(
		detailLoader({
			request: await requestFor(outsider, location),
			...routeArgs('/recipes/:recipeId', { recipeId }),
		}),
	).rejects.toEqual(expect.objectContaining({ status: 403 }))
	await expect(
		editAction({
			request: await requestFor(outsider, `${location}/edit`, {
				...requiredRecipeFields,
				activeTime: '1',
				totalTime: '2',
				yieldAmount: '3',
				yieldLabel: 'stolen batches',
			}),
			...routeArgs('/recipes/:recipeId/edit', { recipeId }),
		}),
	).rejects.toEqual(expect.objectContaining({ status: 403 }))

	const result = await detailLoader({
		request: await requestFor(owner, location),
		...routeArgs('/recipes/:recipeId', { recipeId }),
	})
	expect(result.recipe).toEqual(
		expect.objectContaining({
			activeTime: 25,
			totalTime: 180,
			yieldAmount: 2.5,
			yieldLabel: 'large braided loaves',
		}),
	)
})

test('URL import previews only explicit Recipe time and typed yield metadata', async () => {
	const session = await setupUser()
	const sourceUrl = 'https://recipes.example/braided-loaf'
	server.use(
		http.get(sourceUrl, () =>
			HttpResponse.html(`
				<script type="application/ld+json">
					${JSON.stringify({
						'@context': 'https://schema.org',
						'@type': 'Recipe',
						name: 'Braided loaf',
						recipeYield: '2.5 large braided loaves',
						prepTime: 'PT25M',
						cookTime: 'PT45M',
						totalTime: 'PT3H',
						recipeIngredient: ['500 g flour'],
						recipeInstructions: ['Knead the dough.'],
					})}
				</script>
			`),
		),
	)

	const result = (await importAction({
		request: await requestFor(session, '/recipes/import', {
			intent: 'fetch',
			url: sourceUrl,
		}),
		...routeArgs('/recipes/import'),
	})) as {
		data?: { recipe: Record<string, unknown> }
		recipe?: Record<string, unknown>
	}
	const payload = result.data ?? result

	expect(payload.recipe).toEqual(
		expect.objectContaining({
			activeTime: 25,
			totalTime: 180,
			yieldAmount: 2.5,
			yieldLabel: 'large braided loaves',
		}),
	)
})

test('URL import save persists explicit Recipe time and typed yield metadata', async () => {
	const session = await setupUser()
	const response = await importAction({
		request: await requestFor(session, '/recipes/import', {
			intent: 'save',
			title: 'Imported braided loaf',
			servings: '4',
			activeTime: '25',
			totalTime: '180',
			yieldAmount: '2.5',
			yieldLabel: 'large braided loaves',
			'ingredients[0].name': 'flour',
			'instructions[0].content': 'Knead the dough.',
		}),
		...routeArgs('/recipes/import'),
	})
	const { recipeId, location } = recipeIdFromRedirect(response)

	const result = await detailLoader({
		request: await requestFor(session, location),
		...routeArgs('/recipes/:recipeId', { recipeId }),
	})
	expect(result.recipe).toEqual(
		expect.objectContaining({
			activeTime: 25,
			totalTime: 180,
			yieldAmount: 2.5,
			yieldLabel: 'large braided loaves',
		}),
	)
})

test('URL import keeps missing Total and typed Yield unknown', async () => {
	const session = await setupUser()
	const sourceUrl = 'https://recipes.example/explicit-only'
	server.use(
		http.get(sourceUrl, () =>
			HttpResponse.html(`
				<script type="application/ld+json">
					${JSON.stringify({
						'@context': 'https://schema.org',
						'@type': 'Recipe',
						name: 'Explicit only',
						prepTime: 'PT10M',
						cookTime: 'PT20M',
						recipeIngredient: ['1 onion'],
						recipeInstructions: ['Cook the onion.'],
					})}
				</script>
			`),
		),
	)

	const result = (await importAction({
		request: await requestFor(session, '/recipes/import', {
			intent: 'fetch',
			url: sourceUrl,
		}),
		...routeArgs('/recipes/import'),
	})) as {
		data?: { recipe: Record<string, unknown> }
		recipe?: Record<string, unknown>
	}
	const payload = result.data ?? result

	expect(payload.recipe).toEqual(
		expect.objectContaining({
			activeTime: 10,
			totalTime: null,
			yieldAmount: null,
			yieldLabel: null,
		}),
	)
})
