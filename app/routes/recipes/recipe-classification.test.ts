import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	DEFAULT_RECIPE_METADATA_VALUE_CREATE,
	recipeMetadataNameKey,
} from '#app/utils/recipe-metadata.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as editAction } from './$recipeId_.edit.tsx'
import { loader as indexLoader } from './index.tsx'
import { action as newAction } from './new.tsx'

function routeArgs<T extends Record<string, string> = Record<never, never>>(
	path: string,
	params: T = {} as T,
) {
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
				name: 'Recipe classification household',
				members: { create: { userId: session.userId, role: 'owner' } },
				recipeMetadataValues: {
					create: DEFAULT_RECIPE_METADATA_VALUE_CREATE,
				},
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
	title: 'Summer mezze',
	'ingredients[0].name': 'tomato',
	'instructions[0].content': 'Combine.',
}

function metadataField(input: {
	selectedValueIds?: string[]
	newValues?: Partial<Record<'cuisine' | 'season' | 'course', string[]>>
}) {
	return JSON.stringify({
		selectedValueIds: input.selectedValueIds ?? [],
		newValues: {
			cuisine: input.newValues?.cuisine ?? [],
			season: input.newValues?.season ?? [],
			course: input.newValues?.course ?? [],
		},
	})
}

describe('Recipe classification editing', () => {
	test('creates several values per dimension and normalizes custom identity', async () => {
		const session = await setupUser()
		const defaults = await prisma.recipeMetadataValue.findMany({
			where: {
				householdId: session.householdId,
				nameKey: { in: ['summer', 'winter', 'main'] },
			},
			select: { id: true, nameKey: true },
		})
		const response = await newAction({
			request: await requestFor(session, '/recipes/new', {
				...requiredRecipeFields,
				recipeMetadata: metadataField({
					selectedValueIds: defaults.map((value) => value.id),
					newValues: {
						cuisine: ['  Levantine  ', 'Ｌｅｖａｎｔｉｎｅ'],
					},
				}),
			}),
			...routeArgs('/recipes/new'),
		})
		expect(response).toBeInstanceOf(Response)
		const recipeId = (response as Response).headers
			.get('location')!
			.split('/')
			.at(-1)!

		const recipe = await prisma.recipe.findUniqueOrThrow({
			where: { id: recipeId },
			select: {
				metadataAssignments: {
					select: {
						value: { select: { dimension: true, name: true, nameKey: true } },
					},
				},
			},
		})
		expect(recipe.metadataAssignments.map((item) => item.value)).toEqual(
			expect.arrayContaining([
				{ dimension: 'season', name: 'Summer', nameKey: 'summer' },
				{ dimension: 'season', name: 'Winter', nameKey: 'winter' },
				{ dimension: 'course', name: 'Main', nameKey: 'main' },
				{ dimension: 'cuisine', name: 'Levantine', nameKey: 'levantine' },
			]),
		)
		expect(
			await prisma.recipeMetadataValue.count({
				where: {
					householdId: session.householdId,
					dimension: 'cuisine',
					nameKey: 'levantine',
				},
			}),
		).toBe(1)
	})

	test('rejects foreign-household values without partially editing the Recipe', async () => {
		const owner = await setupUser()
		const outsider = await setupUser()
		const ownMain = await prisma.recipeMetadataValue.findFirstOrThrow({
			where: { householdId: owner.householdId, nameKey: 'main' },
		})
		const foreignDessert = await prisma.recipeMetadataValue.findFirstOrThrow({
			where: { householdId: outsider.householdId, nameKey: 'dessert' },
		})
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Protected Recipe',
				userId: owner.userId,
				householdId: owner.householdId,
				metadataAssignments: { create: { valueId: ownMain.id } },
			},
		})

		const result = await editAction({
			request: await requestFor(owner, `/recipes/${recipe.id}/edit`, {
				...requiredRecipeFields,
				title: 'Spoofed edit',
				recipeMetadata: metadataField({
					selectedValueIds: [foreignDessert.id],
				}),
			}),
			...routeArgs('/recipes/:recipeId/edit', { recipeId: recipe.id }),
		})
		expect(result).toEqual(expect.objectContaining({ init: { status: 400 } }))

		const unchanged = await prisma.recipe.findUniqueOrThrow({
			where: { id: recipe.id },
			include: { metadataAssignments: true },
		})
		expect(unchanged.title).toBe('Protected Recipe')
		expect(unchanged.metadataAssignments.map((item) => item.valueId)).toEqual([
			ownMain.id,
		])
	})
})

describe('Recipe classification URL filters', () => {
	test('ORs within a dimension, ANDs across dimensions, and combines with search', async () => {
		const session = await setupUser()
		const customValues = await Promise.all(
			['Italian', 'Levantine'].map((name) =>
				prisma.recipeMetadataValue.create({
					data: {
						householdId: session.householdId,
						dimension: 'cuisine',
						name,
						nameKey: recipeMetadataNameKey(name),
					},
				}),
			),
		)
		const defaults = await prisma.recipeMetadataValue.findMany({
			where: {
				householdId: session.householdId,
				nameKey: { in: ['main', 'dessert'] },
			},
		})
		const valueByKey = new Map(
			[...customValues, ...defaults].map((value) => [value.nameKey, value.id]),
		)

		for (const input of [
			{ title: 'Italian summer soup', values: ['italian', 'main'] },
			{ title: 'Levantine platter', values: ['levantine', 'main'] },
			{ title: 'Italian celebration cake', values: ['italian', 'dessert'] },
		]) {
			await prisma.recipe.create({
				data: {
					title: input.title,
					userId: session.userId,
					householdId: session.householdId,
					metadataAssignments: {
						create: input.values.map((nameKey) => ({
							valueId: valueByKey.get(nameKey)!,
						})),
					},
				},
			})
		}

		async function loadTitles(query: string) {
			const result = await indexLoader({
				request: await requestFor(session, `/recipes?${query}`),
				...routeArgs('/recipes'),
			})
			return result.recipes.map((recipe) => recipe.title).sort()
		}

		expect(
			await loadTitles('cuisine=italian&cuisine=levantine&course=main'),
		).toEqual(['Italian summer soup', 'Levantine platter'])
		expect(
			await loadTitles(
				'cuisine=italian&cuisine=levantine&course=main&search=soup',
			),
		).toEqual(['Italian summer soup'])
		expect(await loadTitles('cuisine=retired-bookmark')).toEqual([
			'Italian celebration cake',
			'Italian summer soup',
			'Levantine platter',
		])
	})
})
