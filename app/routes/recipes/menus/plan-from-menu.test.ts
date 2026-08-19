import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { getWeekStart, serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { removeRecipeItem } from '#app/utils/meal.server.ts'
import { menuTitleKey } from '#app/utils/menu-validation.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { action as planAction } from './$menuId.tsx'

function makeMenuArgs(menuId: string) {
	return {
		params: { menuId },
		context: new RouterContextProvider(),
		pattern: `/recipes/menus/:menuId`,
		url: new URL(`${BASE_URL}/recipes/menus/${menuId}`),
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
				name: 'Test Household',
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		return { ...session, householdId: household.id }
	})
}

async function planMenu(
	session: { id: string },
	menuId: string,
	formFields: Record<string, string>,
) {
	const cookie = await getSessionCookieHeader(session)
	const request = new Request(`${BASE_URL}/recipes/menus/${menuId}`, {
		method: 'POST',
		headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(formFields).toString(),
	})
	return planAction({ request, ...makeMenuArgs(menuId) })
}

async function createRecipe(
	session: { userId: string },
	householdId: string,
	title: string,
) {
	return prisma.recipe.create({
		data: { title, userId: session.userId, householdId },
		select: { id: true, title: true },
	})
}

/**
 * The canonical hosted-Menu shape from the spec, seeded directly: an unnamed
 * section with one recipe, a named section interleaving recipes around a note
 * card with Shopping lines, plus a missing card frozen from a deleted Recipe.
 */
async function seedHostedMenu(
	session: { userId: string },
	householdId: string,
) {
	const hummus = await createRecipe(session, householdId, 'Hummus')
	const pita = await createRecipe(session, householdId, 'Pita')
	const stew = await createRecipe(session, householdId, 'Stew')
	const menu = await prisma.menu.create({
		data: {
			title: 'Levantine Feast',
			titleKey: menuTitleKey('Levantine Feast'),
			defaultGuestCount: 6,
			householdId,
			sections: {
				create: [
					{
						name: null,
						order: 0,
						items: {
							create: [
								{
									kind: 'recipe',
									order: 0,
									recipeId: hummus.id,
									recipeTitle: 'Hummus',
									scaleMultiplier: 1,
								},
							],
						},
					},
					{
						name: 'Mains',
						order: 1,
						items: {
							create: [
								{
									kind: 'recipe',
									order: 0,
									recipeId: pita.id,
									recipeTitle: 'Pita',
									scaleMultiplier: 2.5,
									note: 'Two oven batches',
								},
								{
									kind: 'note',
									order: 1,
									note: 'Drinks and candles',
									shoppingLines: {
										create: [
											{ name: 'Lemonade', quantity: '2', unit: 'l', order: 0 },
											{ name: 'Candles', order: 1 },
										],
									},
								},
								{
									kind: 'recipe',
									order: 2,
									recipeId: stew.id,
									recipeTitle: 'Stew',
									scaleMultiplier: 1,
								},
								{
									kind: 'recipe',
									order: 3,
									recipeId: null,
									recipeTitle: 'Lost Baklava',
									scaleMultiplier: 3,
								},
							],
						},
					},
				],
			},
		},
		select: { id: true, updatedAt: true },
	})
	return { menu, hummus, pita, stew }
}

async function loadPlannedMeal(menuId: string) {
	return prisma.meal.findFirstOrThrow({
		where: { sourceMenuId: menuId },
		include: {
			sections: { orderBy: { order: 'asc' } },
			noteItems: {
				orderBy: { order: 'asc' },
				include: { shoppingLines: { orderBy: { order: 'asc' } } },
			},
			recipeItems: { orderBy: [{ sectionId: 'asc' }, { order: 'asc' }] },
		},
	})
}

describe('add to plan from menu detail', () => {
	test('copies the menu into one frozen Meal snapshot with context fields', async () => {
		const session = await setupUser()
		const { menu, hummus, pita, stew } = await seedHostedMenu(
			session,
			session.householdId,
		)

		const response = await planMenu(session, menu.id, {
			date: '2026-09-01',
			label: 'dinner',
			time: '18:30',
			timeZone: 'Europe/Bucharest',
			guestCount: '8',
		})
		const expectedWeek = serializeDate(
			getWeekStart(new Date('2026-09-01T00:00:00.000Z')),
		)
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(302)
		expect((response as Response).headers.get('location')).toBe(
			`/plan?weekStart=${expectedWeek}`,
		)

		const meal = await loadPlannedMeal(menu.id)
		expect(meal).toMatchObject({
			label: 'dinner',
			genericText: null,
			completed: false,
			guestCount: 8,
			servingTimeZone: 'Europe/Bucharest',
			sourceMenuId: menu.id,
		})
		expect(meal.date.toISOString()).toBe('2026-09-01T00:00:00.000Z')
		// 18:30 Bucharest (EEST, UTC+3) names 15:30 UTC
		expect(meal.servingAt?.toISOString()).toBe('2026-09-01T15:30:00.000Z')
		expect(meal.sourceMenuRevision?.getTime()).toBe(menu.updatedAt.getTime())

		// Frozen section structure in order
		expect(meal.sections.map((s) => [s.name, s.order])).toEqual([
			[null, 0],
			['Mains', 1],
		])
		const [unnamed, mains] = meal.sections

		// Every card frozen: identity, multiplier, display note; new items uncooked
		const bySection = (sectionId: string) =>
			meal.recipeItems.filter((item) => item.sectionId === sectionId)
		expect(bySection(unnamed!.id)).toMatchObject([
			{
				order: 0,
				recipeId: hummus.id,
				recipeTitle: 'Hummus',
				scaleMultiplier: 1,
				cooked: false,
				note: null,
			},
		])
		expect(bySection(mains!.id)).toMatchObject([
			{
				order: 0,
				recipeId: pita.id,
				recipeTitle: 'Pita',
				scaleMultiplier: 2.5,
				cooked: false,
				note: 'Two oven batches',
			},
			{
				order: 2,
				recipeId: stew.id,
				recipeTitle: 'Stew',
				scaleMultiplier: 1,
				cooked: false,
			},
			// The deleted Recipe stays a missing card with frozen identity
			{
				order: 3,
				recipeId: null,
				recipeTitle: 'Lost Baklava',
				scaleMultiplier: 3,
			},
		])
		expect(meal.recipeItems.filter((item) => item.sectionId == null)).toEqual(
			[],
		)

		// The note card and its ordinary Shopping lines, in the shared order
		expect(meal.noteItems).toMatchObject([
			{ sectionId: mains!.id, order: 1, text: 'Drinks and candles' },
		])
		expect(meal.noteItems[0]!.shoppingLines).toMatchObject([
			{ name: 'Lemonade', quantity: '2', unit: 'l', order: 0 },
			{ name: 'Candles', quantity: null, unit: null, order: 1 },
		])
	})

	test('later Menu edits never mutate the planned Meal', async () => {
		const session = await setupUser()
		const { menu, pita } = await seedHostedMenu(session, session.householdId)
		await planMenu(session, menu.id, { date: '2026-09-01' })
		const before = await loadPlannedMeal(menu.id)

		// Edit the menu afterwards: retitle, rename a section, rescale a card,
		// delete the note card entirely.
		await prisma.menu.update({
			where: { id: menu.id },
			data: {
				title: 'Rewritten Feast',
				titleKey: menuTitleKey('Rewritten Feast'),
			},
		})
		await prisma.menuSection.updateMany({
			where: { menuId: menu.id, name: 'Mains' },
			data: { name: 'Second Course' },
		})
		await prisma.menuItem.updateMany({
			where: { recipeId: pita.id, section: { menuId: menu.id } },
			data: { scaleMultiplier: 9, note: 'changed' },
		})
		await prisma.menuItem.deleteMany({
			where: { kind: 'note', section: { menuId: menu.id } },
		})

		const after = await loadPlannedMeal(menu.id)
		expect(after.sections.map((s) => s.name)).toEqual([null, 'Mains'])
		expect(
			after.recipeItems.find((item) => item.recipeId === pita.id),
		).toMatchObject({ scaleMultiplier: 2.5, note: 'Two oven batches' })
		expect(after.noteItems).toHaveLength(1)
		// The revision still names the snapshot instant, now older than the Menu
		expect(after.sourceMenuRevision?.getTime()).toBe(
			before.sourceMenuRevision?.getTime(),
		)
		const editedMenu = await prisma.menu.findUniqueOrThrow({
			where: { id: menu.id },
			select: { updatedAt: true },
		})
		expect(editedMenu.updatedAt.getTime()).toBeGreaterThan(
			after.sourceMenuRevision!.getTime(),
		)
	})

	test('guest count is context only — multipliers copy unchanged', async () => {
		const session = await setupUser()
		const { menu } = await seedHostedMenu(session, session.householdId)
		await planMenu(session, menu.id, { date: '2026-09-02', guestCount: '40' })
		const meal = await loadPlannedMeal(menu.id)
		expect(meal.guestCount).toBe(40)
		expect(meal.recipeItems.map((item) => item.scaleMultiplier).sort()).toEqual(
			[1, 1, 2.5, 3],
		)
	})

	test('canonical Recipe corrections stay readable; deletion leaves a missing card', async () => {
		const session = await setupUser()
		const { menu, stew } = await seedHostedMenu(session, session.householdId)
		await planMenu(session, menu.id, { date: '2026-09-03' })

		// A correction to the canonical Recipe stays reachable through the kept
		// reference — the frozen display title does not chase it.
		await prisma.recipe.update({
			where: { id: stew.id },
			data: { title: 'Corrected Stew' },
		})
		const corrected = await prisma.mealRecipeItem.findFirstOrThrow({
			where: { meal: { sourceMenuId: menu.id }, recipeId: stew.id },
			include: { recipe: { select: { title: true } } },
		})
		expect(corrected.recipeTitle).toBe('Stew')
		expect(corrected.recipe?.title).toBe('Corrected Stew')

		// Deleting the Recipe nulls the reference but keeps the frozen card
		await prisma.recipe.delete({ where: { id: stew.id } })
		const missing = await prisma.mealRecipeItem.findFirstOrThrow({
			where: { id: corrected.id },
		})
		expect(missing.recipeId).toBeNull()
		expect(missing.recipeTitle).toBe('Stew')
	})

	test('appends after the day’s existing Meals', async () => {
		const session = await setupUser()
		const { menu } = await seedHostedMenu(session, session.householdId)
		const weekStart = getWeekStart(new Date('2026-09-01T00:00:00.000Z'))
		const plan = await prisma.mealPlan.create({
			data: { householdId: session.householdId, weekStart },
		})
		await prisma.meal.create({
			data: {
				mealPlanId: plan.id,
				date: new Date('2026-09-01T00:00:00.000Z'),
				order: 0,
				genericText: 'Leftovers',
			},
		})
		await planMenu(session, menu.id, { date: '2026-09-01' })
		const meal = await loadPlannedMeal(menu.id)
		expect(meal.mealPlanId).toBe(plan.id)
		expect(meal.order).toBe(1)
	})

	test('an empty menu returns a form error and plans nothing', async () => {
		const session = await setupUser()
		const menu = await prisma.menu.create({
			data: {
				title: 'Blank Slate',
				titleKey: menuTitleKey('Blank Slate'),
				householdId: session.householdId,
				sections: { create: { name: null, order: 0 } },
			},
			select: { id: true },
		})
		const response = (await planMenu(session, menu.id, {
			date: '2026-09-01',
		})) as {
			data?: { result?: { error?: unknown } }
			init?: { status: number }
		}
		expect(response).not.toBeInstanceOf(Response)
		expect(await prisma.meal.count({ where: { sourceMenuId: menu.id } })).toBe(
			0,
		)
	})

	test('rejects an invalid time and another household’s menu', async () => {
		const session = await setupUser()
		const { menu } = await seedHostedMenu(session, session.householdId)

		const badTime = await planMenu(session, menu.id, {
			date: '2026-09-01',
			time: '39:99',
			timeZone: 'Europe/Bucharest',
		})
		expect(badTime).not.toBeInstanceOf(Response)
		expect(await prisma.meal.count({ where: { sourceMenuId: menu.id } })).toBe(
			0,
		)

		const stranger = await setupUser()
		await expect(
			planMenu(stranger, menu.id, { date: '2026-09-01' }),
		).rejects.toThrow()
		expect(await prisma.meal.count({ where: { sourceMenuId: menu.id } })).toBe(
			0,
		)
	})

	test('a note-only snapshot Meal survives removing its last Recipe item', async () => {
		const session = await setupUser()
		const recipe = await createRecipe(session, session.householdId, 'Soup')
		const menu = await prisma.menu.create({
			data: {
				title: 'Small Evening',
				titleKey: menuTitleKey('Small Evening'),
				householdId: session.householdId,
				sections: {
					create: {
						name: null,
						order: 0,
						items: {
							create: [
								{
									kind: 'recipe',
									order: 0,
									recipeId: recipe.id,
									recipeTitle: 'Soup',
									scaleMultiplier: 1,
								},
								{ kind: 'note', order: 1, note: 'Light the candles' },
							],
						},
					},
				},
			},
			select: { id: true },
		})
		await planMenu(session, menu.id, { date: '2026-09-04' })
		const meal = await loadPlannedMeal(menu.id)
		const item = meal.recipeItems[0]!

		const result = await removeRecipeItem(prisma, {
			item: { id: item.id, mealId: meal.id },
		})
		expect(result.mealDeleted).toBe(false)
		const survivor = await loadPlannedMeal(menu.id)
		expect(survivor.recipeItems).toHaveLength(0)
		expect(survivor.noteItems.map((note) => note.text)).toEqual([
			'Light the candles',
		])
	})
})
