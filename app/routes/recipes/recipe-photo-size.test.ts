// Failure list for the photo a Recipe form sends (the parser stops at the
// size limit; a stored file the image route can't decode breaks every view):
// - a photo over 3 MB gets a field error, on a new Recipe and an edit
// - a file that isn't a photo, sent with a photo's type and name, gets a field
//   error before anything is saved: no new Recipe, nothing in storage, and an
//   edit keeps its old photo and fields
// - the refusal keeps what was typed, and shows next to any other field error
// - a photo too big to decode gets a field error that says so
// - a real photo the browser labels with another type is saved, under the
//   type of its bytes (the form used to drop it without a word)
// - an import screenshot over the limit gets an error, not a crash
import fs from 'node:fs/promises'
import path from 'node:path'
import { RouterContextProvider } from 'react-router'
import sharp from 'sharp'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { MAX_DECODED_BYTES } from '#app/utils/recipe-photo.server.ts'
import {
	MAX_RECIPE_IMAGE_SIZE,
	PHOTO_REFUSALS,
} from '#app/utils/recipe-validation.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as editAction } from './$recipeId_.edit.tsx'
import { MAX_IMAGE_SIZE } from './import-extract.server.ts'
import { action as importAction } from './import.tsx'
import { action as newAction } from './new.tsx'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

const UPLOADS_DIR = path.join(process.cwd(), 'tests/fixtures/uploaded')

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

function notAPhoto() {
	return new File(['Braided loaf: flour, water, salt'], 'loaf.jpg', {
		type: 'image/jpeg',
	})
}

async function storedFiles(userId: string) {
	const files = await fs
		.readdir(path.join(UPLOADS_DIR, 'users', userId), { recursive: true })
		.catch(() => [])
	return files.filter((file) => path.extname(file) !== '')
}

async function removeUploads(userId: string) {
	await fs.rm(path.join(UPLOADS_DIR, 'users', userId), {
		recursive: true,
		force: true,
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

test('a new Recipe with a file that isn’t a photo gets a field error and saves nothing', async () => {
	const session = await setupUser()
	const result = await newAction({
		...(await multipart(session, '/recipes/new', {
			...recipeFields,
			image: notAPhoto(),
		})),
		params: {},
	})
	expect(photoError(result)).toEqual({ image: [PHOTO_REFUSALS.unusable] })
	expect(
		(
			result as unknown as {
				data: { result: { initialValue: { title: string } } }
			}
		).data.result.initialValue.title,
	).toBe('Braided loaf')
	expect(
		await prisma.recipe.count({ where: { householdId: session.householdId } }),
	).toBe(0)
	expect(await storedFiles(session.userId)).toEqual([])
})

test('a refused photo shows next to the form’s other errors', async () => {
	const session = await setupUser()
	const result = await newAction({
		...(await multipart(session, '/recipes/new', {
			...recipeFields,
			title: '',
			image: notAPhoto(),
		})),
		params: {},
	})
	const error = photoError(result)
	expect(error.image).toEqual([PHOTO_REFUSALS.unusable])
	expect(error.title).toBeDefined()
})

test('editing a Recipe with a file that isn’t a photo keeps the Recipe and its photo', async () => {
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
			image: notAPhoto(),
		})),
		params: { recipeId: recipe.id },
	})
	expect(photoError(result)).toEqual({ image: [PHOTO_REFUSALS.unusable] })
	expect(
		await prisma.recipe.findUniqueOrThrow({
			where: { id: recipe.id },
			select: { title: true, image: { select: { objectKey: true } } },
		}),
	).toEqual({
		title: 'Braided loaf',
		image: { objectKey: 'users/x/recipes/y/images/old.jpg' },
	})
	expect(await storedFiles(session.userId)).toEqual([])
})

test('a photo too big to decode gets a field error that says so', async () => {
	const session = await setupUser()
	const width = 4096
	const png = await sharp({
		create: {
			width,
			height: Math.floor(MAX_DECODED_BYTES / (width * 3)) + 1,
			channels: 3,
			background: '#c86b3c',
		},
		limitInputPixels: false,
	})
		.png()
		.toBuffer()
	const result = await newAction({
		...(await multipart(session, '/recipes/new', {
			...recipeFields,
			image: new File([new Uint8Array(png)], 'scan.png', { type: 'image/png' }),
		})),
		params: {},
	})
	expect(photoError(result)).toEqual({ image: [PHOTO_REFUSALS['too-big']] })
	// The form keeps or clears the photo by this, not by the message.
	expect(result).toMatchObject({ data: { photoRefusal: 'too-big' } })
	expect(
		await prisma.recipe.count({ where: { householdId: session.householdId } }),
	).toBe(0)
})

test('a real photo the browser labels with another type is saved as its bytes say', async () => {
	const session = await setupUser()
	try {
		const png = await sharp({
			create: { width: 40, height: 30, channels: 3, background: '#c86b3c' },
		})
			.png()
			.toBuffer()
		const response = await newAction({
			...(await multipart(session, '/recipes/new', {
				...recipeFields,
				image: new File([png], 'IMG_0001.HEIC', {
					type: 'application/octet-stream',
				}),
			})),
			params: {},
		})
		expect((response as Response).status).toBe(302)
		const { image } = await prisma.recipe.findFirstOrThrow({
			where: { householdId: session.householdId },
			select: { image: { select: { objectKey: true } } },
		})
		expect(image?.objectKey).toMatch(/\.png$/)
		const stored = await fs.readFile(path.join(UPLOADS_DIR, image!.objectKey))
		expect(stored.equals(png)).toBe(true)
	} finally {
		await removeUploads(session.userId)
	}
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
