import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { menuTitleKey } from '#app/utils/menu-validation.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './plan-choices.tsx'

async function setupHousehold(name: string) {
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
				name,
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		return { ...session, householdId: household.id }
	})
}

function loaderArgs(request: Request) {
	const path = '/resources/plan-choices'
	return {
		request,
		params: {},
		context: new RouterContextProvider(),
		pattern: path,
		url: new URL(`${BASE_URL}${path}`),
	}
}

test('Plan choices require an authenticated household', async () => {
	const path = '/resources/plan-choices'

	await expect(
		loader(loaderArgs(new Request(`${BASE_URL}${path}`))),
	).rejects.toMatchObject({ status: 302 })
})

test('Plan choices preserve picker metadata, ordering, and Household scope', async () => {
	const owner = await setupHousehold('Plan choice owner')
	const outsider = await setupHousehold('Other Plan household')
	const [appleTart, zucchiniSoup] = await Promise.all([
		prisma.recipe.create({
			data: {
				title: 'Apple Tart',
				userId: owner.userId,
				householdId: owner.householdId,
				totalTime: 75,
				yieldAmount: 8,
				yieldLabel: 'slices',
			},
		}),
		prisma.recipe.create({
			data: {
				title: 'Zucchini Soup',
				userId: owner.userId,
				householdId: owner.householdId,
				totalTime: 30,
				isFavorite: true,
			},
		}),
		prisma.recipe.create({
			data: {
				title: 'Secret Recipe',
				userId: outsider.userId,
				householdId: outsider.householdId,
			},
		}),
	])
	const olderMenu = await prisma.menu.create({
		data: {
			title: 'Older Menu',
			titleKey: menuTitleKey('Older Menu'),
			householdId: owner.householdId,
			updatedAt: new Date('2026-08-01T12:00:00Z'),
			sections: {
				create: {
					order: 0,
					items: {
						create: {
							kind: 'recipe',
							order: 0,
							recipeTitle: 'Archived Recipe',
							scaleMultiplier: 1,
						},
					},
				},
			},
		},
	})
	const recentMenu = await prisma.menu.create({
		data: {
			title: 'Recent Menu',
			titleKey: menuTitleKey('Recent Menu'),
			householdId: owner.householdId,
			updatedAt: new Date('2026-09-01T12:00:00Z'),
			sections: {
				create: {
					order: 0,
					items: {
						create: [
							{
								kind: 'recipe',
								order: 0,
								recipeId: zucchiniSoup.id,
								recipeTitle: zucchiniSoup.title,
								scaleMultiplier: 1,
							},
							{ kind: 'note', order: 1, note: 'Serve outside' },
						],
					},
				},
			},
		},
	})
	await Promise.all([
		prisma.menu.create({
			data: {
				title: 'Blank Draft',
				titleKey: menuTitleKey('Blank Draft'),
				householdId: owner.householdId,
				sections: { create: { order: 0 } },
			},
		}),
		prisma.menu.create({
			data: {
				title: 'Secret Menu',
				titleKey: menuTitleKey('Secret Menu'),
				householdId: outsider.householdId,
				sections: {
					create: {
						order: 0,
						items: { create: { kind: 'note', order: 0, note: 'Hidden' } },
					},
				},
			},
		}),
	])
	const cookie = await getSessionCookieHeader(owner)
	const path = '/resources/plan-choices'

	const result = await loader(
		loaderArgs(new Request(`${BASE_URL}${path}`, { headers: { cookie } })),
	)

	expect(result.init?.headers).toEqual({
		'Cache-Control': 'private, no-store',
	})
	expect(result.data.recipes).toEqual([
		{
			id: appleTart.id,
			title: 'Apple Tart',
			totalTime: 75,
			yieldAmount: 8,
			yieldLabel: 'slices',
			isFavorite: false,
			image: null,
		},
		{
			id: zucchiniSoup.id,
			title: 'Zucchini Soup',
			totalTime: 30,
			yieldAmount: null,
			yieldLabel: null,
			isFavorite: true,
			image: null,
		},
	])
	expect(result.data.menus).toEqual([
		{
			id: recentMenu.id,
			title: 'Recent Menu',
			recipeCount: 1,
			noteCount: 1,
			recipeTitles: ['Zucchini Soup'],
		},
		{
			id: olderMenu.id,
			title: 'Older Menu',
			recipeCount: 1,
			noteCount: 0,
			recipeTitles: ['Archived Recipe'],
		},
	])
})
