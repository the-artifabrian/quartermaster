/**
 * The public share pages are open to anyone with the link, so a demo
 * Household's Recipes and Menus, the template's included, answer there as
 * missing ones do.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { RouterContextProvider } from 'react-router'
import sharp from 'sharp'
import { expect, test, vi } from 'vitest'
import type * as DemoGuard from '#app/utils/demo-guard.server.ts'
import type * as Storage from '#app/utils/storage.server.ts'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { deleteAccount } from '#app/utils/account-deletion.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { DEMO_TEMPLATE_EMAIL_DOMAIN } from '#app/utils/demo.ts'
import { createUser } from '#tests/db-utils.ts'
import '#tests/setup/mocks-setup.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import {
	action as saveRecipe,
	loader as recipeLoader,
} from './share.$recipeId.tsx'
import {
	action as saveMenu,
	loader as menuLoader,
} from './share.menus.$menuId.tsx'
import { action as editAction } from './recipes/$recipeId_.edit.tsx'
import { loader as menuRecipeLoader } from './share.menus.$menuId_.recipes.$itemId.tsx'
import '#tests/setup/db-setup.ts'

/**
 * Steps a test slips in between two steps of the code under test, each run
 * once: after a share Save has read its source (it asks whether the saver
 * is a demo user next, before it writes), and after a stored photo file is
 * deleted.
 */
const between = vi.hoisted(() => ({
	saveReadSource: null as null | (() => Promise<unknown>),
	photoFileDeleted: null as null | (() => Promise<unknown>),
}))

function takeStep(name: keyof typeof between) {
	const step = between[name]
	between[name] = null
	return step?.()
}

vi.mock('#app/utils/demo-guard.server.ts', async (importOriginal) => {
	const real = await importOriginal<typeof DemoGuard>()
	return {
		...real,
		isDemoUserId: async (userId: string) => {
			await takeStep('saveReadSource')
			return real.isDemoUserId(userId)
		},
	}
})

vi.mock('#app/utils/storage.server.ts', async (importOriginal) => {
	const real = await importOriginal<typeof Storage>()
	return {
		...real,
		deleteRecipeImage: async (objectKey: string) => {
			await real.deleteRecipeImage(objectKey)
			await takeStep('photoFileDeleted')
		},
	}
})

type Kind = { demo: boolean; template?: boolean }

async function household({ demo, template = false }: Kind) {
	const user = createUser()
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: {
				create: {
					...user,
					// A template owner, as ensureDemoTemplate makes one.
					...(template
						? { email: `${user.username}@${DEMO_TEMPLATE_EMAIL_DOMAIN}` }
						: {}),
					demoExpiresAt: demo ? new Date(Date.now() + 3_600_000) : null,
				},
			},
		},
	})
	const home = await prisma.household.create({
		data: {
			name: 'Share test household',
			members: { create: { userId: session.userId, role: 'owner' } },
		},
	})
	return { ...session, householdId: home.id }
}

/** A Recipe, and a Menu holding it, in a new Household. */
async function shared(kind: Kind) {
	const owner = await household(kind)
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Lemon chickpeas',
			userId: owner.userId,
			householdId: owner.householdId,
			ingredients: { create: { name: 'chickpeas', order: 0 } },
		},
		select: { id: true },
	})
	const menu = await prisma.menu.create({
		data: {
			title: 'Terrace dinner',
			titleKey: `terrace dinner ${owner.householdId}`,
			householdId: owner.householdId,
			sections: {
				create: {
					name: 'Mains',
					order: 0,
					items: {
						create: {
							kind: 'recipe',
							order: 0,
							recipeId: recipe.id,
							recipeTitle: 'Lemon chickpeas',
						},
					},
				},
			},
		},
		select: {
			id: true,
			sections: { select: { items: { select: { id: true } } } },
		},
	})
	return {
		owner,
		recipeId: recipe.id,
		menuId: menu.id,
		itemId: menu.sections[0]!.items[0]!.id,
	}
}

async function args(
	urlPath: string,
	params: Record<string, string>,
	{
		session,
		post = false,
		body,
	}: { session?: { id: string }; post?: boolean; body?: FormData } = {},
) {
	const url = new URL(`${BASE_URL}${urlPath}`)
	const headers = new Headers()
	if (session) headers.set('cookie', await getSessionCookieHeader(session))
	return {
		params,
		context: new RouterContextProvider(),
		pattern: urlPath,
		url,
		request: new Request(url, {
			method: post ? 'POST' : 'GET',
			headers,
			body: post ? (body ?? new FormData()) : undefined,
		}),
	} as never
}

/** The status a loader or action answers with: 200, or a thrown Response's. */
async function statusOf(run: () => Promise<unknown>) {
	try {
		const result = await run()
		if (result instanceof Response) return result.status
		const init = (result as { init?: { status?: number } } | null)?.init
		return init?.status ?? 200
	} catch (error) {
		if (error instanceof Response) return error.status
		const status = (error as { status?: number } | null)?.status
		if (typeof status === 'number') return status
		throw error
	}
}

test('a demo Recipe answers as missing on its share page, signed in or not', async () => {
	const { recipeId } = await shared({ demo: true })
	const viewer = await household({ demo: false })
	const path = `/share/${recipeId}`

	expect(
		await statusOf(async () => recipeLoader(await args(path, { recipeId }))),
	).toBe(404)
	expect(
		await statusOf(async () =>
			recipeLoader(await args(path, { recipeId }, { session: viewer })),
		),
	).toBe(404)
})

test('a demo Menu and its Recipe answer as missing on the share pages', async () => {
	const { menuId, itemId } = await shared({ demo: true })

	expect(
		await statusOf(async () =>
			menuLoader(await args(`/share/menus/${menuId}`, { menuId })),
		),
	).toBe(404)
	expect(
		await statusOf(async () =>
			menuRecipeLoader(
				await args(`/share/menus/${menuId}/recipes/${itemId}`, {
					menuId,
					itemId,
				}),
			),
		),
	).toBe(404)
})

test('saving a demo Recipe or Menu from its share page answers as missing and copies nothing', async () => {
	const { recipeId, menuId } = await shared({ demo: true })
	const viewer = await household({ demo: false })

	expect(
		await statusOf(async () =>
			saveRecipe(
				await args(
					`/share/${recipeId}`,
					{ recipeId },
					{ session: viewer, post: true },
				),
			),
		),
	).toBe(404)
	expect(
		await statusOf(async () =>
			saveMenu(
				await args(
					`/share/menus/${menuId}`,
					{ menuId },
					{ session: viewer, post: true },
				),
			),
		),
	).toBe(404)
	expect(
		await prisma.recipe.count({ where: { householdId: viewer.householdId } }),
	).toBe(0)
	expect(
		await prisma.menu.count({ where: { householdId: viewer.householdId } }),
	).toBe(0)
})

test("a real Household's Recipe and Menu still show", async () => {
	const { recipeId, menuId, itemId } = await shared({ demo: false })

	expect(
		await statusOf(async () =>
			recipeLoader(await args(`/share/${recipeId}`, { recipeId })),
		),
	).toBe(200)
	expect(
		await statusOf(async () =>
			menuLoader(await args(`/share/menus/${menuId}`, { menuId })),
		),
	).toBe(200)
	expect(
		await statusOf(async () =>
			menuRecipeLoader(
				await args(`/share/menus/${menuId}/recipes/${itemId}`, {
					menuId,
					itemId,
				}),
			),
		),
	).toBe(200)
})

test("the demo template's Recipe answers as missing, and can't be saved", async () => {
	const { recipeId } = await shared({ demo: false, template: true })
	const viewer = await household({ demo: false })
	const path = `/share/${recipeId}`

	expect(
		await statusOf(async () => recipeLoader(await args(path, { recipeId }))),
	).toBe(404)
	expect(
		await statusOf(async () =>
			saveRecipe(
				await args(path, { recipeId }, { session: viewer, post: true }),
			),
		),
	).toBe(404)
	expect(
		await prisma.recipe.count({ where: { householdId: viewer.householdId } }),
	).toBe(0)
})

const UPLOADS_DIR = path.join(process.cwd(), 'tests/fixtures/uploaded')

const exists = (key: string) =>
	fs.access(path.join(UPLOADS_DIR, key)).then(
		() => true,
		() => false,
	)

/**
 * A real Household's Recipe, in a Menu, with a stored photo. Removes every
 * upload the test's users made on dispose.
 */
async function sharedWithPhoto() {
	const source = await shared({ demo: false })
	const key = `users/${source.owner.userId}/recipes/${source.recipeId}/images/source.jpg`
	await fs.mkdir(path.dirname(path.join(UPLOADS_DIR, key)), { recursive: true })
	await fs.writeFile(path.join(UPLOADS_DIR, key), 'source jpeg bytes')
	await prisma.recipeImage.create({
		data: { recipeId: source.recipeId, objectKey: key },
	})
	const owners = [source.owner.userId]
	return {
		...source,
		key,
		owners,
		async [Symbol.asyncDispose]() {
			for (const userId of owners) {
				await fs.rm(path.join(UPLOADS_DIR, 'users', userId), {
					recursive: true,
					force: true,
				})
			}
		},
	}
}

async function savedPhotoKeys(householdId: string) {
	const images = await prisma.recipeImage.findMany({
		where: { recipe: { householdId } },
		select: { objectKey: true },
	})
	return images.map((image) => image.objectKey)
}

// Demo copies share the template's photo files, so a demo user's Save points
// at the source's file too. These copies must never be left with a photo file
// that is gone.
test("a demo user's Save of a shared Recipe and Menu points at the source's photo", async () => {
	await using source = await sharedWithPhoto()
	const recipeSaver = await household({ demo: true })
	const menuSaver = await household({ demo: true })
	source.owners.push(recipeSaver.userId, menuSaver.userId)

	await saveRecipe(
		await args(
			`/share/${source.recipeId}`,
			{ recipeId: source.recipeId },
			{ session: recipeSaver, post: true },
		),
	)
	await saveMenu(
		await args(
			`/share/menus/${source.menuId}`,
			{ menuId: source.menuId },
			{ session: menuSaver, post: true },
		),
	)

	expect(await savedPhotoKeys(recipeSaver.householdId)).toEqual([source.key])
	expect(await savedPhotoKeys(menuSaver.householdId)).toEqual([source.key])
	expect(await exists(`users/${recipeSaver.userId}`)).toBe(false)
	expect(await exists(`users/${menuSaver.userId}`)).toBe(false)
})

test("a real user's Save of a shared Recipe and Menu gets photos of their own", async () => {
	await using source = await sharedWithPhoto()
	const recipeSaver = await household({ demo: false })
	const menuSaver = await household({ demo: false })
	source.owners.push(recipeSaver.userId, menuSaver.userId)

	await saveRecipe(
		await args(
			`/share/${source.recipeId}`,
			{ recipeId: source.recipeId },
			{ session: recipeSaver, post: true },
		),
	)
	await saveMenu(
		await args(
			`/share/menus/${source.menuId}`,
			{ menuId: source.menuId },
			{ session: menuSaver, post: true },
		),
	)

	for (const saver of [recipeSaver, menuSaver]) {
		const [key] = await savedPhotoKeys(saver.householdId)
		expect(key).toContain(`users/${saver.userId}/`)
		expect(await exists(key!)).toBe(true)
	}
})

/** A demo user who saved the shared Recipe, and the id of their copy. */
async function demoSaves(source: Awaited<ReturnType<typeof sharedWithPhoto>>) {
	const demo = await household({ demo: true })
	source.owners.push(demo.userId)
	await saveRecipe(
		await args(
			`/share/${source.recipeId}`,
			{ recipeId: source.recipeId },
			{ session: demo, post: true },
		),
	)
	const copy = await prisma.recipe.findFirstOrThrow({
		where: { householdId: demo.householdId },
		select: { id: true },
	})
	return { demo, copyId: copy.id }
}

test("deleting the source Recipe keeps the demo copy's photo", async () => {
	await using source = await sharedWithPhoto()
	const { demo } = await demoSaves(source)

	// The source's owner deletes their Recipe from its edit screen.
	const body = new FormData()
	body.set('intent', 'delete')
	await editAction(
		await args(
			`/recipes/${source.recipeId}/edit`,
			{ recipeId: source.recipeId },
			{ session: source.owner, post: true, body },
		),
	)

	expect(await prisma.recipe.count({ where: { id: source.recipeId } })).toBe(0)
	expect(await savedPhotoKeys(demo.householdId)).toEqual([source.key])
	expect(await exists(source.key)).toBe(true)
})

test("removing the demo user keeps the source Recipe's photo", async () => {
	await using source = await sharedWithPhoto()
	const { demo, copyId } = await demoSaves(source)

	// As expiry removes a demo user.
	await deleteAccount(demo.userId)

	expect(await prisma.recipe.count({ where: { id: copyId } })).toBe(0)
	expect(await savedPhotoKeys(source.owner.householdId)).toEqual([source.key])
	expect(await exists(source.key)).toBe(true)
})

test("a demo user's Save that fails partway leaves the source's photo alone", async () => {
	await using source = await sharedWithPhoto()
	const demo = await household({ demo: true })
	source.owners.push(demo.userId)
	// The copy is written in one transaction, which fails.
	using _write = vi
		.spyOn(prisma, '$transaction')
		.mockRejectedValueOnce(new Error('the database went away'))

	await expect(
		saveRecipe(
			await args(
				`/share/${source.recipeId}`,
				{ recipeId: source.recipeId },
				{ session: demo, post: true },
			),
		),
	).rejects.toThrow('the database went away')

	expect(await exists(source.key)).toBe(true)
	expect(await savedPhotoKeys(source.owner.householdId)).toEqual([source.key])
})

/** The photo keys in a Household whose file is gone. */
async function missingPhotos(householdId: string) {
	const missing = []
	for (const key of await savedPhotoKeys(householdId)) {
		if (!(await exists(key))) missing.push(key)
	}
	return missing
}

/** The source's owner deletes their Recipe from its edit screen. */
async function deleteSource(
	source: Awaited<ReturnType<typeof sharedWithPhoto>>,
) {
	const body = new FormData()
	body.set('intent', 'delete')
	await editAction(
		await args(
			`/recipes/${source.recipeId}/edit`,
			{ recipeId: source.recipeId },
			{ session: source.owner, post: true, body },
		),
	)
}

/** The Recipes a Household holds, with their photo rows. */
function recipesIn(householdId: string) {
	return prisma.recipe.findMany({
		where: { householdId },
		select: { title: true, image: { select: { objectKey: true } } },
	})
}

// Nothing showed the photo yet, so the delete removed the file, and the copy
// must not take its key.
test('a demo Save of a Recipe deleted while it saves copies it without the photo', async () => {
	await using source = await sharedWithPhoto()
	const demo = await household({ demo: true })
	source.owners.push(demo.userId)
	between.saveReadSource = () => deleteSource(source)

	const status = await statusOf(async () =>
		saveRecipe(
			await args(
				`/share/${source.recipeId}`,
				{ recipeId: source.recipeId },
				{ session: demo, post: true },
			),
		),
	)

	expect(between.saveReadSource).toBeNull()
	expect(await prisma.recipe.count({ where: { id: source.recipeId } })).toBe(0)
	expect(status).toBe(302)
	expect(await recipesIn(demo.householdId)).toEqual([
		{ title: 'Lemon chickpeas', image: null },
	])
})

test('a demo Save of a Menu whose Recipe is deleted while it saves copies it without the photo', async () => {
	await using source = await sharedWithPhoto()
	const demo = await household({ demo: true })
	source.owners.push(demo.userId)
	between.saveReadSource = () => deleteSource(source)

	const status = await statusOf(async () =>
		saveMenu(
			await args(
				`/share/menus/${source.menuId}`,
				{ menuId: source.menuId },
				{ session: demo, post: true },
			),
		),
	)

	expect(between.saveReadSource).toBeNull()
	expect(await prisma.recipe.count({ where: { id: source.recipeId } })).toBe(0)
	expect(status).toBe(302)
	expect(
		await prisma.menu.count({ where: { householdId: demo.householdId } }),
	).toBe(1)
	expect(await recipesIn(demo.householdId)).toEqual([
		{ title: 'Lemon chickpeas', image: null },
	])
})

test('a demo Save of a Recipe whose photo is replaced while it saves shows the new photo', async () => {
	await using source = await sharedWithPhoto()
	const demo = await household({ demo: true })
	source.owners.push(demo.userId)
	between.saveReadSource = async () => {
		const photo = await sharp({
			create: { width: 40, height: 30, channels: 3, background: '#c86b3c' },
		})
			.jpeg()
			.toBuffer()
		const body = new FormData()
		body.set('title', 'Lemon chickpeas')
		body.set('ingredients[0].name', 'chickpeas')
		body.set('instructions[0].content', 'Warm the chickpeas.')
		body.set('image', new File([photo], 'new.jpg', { type: 'image/jpeg' }))
		await editAction(
			await args(
				`/recipes/${source.recipeId}/edit`,
				{ recipeId: source.recipeId },
				{ session: source.owner, post: true, body },
			),
		)
	}

	await saveRecipe(
		await args(
			`/share/${source.recipeId}`,
			{ recipeId: source.recipeId },
			{ session: demo, post: true },
		),
	)

	expect(between.saveReadSource).toBeNull()
	expect(await exists(source.key)).toBe(false)
	expect(await savedPhotoKeys(demo.householdId)).toEqual(
		await savedPhotoKeys(source.owner.householdId),
	)
	expect(await missingPhotos(demo.householdId)).toEqual([])
})

// The delete takes the rows first, so the Save can't find a key whose file is
// about to go.
test("a demo Save while the source's delete removes its photo finds the Recipe gone", async () => {
	await using source = await sharedWithPhoto()
	const demo = await household({ demo: true })
	source.owners.push(demo.userId)
	let status: number | undefined
	between.photoFileDeleted = async () => {
		status = await statusOf(async () =>
			saveRecipe(
				await args(
					`/share/${source.recipeId}`,
					{ recipeId: source.recipeId },
					{ session: demo, post: true },
				),
			),
		)
	}

	await deleteSource(source)

	expect(between.photoFileDeleted).toBeNull()
	expect(status).toBe(404)
	expect(await recipesIn(demo.householdId)).toEqual([])
})
