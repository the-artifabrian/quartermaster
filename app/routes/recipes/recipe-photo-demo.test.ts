/**
 * Photos are off on a demo user's Recipe form, new and edit. The save says so,
 * both when the action redirects (a toast cookie) and when a hydrated form
 * leaves by itself (`{ done }`).
 *
 * The `{ done }` answer carries the notice in its data, with no cookie. The
 * form leaves at once, which cancels the root reload that would read a cookie,
 * so on a slow load a toast would never show, or would show on a later page.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { RouterContextProvider } from 'react-router'
import sharp from 'sharp'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { CLIENT_LEAVES_FIELD } from '#app/utils/edit-screen.ts'
import { toastSessionStorage } from '#app/utils/toast.server.ts'
import { createUser } from '#tests/db-utils.ts'
import '#tests/setup/mocks-setup.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as editAction } from './$recipeId_.edit.tsx'
import { action as newAction } from './new.tsx'
import '#tests/setup/db-setup.ts'

const UPLOADS_DIR = path.join(process.cwd(), 'tests/fixtures/uploaded')
const TEMPLATE_KEY = 'users/demo-template-owner/recipes/bread/images/bread.jpg'

const exists = (filePath: string) =>
	fs.access(filePath).then(
		() => true,
		() => false,
	)

/** A signed-in user and their Household; removes their uploads on dispose. */
async function cook({ demo }: { demo: boolean }) {
	const { session, householdId } = await prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: {
					create: {
						...createUser(),
						demoExpiresAt: demo ? new Date(Date.now() + 3_600_000) : null,
					},
				},
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
	const uploads = path.join(UPLOADS_DIR, 'users', session.userId)
	return {
		session,
		householdId,
		uploads,
		async [Symbol.asyncDispose]() {
			await fs.rm(uploads, { recursive: true, force: true })
		},
	}
}

async function jpeg() {
	return sharp({
		create: { width: 40, height: 30, channels: 3, background: '#c86b3c' },
	})
		.jpeg()
		.toBuffer()
}

async function recipeForm({
	photo,
	clientLeaves = false,
}: {
	photo?: File
	clientLeaves?: boolean
}) {
	const body = new FormData()
	body.set('title', 'Braided loaf')
	body.set('ingredients[0].name', 'flour')
	body.set('instructions[0].content', 'Knead the dough.')
	if (photo) body.set('image', photo)
	if (clientLeaves) body.set(CLIENT_LEAVES_FIELD, '1')
	return body
}

async function post(
	action: typeof newAction | typeof editAction,
	pathname: string,
	params: Record<string, string>,
	session: { id: string },
	body: FormData,
) {
	const result: unknown = await action({
		request: new Request(`${BASE_URL}${pathname}`, {
			method: 'POST',
			body,
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
		params,
		context: new RouterContextProvider(),
		pattern: pathname,
		url: new URL(`${BASE_URL}${pathname}`),
	} as never)
	if (result instanceof Response) {
		return { status: result.status, headers: result.headers, data: null }
	}
	const { data, init } = result as {
		data: unknown
		init: ResponseInit | null
	}
	return {
		status: init?.status ?? 200,
		headers: new Headers(init?.headers),
		data,
	}
}

async function toastIn(headers: Headers) {
	const cookie = headers.getSetCookie().find((c) => c.startsWith('en_toast='))
	if (!cookie) return null
	const session = await toastSessionStorage.getSession(cookie.split(';')[0])
	return (session.get('toast') as { description: string } | undefined) ?? null
}

const PHOTOS_OFF = 'Saved without the photo. Photos are turned off in the demo.'

const newRecipe = (session: { id: string }, body: FormData) =>
	post(newAction, '/recipes/new', {}, session, body)

const editRecipe = (
	session: { id: string },
	recipeId: string,
	body: FormData,
) => post(editAction, `/recipes/${recipeId}/edit`, { recipeId }, session, body)

function photoOf(recipeTitle: string, householdId: string) {
	return prisma.recipe.findFirst({
		where: { title: recipeTitle, householdId },
		select: { image: { select: { objectKey: true } } },
	})
}

test("a demo user's new Recipe saves without its photo, stores nothing and says so", async () => {
	await using user = await cook({ demo: true })
	const photo = new File([await jpeg()], 'loaf.jpg', { type: 'image/jpeg' })

	const redirected = await newRecipe(user.session, await recipeForm({ photo }))
	const left = await newRecipe(
		user.session,
		await recipeForm({ photo, clientLeaves: true }),
	)

	expect(redirected.status).toBe(302)
	expect(await toastIn(redirected.headers)).toMatchObject({
		description: PHOTOS_OFF,
	})
	expect(left.data).toEqual({
		done: expect.stringMatching(/^\/recipes\//),
		notice: PHOTOS_OFF,
	})
	expect(await toastIn(left.headers)).toBeNull()
	expect(
		await prisma.recipeImage.count({
			where: { recipe: { householdId: user.householdId } },
		}),
	).toBe(0)
	expect(
		await prisma.recipe.count({ where: { householdId: user.householdId } }),
	).toBe(2)
	expect(await exists(user.uploads)).toBe(false)
})

// The photo the Recipe has may be the template's, which other copies show.
test("a demo user's edit with a new photo keeps the old photo and stores nothing", async () => {
	await using user = await cook({ demo: true })
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Braided loaf',
			userId: user.session.userId,
			householdId: user.householdId,
			image: { create: { objectKey: TEMPLATE_KEY } },
		},
		select: { id: true },
	})
	const photo = new File([await jpeg()], 'loaf.jpg', { type: 'image/jpeg' })

	const redirected = await editRecipe(
		user.session,
		recipe.id,
		await recipeForm({ photo }),
	)
	const left = await editRecipe(
		user.session,
		recipe.id,
		await recipeForm({ photo, clientLeaves: true }),
	)

	expect(redirected.status).toBe(302)
	expect(await toastIn(redirected.headers)).toMatchObject({
		description: PHOTOS_OFF,
	})
	expect(left.data).toEqual({
		done: `/recipes/${recipe.id}`,
		notice: PHOTOS_OFF,
	})
	expect(await toastIn(left.headers)).toBeNull()
	expect(await photoOf('Braided loaf', user.householdId)).toEqual({
		image: { objectKey: TEMPLATE_KEY },
	})
	expect(await exists(user.uploads)).toBe(false)
})

test("a demo user's file is never checked, so one that isn't a photo doesn't stop the save", async () => {
	await using user = await cook({ demo: true })
	const notAPhoto = new File(['plain text'], 'notes.jpg', {
		type: 'image/jpeg',
	})

	const answer = await newRecipe(
		user.session,
		await recipeForm({ photo: notAPhoto }),
	)

	expect(answer.status).toBe(302)
	expect(await toastIn(answer.headers)).toMatchObject({
		description: PHOTOS_OFF,
	})
})

test("a demo user's save without a photo gets no photo message", async () => {
	await using user = await cook({ demo: true })

	const answer = await newRecipe(user.session, await recipeForm({}))
	const left = await newRecipe(
		user.session,
		await recipeForm({ clientLeaves: true }),
	)

	expect(answer.status).toBe(302)
	expect(await toastIn(answer.headers)).toBeNull()
	expect(left.data).toEqual({ done: expect.stringMatching(/^\/recipes\//) })
	expect(await toastIn(left.headers)).toBeNull()
})

test("a real user's photo is still saved", async () => {
	await using user = await cook({ demo: false })
	const photo = new File([await jpeg()], 'loaf.jpg', { type: 'image/jpeg' })

	const answer = await newRecipe(user.session, await recipeForm({ photo }))

	expect(answer.status).toBe(302)
	expect(await toastIn(answer.headers)).toBeNull()
	const saved = await photoOf('Braided loaf', user.householdId)
	expect(saved?.image?.objectKey).toContain(`users/${user.session.userId}/`)
})
