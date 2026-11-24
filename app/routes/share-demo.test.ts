/**
 * Failure list for demo Households on the public share pages, which are open
 * to anyone with the link:
 *
 * 1. A Recipe in a demo user's Household shows at /share/:recipeId. It must
 *    answer as a missing Recipe does, signed in or not.
 * 2. A Menu in a demo Household shows at /share/menus/:menuId, or one of its
 *    Recipes at /share/menus/:menuId/recipes/:itemId. Both must answer as
 *    missing.
 * 3. A signed-in user saves a demo Recipe or Menu through the share page's
 *    Save, which reads the source the same way. It must answer as missing
 *    and copy nothing.
 * 4. A real Household's Recipe and Menu stop showing. They must still show.
 */
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import {
	action as saveRecipe,
	loader as recipeLoader,
} from './share.$recipeId.tsx'
import {
	action as saveMenu,
	loader as menuLoader,
} from './share.menus.$menuId.tsx'
import { loader as menuRecipeLoader } from './share.menus.$menuId_.recipes.$itemId.tsx'
import '#tests/setup/db-setup.ts'

async function household({ demo }: { demo: boolean }) {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: {
				create: {
					...createUser(),
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
async function shared({ demo }: { demo: boolean }) {
	const owner = await household({ demo })
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
	{ session, post = false }: { session?: { id: string }; post?: boolean } = {},
) {
	const url = new URL(`${BASE_URL}${urlPath}`)
	const headers = new Headers()
	if (session) headers.set('cookie', await getSessionCookieHeader(session))
	return {
		params,
		context: new RouterContextProvider(),
		pattern: urlPath,
		url,
		request: new Request(url, { method: post ? 'POST' : 'GET', headers }),
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
