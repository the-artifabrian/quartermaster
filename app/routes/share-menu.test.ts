import { http, HttpResponse } from 'msw'
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { menuTitleKey } from '#app/utils/menu-validation.ts'
import { saveSharedMenu } from '#app/utils/share-menu.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { server } from '#tests/mocks/index.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader as detailLoader } from './recipes/menus/$menuId.tsx'
import { loader as exportLoader } from './resources/export-all-data.tsx'
import { action as importAction } from './settings/profile/import.tsx'
import { action, loader } from './share.menus.$menuId.tsx'
import { loader as recipeLoader } from './share.menus.$menuId_.recipes.$itemId.tsx'

async function household() {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
	})
	const home = await prisma.household.create({
		data: {
			name: 'Disposable household',
			members: { create: { userId: session.userId, role: 'owner' } },
		},
	})
	return { ...session, householdId: home.id }
}

async function setup() {
	const source = await household()
	const target = await household()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Lemon chickpeas',
			description: 'For a relaxed terrace dinner',
			userId: source.userId,
			householdId: source.householdId,
			activeTime: 10,
			totalTime: 25,
			yieldAmount: 4,
			yieldLabel: 'bowls',
			sourceUrl: 'https://example.com/chickpeas',
			rawText: 'private recoverable input',
			notes: 'private personal note',
			isFavorite: true,
			isAiGenerated: true,
			image: {
				create: {
					objectKey: 'menu-test/chickpeas.png',
					altText: 'Lemon chickpeas in a bowl',
				},
			},
			ingredients: {
				create: [
					{ name: 'Chickpeas', isHeading: true, order: 0 },
					{
						name: 'chickpeas',
						amount: '400',
						unit: 'g',
						notes: 'drained',
						order: 1,
					},
					{ name: 'lemon', amount: '1/2', order: 2 },
				],
			},
			instructions: {
				create: [
					{ content: 'Warm the chickpeas.', order: 0 },
					{ content: 'Finish with lemon.', order: 1 },
				],
			},
			metadataAssignments: {
				create: {
					value: {
						create: {
							householdId: source.householdId,
							dimension: 'course',
							name: 'Side',
							nameKey: 'side',
						},
					},
				},
			},
		},
	})
	const menu = await prisma.menu.create({
		data: {
			title: 'Terrace dinner',
			titleKey: menuTitleKey('Terrace dinner'),
			description: 'Serve outside at sunset.',
			defaultGuestCount: 6,
			householdId: source.householdId,
			sections: {
				create: [
					{
						name: 'Dinner',
						order: 0,
						items: {
							create: [
								{
									kind: 'recipe',
									order: 0,
									recipeId: recipe.id,
									recipeTitle: recipe.title,
									scaleMultiplier: 1.5,
									note: 'Serve warm with flatbread.',
								},
								{
									kind: 'note',
									order: 1,
									note: 'Lemonade with mint — mix just before serving',
									shoppingLines: {
										create: [
											{
												name: 'mint',
												quantity: '2',
												unit: 'bunches',
												order: 0,
											},
											{ name: 'ice', order: 1 },
										],
									},
								},
							],
						},
					},
					{
						name: 'For later',
						order: 1,
						items: {
							create: {
								kind: 'recipe',
								order: 0,
								recipeId: recipe.id,
								recipeTitle: recipe.title,
								scaleMultiplier: 0.5,
								note: 'Keep a small bowl aside.',
							},
						},
					},
				],
			},
		},
	})
	const objects = new Map<string, string>([
		['menu-test/chickpeas.png', 'independent image bytes'],
	])
	const endpoint = `${process.env.AWS_ENDPOINT_URL_S3}/${process.env.BUCKET_NAME}/:key*`
	server.use(
		http.get(endpoint, ({ params }) => {
			const body = objects.get((params.key as string[]).join('/'))
			return new HttpResponse(body, {
				status: body ? 200 : 404,
				headers: { 'Content-Type': 'image/png' },
			})
		}),
		http.put(endpoint, async ({ params, request }) => {
			objects.set((params.key as string[]).join('/'), await request.text())
			return new HttpResponse(null, { status: 201 })
		}),
		http.delete(endpoint, ({ params }) => {
			objects.delete((params.key as string[]).join('/'))
			return new HttpResponse(null, { status: 204 })
		}),
	)
	return { source, target, recipe, menu, objects, endpoint }
}

async function args(menuId: string, session?: { id: string }, post = false) {
	const url = new URL(`${BASE_URL}/share/menus/${menuId}`)
	return {
		params: { menuId },
		context: new RouterContextProvider(),
		pattern: '/share/menus/:menuId',
		url,
		request: new Request(url, {
			method: post ? 'POST' : 'GET',
			headers: session ? { cookie: await getSessionCookieHeader(session) } : {},
		}),
	}
}

function bundle(id: string) {
	return prisma.menu.findUniqueOrThrow({
		where: { id },
		include: {
			sections: {
				orderBy: { order: 'asc' },
				include: {
					items: {
						orderBy: { order: 'asc' },
						include: {
							shoppingLines: { orderBy: { order: 'asc' } },
							recipe: {
								include: {
									ingredients: { orderBy: { order: 'asc' } },
									instructions: { orderBy: { order: 'asc' } },
									image: true,
									metadataAssignments: { include: { value: true } },
								},
							},
						},
					},
				},
			},
		},
	})
}

test('anonymous live reading exposes only Menu content and included Recipes, at each card quantity', async () => {
	const { source, target, recipe, menu } = await setup()
	const loaded = await loader(await args(menu.id))
	expect(loaded.isLoggedIn).toBe(false)
	expect(loaded.menu.sections.map((section) => section.name)).toEqual([
		'Dinner',
		'For later',
	])
	const first = loaded.menu.sections[0]!.items[0]!
	const read = await recipeLoader({
		...(await args(menu.id)),
		params: { menuId: menu.id, itemId: first.id },
	})
	expect(read.menuContext).toMatchObject({
		scaleMultiplier: 1.5,
		note: 'Serve warm with flatbread.',
	})
	expect(read.recipe.ingredients.map((ing) => ing.name)).toEqual([
		'Chickpeas',
		'chickpeas',
		'lemon',
	])
	for (const hidden of [
		'rawText',
		'private personal note',
		'householdId',
		'userId',
		'isFavorite',
		'staplesCutoverAt',
	]) {
		expect(JSON.stringify([loaded, read])).not.toContain(hidden)
	}
	await expect(detailLoader(await args(menu.id, target))).rejects.toMatchObject(
		{ status: 403 },
	)
	await expect(
		action(await args(menu.id, undefined, true)),
	).rejects.toMatchObject({ status: 302 })
	try {
		await action(await args(menu.id, undefined, true))
	} catch (error) {
		expect((error as Response).headers.get('location')).toBe(
			`/login?redirectTo=%2Fshare%2Fmenus%2F${menu.id}`,
		)
	}
	await prisma.recipe.update({
		where: { id: recipe.id },
		data: { title: 'Updated chickpeas' },
	})
	expect(
		(await loader(await args(menu.id))).menu.sections[0]!.items[0]!.recipe
			?.title,
	).toBe('Updated chickpeas')
	const foreignMenu = await prisma.menu.create({
		data: {
			title: 'Other',
			titleKey: 'other',
			householdId: target.householdId,
		},
	})
	await expect(
		recipeLoader({
			...(await args(foreignMenu.id)),
			params: { menuId: foreignMenu.id, itemId: first.id },
		}),
	).rejects.toMatchObject({ status: 404 })
	// A corrupt foreign reference cannot expose or copy another household's Recipe.
	await prisma.recipe.update({
		where: { id: recipe.id },
		data: { householdId: target.householdId },
	})
	expect(
		(await loader(await args(menu.id))).menu.sections[0]!.items[0]!.recipe,
	).toBeNull()
	await expect(
		recipeLoader({
			...(await args(menu.id)),
			params: { menuId: menu.id, itemId: first.id },
		}),
	).rejects.toMatchObject({ status: 404 })
	await expect(
		saveSharedMenu({ ...target, menuId: menu.id }),
	).rejects.toMatchObject({ status: 409 })
	expect(await saveSharedMenu({ ...source, menuId: menu.id })).toBe(menu.id)
})

test('Save copies one complete Recipe per source, preserves positions, ignores title matches and remains independent', async () => {
	const { target, recipe, menu, objects } = await setup()
	const collision = await prisma.recipe.create({
		data: {
			title: recipe.title,
			description: 'My different Recipe',
			userId: target.userId,
			householdId: target.householdId,
		},
	})
	await prisma.menu.create({
		data: {
			title: menu.title,
			titleKey: menu.titleKey,
			householdId: target.householdId,
		},
	})
	const response = (await action(await args(menu.id, target, true))) as Response
	expect(response.status).toBe(302)
	const savedId = response.headers.get('location')!.split('/').pop()!
	const copy = await bundle(savedId)
	expect(copy).toMatchObject({
		title: 'Terrace dinner (2)',
		description: menu.description,
		defaultGuestCount: 6,
		copiedFromMenuId: menu.id,
	})
	const items = copy.sections.flatMap((s) => s.items)
	expect(items.map((i) => [i.kind, i.scaleMultiplier, i.note])).toEqual([
		['recipe', 1.5, 'Serve warm with flatbread.'],
		['note', null, 'Lemonade with mint — mix just before serving'],
		['recipe', 0.5, 'Keep a small bowl aside.'],
	])
	expect(items[0]!.recipeId).toBe(items[2]!.recipeId)
	const copiedRecipe = items[0]!.recipe!
	expect(copiedRecipe.id).not.toBe(recipe.id)
	expect(copiedRecipe.id).not.toBe(collision.id)
	expect(copiedRecipe).toMatchObject({
		title: recipe.title,
		rawText: recipe.rawText,
		notes: null,
		isFavorite: false,
		isAiGenerated: true,
		activeTime: 10,
		totalTime: 25,
		yieldAmount: 4,
		yieldLabel: 'bowls',
		sourceUrl: recipe.sourceUrl,
		householdId: target.householdId,
	})
	expect(
		copiedRecipe.ingredients.map((i) => [
			i.name,
			i.amount,
			i.unit,
			i.notes,
			i.isHeading,
		]),
	).toEqual([
		['Chickpeas', null, null, null, true],
		['chickpeas', '400', 'g', 'drained', false],
		['lemon', '1/2', null, null, false],
	])
	expect(copiedRecipe.instructions.map((s) => s.content)).toEqual([
		'Warm the chickpeas.',
		'Finish with lemon.',
	])
	expect(copiedRecipe.metadataAssignments[0]!.value).toMatchObject({
		name: 'Side',
		householdId: target.householdId,
	})
	expect(
		items[1]!.shoppingLines.map((l) => [l.name, l.quantity, l.unit]),
	).toEqual([
		['mint', '2', 'bunches'],
		['ice', null, null],
	])
	expect(copiedRecipe.image).toMatchObject({
		altText: 'Lemon chickpeas in a bowl',
	})
	expect(copiedRecipe.image!.objectKey).not.toBe('menu-test/chickpeas.png')
	expect(objects.get(copiedRecipe.image!.objectKey)).toBe(
		'independent image bytes',
	)
	expect(await prisma.meal.count()).toBe(0)
	expect(await prisma.shoppingListItem.count()).toBe(0)
	expect(await prisma.householdIngredient.count()).toBe(0)
	await prisma.recipe.update({
		where: { id: copiedRecipe.id },
		data: { title: 'My edited chickpeas' },
	})
	await prisma.menu.update({
		where: { id: savedId },
		data: { title: 'My dinner', titleKey: 'my dinner' },
	})
	expect(await saveSharedMenu({ ...target, menuId: menu.id })).toBe(savedId)
	expect((await loader(await args(menu.id, target))).savedMenuId).toBe(savedId)
	await prisma.menu.delete({ where: { id: menu.id } })
	await prisma.recipe.delete({ where: { id: recipe.id } })
	objects.delete('menu-test/chickpeas.png')
	await expect(loader(await args(menu.id))).rejects.toMatchObject({
		status: 404,
	})
	expect(await saveSharedMenu({ ...target, menuId: menu.id })).toBe(savedId)
	expect((await bundle(savedId)).sections[0]!.items[0]!.recipe!.title).toBe(
		'My edited chickpeas',
	)
	expect(objects.get(copiedRecipe.image!.objectKey)).toBe(
		'independent image bytes',
	)
	expect(
		await prisma.recipe.count({ where: { householdId: target.householdId } }),
	).toBe(2)
})

test('ingredient links use copied Recipe and ingredient identities, even when source order values tie', async () => {
	const { target, recipe, menu } = await setup()
	const linked = await prisma.recipe.create({
		data: {
			title: 'Lemon dressing',
			userId: recipe.userId,
			householdId: recipe.householdId,
		},
	})
	const section = (await bundle(menu.id)).sections[0]!
	await prisma.menuItem.create({
		data: {
			sectionId: section.id,
			kind: 'recipe',
			recipeId: linked.id,
			recipeTitle: linked.title,
			scaleMultiplier: 1,
			order: 2,
		},
	})
	await prisma.ingredient.createMany({
		data: [
			{
				recipeId: recipe.id,
				name: 'dressing',
				order: 3,
				linkedRecipeId: linked.id,
			},
			{ recipeId: recipe.id, name: 'salt', order: 3 },
		],
	})
	const saved = await bundle(
		await saveSharedMenu({ ...target, menuId: menu.id }),
	)
	const copied = saved.sections[0]!.items[0]!.recipe!
	const copiedLink = saved.sections[0]!.items[2]!.recipeId
	expect(
		copied.ingredients.find((ing) => ing.name === 'dressing')!.linkedRecipeId,
	).toBe(copiedLink)
	expect(
		copied.ingredients.find((ing) => ing.name === 'salt')!.linkedRecipeId,
	).toBeNull()
	expect(copiedLink).not.toBe(linked.id)
})

test('concurrent saves produce one bundle and discard the unused staged image', async () => {
	const { target, menu, objects } = await setup()
	const results = await Promise.all([
		saveSharedMenu({ ...target, menuId: menu.id }),
		saveSharedMenu({ ...target, menuId: menu.id }),
	])
	expect(results[0]).toBe(results[1])
	expect(
		await prisma.recipe.count({ where: { householdId: target.householdId } }),
	).toBe(1)
	expect(objects.size).toBe(2)
})

test('missing Recipe, missing image and a failed database write leave no partial bundle', async () => {
	const { target, recipe, menu, objects } = await setup()
	// Fail the last nested write, after Recipe and image creation.
	await prisma.$executeRawUnsafe(
		`CREATE TRIGGER fail_shared_menu BEFORE INSERT ON Menu WHEN NEW.copiedFromMenuId IS NOT NULL BEGIN SELECT RAISE(ABORT, 'injected bundle failure'); END`,
	)
	await expect(saveSharedMenu({ ...target, menuId: menu.id })).rejects.toThrow()
	expect(
		await prisma.menu.count({ where: { householdId: target.householdId } }),
	).toBe(0)
	expect(
		await prisma.recipe.count({ where: { householdId: target.householdId } }),
	).toBe(0)
	expect(
		await prisma.recipeMetadataValue.count({
			where: { householdId: target.householdId },
		}),
	).toBe(0)
	expect(objects.size).toBe(1)
	await prisma.$executeRawUnsafe('DROP TRIGGER fail_shared_menu')
	objects.clear()
	await expect(saveSharedMenu({ ...target, menuId: menu.id })).rejects.toThrow(
		'Unable to read',
	)
	await prisma.recipe.delete({ where: { id: recipe.id } })
	const failed = await action(await args(menu.id, target, true))
	expect(failed).toMatchObject({
		init: { status: 409 },
		data: { error: expect.stringContaining('unavailable Recipe') },
	})
	expect(
		await prisma.menu.count({ where: { householdId: target.householdId } }),
	).toBe(0)
	expect(
		await prisma.recipe.count({ where: { householdId: target.householdId } }),
	).toBe(0)
})

test('a failed image upload cleans staged bytes and reports failure without a bundle', async () => {
	const { target, menu, objects, endpoint } = await setup()
	consoleError.mockImplementation(() => {})
	server.use(
		http.put(endpoint, async ({ params, request }) => {
			objects.set((params.key as string[]).join('/'), await request.text())
			return new HttpResponse(null, { status: 503 })
		}),
	)
	const failed = await action(await args(menu.id, target, true))
	expect(failed).toMatchObject({
		init: { status: 500 },
		data: { error: expect.stringContaining('Unable to save') },
	})
	expect(objects.size).toBe(1)
	expect(
		await prisma.menu.count({ where: { householdId: target.householdId } }),
	).toBe(0)
	expect(
		await prisma.recipe.count({ where: { householdId: target.householdId } }),
	).toBe(0)
})

test('a household change during image transfer cannot write to the old household', async () => {
	const { target, menu, objects, endpoint } = await setup()
	server.use(
		http.put(endpoint, async ({ params, request }) => {
			objects.set((params.key as string[]).join('/'), await request.text())
			await prisma.householdMember.deleteMany({
				where: { userId: target.userId },
			})
			return new HttpResponse(null, { status: 201 })
		}),
	)
	await expect(
		saveSharedMenu({ ...target, menuId: menu.id }),
	).rejects.toMatchObject({ status: 403 })
	expect(objects.size).toBe(1)
	expect(
		await prisma.recipe.count({ where: { householdId: target.householdId } }),
	).toBe(0)
})

test('JSON recovery preserves repeat-save identity after a renamed saved Menu is restored', async () => {
	const { target, menu } = await setup()
	const savedId = await saveSharedMenu({ ...target, menuId: menu.id })
	await prisma.menu.update({
		where: { id: savedId },
		data: { title: 'My dinner', titleKey: 'my dinner' },
	})
	const exportResponse = await exportLoader({
		...(await args(menu.id, target)),
		params: {},
	})
	const exported = (await exportResponse.json()) as {
		menus: Array<{ copiedFromMenuId: string }>
	}
	expect(exported.menus[0]!.copiedFromMenuId).toBe(menu.id)
	const restored = await household()
	await prisma.menu.create({
		data: {
			title: 'My dinner',
			titleKey: 'my dinner',
			householdId: restored.householdId,
		},
	})
	const routeArgs = await args(menu.id, restored)
	const result = await importAction({
		...routeArgs,
		params: {},
		request: new Request(routeArgs.url, {
			method: 'POST',
			headers: routeArgs.request.headers,
			body: new URLSearchParams({ importData: JSON.stringify(exported) }),
		}),
	})
	expect(result).toMatchObject({
		results: { menus: { created: 1, errored: 0 } },
	})
	const restoredMenu = await prisma.menu.findFirstOrThrow({
		where: { householdId: restored.householdId, copiedFromMenuId: menu.id },
	})
	expect(restoredMenu.title).toBe('My dinner (2)')
	expect(await saveSharedMenu({ ...restored, menuId: menu.id })).toBe(
		restoredMenu.id,
	)
	const items = (await bundle(restoredMenu.id)).sections
		.flatMap((s) => s.items)
		.filter((i) => i.kind === 'recipe')
	expect(items.map((i) => i.scaleMultiplier)).toEqual([1.5, 0.5])
	expect(items[0]!.recipeId).toBe(items[1]!.recipeId)
})
