import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { MAX_RECIPE_IMAGE_SIZE } from '#app/utils/recipe-validation.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as editAction } from './$recipeId_.edit.tsx'
import { MAX_IMAGE_SIZE } from './import-extract.server.ts'
import { action as importAction } from './import.tsx'
import { action as newAction } from './new.tsx'
import '#tests/setup/db-setup.ts'

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
				name: 'Photo household',
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		return { ...session, householdId: household.id }
	})
}

function oversizedPhoto(limit: number) {
	return new File([new Uint8Array(limit + 1024)], 'IMG_0001.jpg', {
		type: 'image/jpeg',
	})
}

async function multipart(
	session: { id: string },
	path: string,
	fields: Record<string, string | File>,
) {
	const body = new FormData()
	for (const [name, value] of Object.entries(fields)) body.set(name, value)
	return {
		request: new Request(`${BASE_URL}${path}`, {
			method: 'POST',
			body,
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
		context: new RouterContextProvider(),
		pattern: path,
		url: new URL(`${BASE_URL}${path}`),
	}
}

const recipeFields = {
	title: 'Braided loaf',
	'ingredients[0].name': 'flour',
	'instructions[0].content': 'Knead the dough.',
}

function photoError(result: unknown) {
	expect(result).toMatchObject({ init: { status: 400 } })
	return (result as { data: { result: { error: Record<string, string[]> } } })
		.data.result.error
}

test('a new Recipe with a photo over 3 MB gets a field error, not a crash', async () => {
	const session = await setupUser()
	const result = await newAction({
		...(await multipart(session, '/recipes/new', {
			...recipeFields,
			image: oversizedPhoto(MAX_RECIPE_IMAGE_SIZE),
		})),
		params: {},
	})
	expect(photoError(result)).toEqual({ image: ['Photo is over 3 MB'] })
	expect(
		await prisma.recipe.count({ where: { householdId: session.householdId } }),
	).toBe(0)
})

test('editing a Recipe with a photo over 3 MB keeps the Recipe and its photo', async () => {
	const session = await setupUser()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Braided loaf',
			userId: session.userId,
			householdId: session.householdId,
			image: { create: { objectKey: 'users/x/recipes/y/images/old.jpg' } },
		},
	})
	const result = await editAction({
		...(await multipart(session, `/recipes/${recipe.id}/edit`, {
			...recipeFields,
			title: 'Renamed loaf',
			image: oversizedPhoto(MAX_RECIPE_IMAGE_SIZE),
		})),
		params: { recipeId: recipe.id },
	})
	expect(photoError(result)).toEqual({ image: ['Photo is over 3 MB'] })
	expect(
		await prisma.recipe.findUniqueOrThrow({
			where: { id: recipe.id },
			select: { title: true, image: { select: { objectKey: true } } },
		}),
	).toEqual({
		title: 'Braided loaf',
		image: { objectKey: 'users/x/recipes/y/images/old.jpg' },
	})
})

test('an import screenshot over the limit gets an error, not a crash', async () => {
	const session = await setupUser()
	const result = await importAction({
		...(await multipart(session, '/recipes/import', {
			intent: 'extract-image',
			image: oversizedPhoto(MAX_IMAGE_SIZE),
		})),
		params: {},
	})
	expect(result).toMatchObject({
		init: { status: 400 },
		data: {
			intent: 'extract-image',
			error: 'One or more images are too large. Maximum size is 5MB each.',
		},
	})
})
