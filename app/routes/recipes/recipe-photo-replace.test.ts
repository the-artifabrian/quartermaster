import fs from 'node:fs/promises'
import path from 'node:path'
import { http, HttpResponse } from 'msw'
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { server } from '#tests/setup/mocks-setup.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as editAction } from './$recipeId_.edit.tsx'
import '#tests/setup/db-setup.ts'

const UPLOADS_DIR = path.join(process.cwd(), 'tests/fixtures/uploaded')
const BUCKET_URL = `${process.env.AWS_ENDPOINT_URL_S3}/${process.env.BUCKET_NAME}`

const exists = (filePath: string) =>
	fs.access(filePath).then(
		() => true,
		() => false,
	)

/** A user whose Recipe has a stored photo; removes the user's uploads on dispose. */
async function recipeWithPhoto() {
	const { session, householdId } = await prisma.$transaction(async (tx) => {
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
		return { session, householdId: household.id }
	})
	const oldKey = `users/${session.userId}/recipes/old/images/old.jpg`
	const oldPath = path.join(UPLOADS_DIR, oldKey)
	await fs.mkdir(path.dirname(oldPath), { recursive: true })
	await fs.writeFile(oldPath, 'old jpeg bytes')
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Braided loaf',
			userId: session.userId,
			householdId,
			image: { create: { objectKey: oldKey } },
		},
		select: { id: true },
	})
	return {
		session,
		householdId,
		recipeId: recipe.id,
		oldKey,
		oldPath,
		async [Symbol.asyncDispose]() {
			await fs.rm(path.join(UPLOADS_DIR, 'users', session.userId), {
				recursive: true,
				force: true,
			})
		},
	}
}

async function replacePhoto(session: { id: string }, recipeId: string) {
	const body = new FormData()
	body.set('title', 'Braided loaf')
	body.set('ingredients[0].name', 'flour')
	body.set('instructions[0].content', 'Knead the dough.')
	body.set(
		'image',
		new File([new Uint8Array(1024)], 'new.jpg', { type: 'image/jpeg' }),
	)
	const pathname = `/recipes/${recipeId}/edit`
	return editAction({
		request: new Request(`${BASE_URL}${pathname}`, {
			method: 'POST',
			body,
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
		params: { recipeId },
		context: new RouterContextProvider(),
		pattern: '/recipes/:recipeId/edit',
		url: new URL(`${BASE_URL}${pathname}`),
	})
}

async function photoKey(recipeId: string) {
	const image = await prisma.recipeImage.findUnique({
		where: { recipeId },
		select: { objectKey: true },
	})
	return image?.objectKey ?? null
}

test('a failed upload keeps the old photo and its object', async () => {
	await using fixture = await recipeWithPhoto()
	consoleError.mockImplementation(() => {})
	server.use(
		http.put(`${BUCKET_URL}/*`, () => new HttpResponse(null, { status: 500 })),
	)

	await expect(
		replacePhoto(fixture.session, fixture.recipeId),
	).rejects.toThrow()

	expect(await photoKey(fixture.recipeId)).toBe(fixture.oldKey)
	expect(await exists(fixture.oldPath)).toBe(true)
})

test('a replaced photo points at the new object and the old one is deleted', async () => {
	await using fixture = await recipeWithPhoto()

	const response = await replacePhoto(fixture.session, fixture.recipeId)

	expect((response as Response).status).toBe(302)
	const newKey = await photoKey(fixture.recipeId)
	expect(newKey).not.toBe(fixture.oldKey)
	expect(await exists(path.join(UPLOADS_DIR, newKey!))).toBe(true)
	expect(await exists(fixture.oldPath)).toBe(false)
})

test('the old object stays while a copied Recipe still shows it', async () => {
	await using fixture = await recipeWithPhoto()
	const copy = await prisma.recipe.create({
		data: {
			title: 'Braided loaf copy',
			userId: fixture.session.userId,
			householdId: fixture.householdId,
			image: { create: { objectKey: fixture.oldKey } },
		},
		select: { id: true },
	})

	await replacePhoto(fixture.session, fixture.recipeId)

	expect(await photoKey(fixture.recipeId)).not.toBe(fixture.oldKey)
	expect(await photoKey(copy.id)).toBe(fixture.oldKey)
	expect(await exists(fixture.oldPath)).toBe(true)
})

test('a failed delete of the old object still saves the new photo', async () => {
	await using fixture = await recipeWithPhoto()
	consoleError.mockImplementation(() => {})
	server.use(
		http.delete(
			`${BUCKET_URL}/*`,
			() => new HttpResponse(null, { status: 500 }),
		),
	)

	const response = await replacePhoto(fixture.session, fixture.recipeId)

	expect((response as Response).status).toBe(302)
	const newKey = await photoKey(fixture.recipeId)
	expect(newKey).not.toBe(fixture.oldKey)
	expect(await exists(path.join(UPLOADS_DIR, newKey!))).toBe(true)
})
