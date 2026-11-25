/**
 * What a full restore does with tiers, with data that doesn't land, and with
 * files that are too big.
 */
import { RouterContextProvider } from 'react-router'
import { describe, expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createSignedInHousehold } from '#tests/db-utils.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader as recipesLoader } from '../../recipes/index.tsx'
import { z } from 'zod'
import {
	boundedArray,
	RESTORE_LIMITS,
	RESTORE_MAX_FILE_BYTES,
} from './+export-format.ts'
import { action, RESTORE_JSON_LIMITS } from './import.tsx'
import '#tests/setup/db-setup.ts'

const posthog = vi.hoisted(() => ({
	captureServerEvent:
		vi.fn<
			(
				userId: string,
				event: string,
				properties?: Record<string, unknown>,
			) => void
		>(),
}))
vi.mock('#app/utils/posthog.server.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	captureServerEvent: posthog.captureServerEvent,
}))

const RESTORE_STOPPED =
	'The restore stopped partway. What it restored is kept. Import the same file again to finish.'

const ARGS_BASE = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/settings/profile/import',
	url: new URL(`${BASE_URL}/settings/profile/import`),
}
const IMPORT_URL = `${BASE_URL}/settings/profile/import`

async function setupUser({ tier = 'pro' as string | null } = {}) {
	return createSignedInHousehold({ name: 'Restore Household', tier })
}

type Session = Awaited<ReturnType<typeof setupUser>>

async function restoreText(session: Session, text: string | File) {
	const form = new FormData()
	form.set('importData', text)
	const request = new Request(IMPORT_URL, {
		method: 'POST',
		headers: { cookie: await getSessionCookieHeader(session) },
		body: form,
	})
	return action({ request, ...ARGS_BASE })
}

/** The action's answer, whether it came back plain or wrapped in `data()`. */
async function restore(session: Session, payload: unknown) {
	const result = (await restoreText(session, JSON.stringify(payload))) as any
	return {
		status: (result.init?.status as number | undefined) ?? 200,
		body: (result.data ?? result) as { error: string | null; results: any },
	}
}

function fullExport(sections: Record<string, unknown>) {
	return { format: 'quartermaster-full-export-v1', recipes: [], ...sections }
}

const WEEK = '2026-08-17T00:00:00.000Z'
const WEDNESDAY = '2026-08-19T00:00:00.000Z'

/** Each restored Meal's day and its plan's week, in day order. */
function storedMeals(session: Session) {
	return prisma.meal
		.findMany({
			where: { mealPlan: { householdId: session.householdId } },
			orderBy: { date: 'asc' },
			select: { date: true, mealPlan: { select: { weekStart: true } } },
		})
		.then((meals) =>
			meals.map((meal) => ({
				weekStart: meal.mealPlan.weekStart,
				date: meal.date,
			})),
		)
}

function countMeals(session: Session) {
	return prisma.meal.count({
		where: { mealPlan: { householdId: session.householdId } },
	})
}

describe('Plan and Shopping restore on every tier', () => {
	test('a Free user restores Meals and Shopping items from a full export', async () => {
		const session = await setupUser({ tier: null })
		const { body } = await restore(
			session,
			fullExport({
				mealPlans: [
					{
						weekStart: WEEK,
						meals: [{ date: WEDNESDAY, genericText: 'Leftovers' }],
					},
				],
				shoppingLists: [{ name: 'Shopping', items: [{ name: 'apples' }] }],
			}),
		)

		expect(body.results.meals).toEqual({ created: 1, skipped: 0, errored: 0 })
		expect(body.results.shoppingLists).toEqual({ created: 1, skipped: 0 })
		expect(await countMeals(session)).toBe(1)
		expect(
			await prisma.shoppingListItem.findMany({
				where: { list: { householdId: session.householdId } },
				select: { name: true },
			}),
		).toEqual([{ name: 'apples' }])
	})

	test('a Free Household with one Meal ticks "Plan a Meal" in Getting Started', async () => {
		const session = await setupUser({ tier: null })
		await prisma.mealPlan.create({
			data: {
				householdId: session.householdId,
				weekStart: new Date(WEEK),
				meals: {
					create: { date: new Date(WEDNESDAY), order: 0, genericText: 'Soup' },
				},
			},
		})

		const result = await recipesLoader({
			request: new Request(`${BASE_URL}/recipes`, {
				headers: { cookie: await getSessionCookieHeader(session) },
			}),
			...ARGS_BASE,
			pattern: '/recipes',
			url: new URL(`${BASE_URL}/recipes`),
		})
		expect(result.onboarding.hasMealPlan).toBe(true)
	})
})

// Skipped means already there. Anything else that didn't land counts as
// failed.
describe('skipped and failed', () => {
	test('a Recipe the Household already has is still skipped, not failed', async () => {
		const session = await setupUser()
		await prisma.recipe.create({
			data: {
				title: 'Kofta',
				userId: session.userId,
				householdId: session.householdId,
			},
		})
		const { body } = await restore(session, {
			recipeCount: 1,
			recipes: [{ title: 'kofta', ingredients: [], instructions: [] }],
		})
		expect(body.results.recipes).toEqual({ created: 0, skipped: 1, errored: 0 })
	})

	test('a Meal already in the Plan is skipped on a second restore', async () => {
		const session = await setupUser()
		const file = fullExport({
			mealPlans: [
				{
					weekStart: WEEK,
					meals: [{ date: WEDNESDAY, genericText: 'Leftovers' }],
				},
			],
		})
		await restore(session, file)
		const { body } = await restore(session, file)
		expect(body.results.meals).toEqual({ created: 0, skipped: 1, errored: 0 })
		expect(await countMeals(session)).toBe(1)
	})

	test('a card whose Recipe is missing from the file restores as a missing card when it has a title', async () => {
		const session = await setupUser()
		const { body } = await restore(
			session,
			fullExport({
				mealPlans: [
					{
						weekStart: WEEK,
						meals: [
							{
								date: WEDNESDAY,
								items: [{ recipeRef: 'gone', recipeTitle: 'Gone Cake' }],
							},
						],
					},
				],
			}),
		)
		expect(body.results.meals).toEqual({ created: 1, skipped: 0, errored: 0 })
		expect(
			await prisma.mealRecipeItem.findMany({
				where: { meal: { mealPlan: { householdId: session.householdId } } },
				select: { recipeId: true, recipeTitle: true },
			}),
		).toEqual([{ recipeId: null, recipeTitle: 'Gone Cake' }])
	})

	test('a Meal left with nothing to restore counts as failed', async () => {
		// Each failure is logged; the logging test checks what the lines say.
		consoleError.mockImplementation(() => {})
		const session = await setupUser()
		const { body } = await restore(
			session,
			fullExport({
				mealPlans: [
					{
						weekStart: WEEK,
						meals: [
							// No title to keep and no Recipe in the file to point at.
							{ date: WEDNESDAY, items: [{ recipeRef: 'gone' }] },
							{ date: WEDNESDAY, genericText: 'Leftovers' },
						],
					},
				],
			}),
		)
		expect(body.results.meals).toEqual({ created: 1, skipped: 0, errored: 1 })
		expect(await countMeals(session)).toBe(1)
	})

	test('a Meal whose Recipe is deleted while the restore runs counts as failed, and the rest of its week restores', async () => {
		// Each failure is logged; the logging test checks what the lines say.
		consoleError.mockImplementation(() => {})
		const session = await setupUser()
		await prisma.recipe.create({
			data: {
				title: 'Kofta',
				userId: session.userId,
				householdId: session.householdId,
			},
		})
		// The Recipe goes as soon as the restore creates the week's plan, after
		// the file's Kofta has been matched to it.
		await prisma.$executeRawUnsafe(
			`CREATE TRIGGER restore_test_delete_recipe AFTER INSERT ON "MealPlan"
			BEGIN DELETE FROM "Recipe" WHERE "title" = 'Kofta'; END`,
		)
		const { body } = await restore(
			session,
			fullExport({
				recipes: [
					{ ref: 'r1', title: 'Kofta', ingredients: [], instructions: [] },
				],
				mealPlans: [
					{
						weekStart: WEEK,
						meals: [
							{
								date: WEDNESDAY,
								items: [{ recipeRef: 'r1', recipeTitle: 'Kofta' }],
							},
							{ date: WEDNESDAY, genericText: 'Leftovers' },
						],
					},
				],
			}),
		)
		expect(body.results.recipes).toEqual({ created: 0, skipped: 1, errored: 0 })
		expect(body.results.meals).toEqual({ created: 1, skipped: 0, errored: 1 })
		expect(
			await prisma.meal.findMany({
				where: { mealPlan: { householdId: session.householdId } },
				select: { genericText: true },
			}),
		).toEqual([{ genericText: 'Leftovers' }])
	})

	test('a Meal with an unreadable date counts as failed', async () => {
		// Each failure is logged; the logging test checks what the lines say.
		consoleError.mockImplementation(() => {})
		const session = await setupUser()
		const { body } = await restore(
			session,
			fullExport({
				mealPlans: [
					{
						weekStart: WEEK,
						meals: [
							{ date: 'next Wednesday', genericText: 'Soup' },
							{ date: WEDNESDAY, genericText: 'Leftovers' },
						],
					},
				],
			}),
		)
		expect(body.results.meals).toEqual({ created: 1, skipped: 0, errored: 1 })
	})

	test('a plan with an unreadable weekStart counts its Meals as failed, and other weeks still restore', async () => {
		// Each failure is logged; the logging test checks what the lines say.
		consoleError.mockImplementation(() => {})
		const session = await setupUser()
		const { body } = await restore(
			session,
			fullExport({
				mealPlans: [
					{
						weekStart: 'not a week',
						meals: [
							{ date: WEDNESDAY, genericText: 'Soup' },
							{ date: WEDNESDAY, genericText: 'Stew' },
						],
					},
					{
						weekStart: WEEK,
						meals: [{ date: WEDNESDAY, genericText: 'Leftovers' }],
					},
				],
			}),
		)
		expect(body.results.meals).toEqual({ created: 1, skipped: 0, errored: 2 })
		expect(await countMeals(session)).toBe(1)
	})

	// A Plan shows a Meal on its stored UTC-midnight day, in the plan whose Monday
	// starts that week.
	test('a weekStart on a Wednesday restores into the week that Wednesday is in', async () => {
		const session = await setupUser()
		const { body } = await restore(
			session,
			fullExport({
				mealPlans: [
					{
						weekStart: WEDNESDAY,
						meals: [{ date: WEDNESDAY, genericText: 'Leftovers' }],
					},
				],
			}),
		)
		expect(body.results.meals).toEqual({ created: 1, skipped: 0, errored: 0 })
		expect(await storedMeals(session)).toEqual([
			{ weekStart: new Date(WEEK), date: new Date(WEDNESDAY) },
		])
	})

	test('a Meal date with an offset restores on the day it names', async () => {
		const session = await setupUser()
		const { body } = await restore(
			session,
			fullExport({
				mealPlans: [
					{
						weekStart: '2026-08-17T00:00:00+09:00',
						meals: [
							{ date: '2026-08-19T00:00:00+09:00', genericText: 'Soup' },
							{ date: '2026-08-20', genericText: 'Stew' },
						],
					},
				],
			}),
		)
		expect(body.results.meals).toEqual({ created: 2, skipped: 0, errored: 0 })
		expect(await storedMeals(session)).toEqual([
			{ weekStart: new Date(WEEK), date: new Date(WEDNESDAY) },
			{ weekStart: new Date(WEEK), date: new Date('2026-08-20') },
		])
	})

	test('a day with junk after it, or outside its week, counts as failed, each for its own reason', async () => {
		// Each failure is logged; the logging test checks what the lines say.
		consoleError.mockImplementation(() => {})
		posthog.captureServerEvent.mockClear()
		const session = await setupUser()
		const { body } = await restore(
			session,
			fullExport({
				mealPlans: [
					{
						weekStart: '2026-08-17 and then some',
						meals: [{ date: WEDNESDAY, genericText: 'Soup' }],
					},
					{
						weekStart: WEEK,
						meals: [
							{ date: '2026-08-19junk', genericText: 'Stew' },
							{ date: '2026-08-24T00:00:00.000Z', genericText: 'Next week' },
							{ date: '2026-08-16T00:00:00.000Z', genericText: 'Last week' },
							{ date: WEDNESDAY, genericText: 'Leftovers' },
						],
					},
				],
			}),
		)
		expect(body.results.meals).toEqual({ created: 1, skipped: 0, errored: 4 })
		expect(await storedMeals(session)).toEqual([
			{ weekStart: new Date(WEEK), date: new Date(WEDNESDAY) },
		])
		expect(posthog.captureServerEvent.mock.calls[0]![2]).toMatchObject({
			failures: [
				{ at: 'mealPlans[0]', reason: 'invalid-week', count: 1 },
				{ at: 'mealPlans[1].meals[0]', reason: 'invalid-date' },
				{ at: 'mealPlans[1].meals[1]', reason: 'outside-week' },
				{ at: 'mealPlans[1].meals[2]', reason: 'outside-week' },
			],
		})
	})

	test('two plans whose weeks start on the same Monday restore a shared Meal once', async () => {
		const session = await setupUser()
		const meal = { date: WEDNESDAY, genericText: 'Leftovers' }
		const { body } = await restore(
			session,
			fullExport({
				mealPlans: [
					{ weekStart: WEEK, meals: [meal] },
					{ weekStart: '2026-08-21', meals: [meal] },
				],
			}),
		)
		expect(body.results.meals).toEqual({ created: 1, skipped: 1, errored: 0 })
		expect(await storedMeals(session)).toEqual([
			{ weekStart: new Date(WEEK), date: new Date(WEDNESDAY) },
		])
	})

	test('a fixed-slot entry with an offset date restores on the day it names', async () => {
		const session = await setupUser()
		const { body } = await restore(
			session,
			fullExport({
				recipes: [{ title: 'Kofta', ingredients: [], instructions: [] }],
				mealPlans: [
					{
						weekStart: WEEK,
						entries: [
							{
								date: '2026-08-19T00:00:00+09:00',
								mealType: 'dinner',
								recipe: 'Kofta',
							},
						],
					},
				],
			}),
		)
		expect(body.results.meals).toEqual({ created: 1, skipped: 0, errored: 0 })
		expect(await storedMeals(session)).toEqual([
			{ weekStart: new Date(WEEK), date: new Date(WEDNESDAY) },
		])
	})

	test('a fixed-slot entry whose Recipe is not in the file counts as a failed Plan entry', async () => {
		// Each failure is logged; the logging test checks what the lines say.
		consoleError.mockImplementation(() => {})
		const session = await setupUser()
		const { body } = await restore(
			session,
			fullExport({
				recipes: [{ title: 'Kofta', ingredients: [], instructions: [] }],
				mealPlans: [
					{
						weekStart: WEEK,
						entries: [
							{ date: WEDNESDAY, mealType: 'dinner', recipe: 'Kofta' },
							{ date: WEDNESDAY, mealType: 'lunch', recipe: 'Ghost' },
							{ date: 'someday', mealType: 'lunch', recipe: 'Kofta' },
						],
					},
				],
			}),
		)
		expect(body.results.mealPlans).toEqual({
			created: 0,
			skipped: 0,
			errored: 2,
		})
		expect(body.results.meals).toEqual({ created: 1, skipped: 0, errored: 0 })
	})

	test('a malformed Shopping item refuses the file, says where, and writes nothing', async () => {
		const session = await setupUser()
		const { status, body } = await restore(
			session,
			fullExport({
				recipes: [{ title: 'Kofta', ingredients: [], instructions: [] }],
				shoppingLists: [
					{ name: 'Shopping', items: [{ name: 'apples' }, { quantity: '2' }] },
				],
			}),
		)
		expect(status).toBe(400)
		expect(body.error).toBe(
			'Item 2 on Shopping has no name (at shoppingLists.0.items.1.name).',
		)
		expect(
			await prisma.recipe.count({
				where: { householdId: session.householdId },
			}),
		).toBe(0)
	})

	test.each([
		{
			recipe: { ingredients: [], instructions: [] },
			error: 'Recipe 1 has no title (at recipes.0.title).',
		},
		{
			recipe: { title: 'Soup', ingredients: [{}], instructions: [] },
			error:
				'Ingredient 1 of Recipe 1 has no name (at recipes.0.ingredients.0.name).',
		},
		{
			recipe: { title: 'Soup', ingredients: [], instructions: [7] },
			error:
				'Step 1 of Recipe 1 isn’t in the format Quartermaster exports (at recipes.0.instructions.0).',
		},
	])(
		'a malformed Recipe is named in words: $error',
		async ({ recipe, error }) => {
			const session = await setupUser()
			const { status, body } = await restore(session, {
				recipeCount: 1,
				recipes: [recipe],
			})
			expect(status).toBe(400)
			expect(body.error).toBe(error)
		},
	)

	test('an unexpected database error stops the restore with a reply the page can show, and a second run finishes it without duplicates', async () => {
		consoleError.mockImplementation(() => {})
		const session = await setupUser()
		const file = fullExport({
			recipes: [{ title: 'Kofta', ingredients: [], instructions: [] }],
			mealPlans: [
				{
					weekStart: WEEK,
					meals: [
						{ date: WEDNESDAY, genericText: 'Soup' },
						{ date: WEDNESDAY, genericText: 'Stew' },
					],
				},
			],
			shoppingLists: [{ name: 'Shopping', items: [{ name: 'apples' }] }],
		})
		// A trigger makes the second Meal's insert fail with a runtime SQL
		// error, the way a database fault would: not a constraint the restore
		// expects.
		await prisma.$executeRawUnsafe(
			`CREATE TRIGGER restore_test_fault BEFORE INSERT ON "Meal"
			WHEN NEW."genericText" = 'Stew'
			BEGIN SELECT abs(-9223372036854775808); END`,
		)

		const stopped = await restore(session, file)
		expect(stopped).toEqual({
			status: 500,
			body: { error: RESTORE_STOPPED, results: null },
		})
		expect(posthog.captureServerEvent).toHaveBeenCalledWith(
			session.userId,
			'server_error',
			expect.objectContaining({
				operation: 'restore',
				errorName: 'DriverAdapterError',
				stack: expect.stringMatching(/^\s*at /),
			}),
		)
		// The message can quote the user's values, so it stays out.
		expect(JSON.stringify(posthog.captureServerEvent.mock.calls)).not.toMatch(
			/integer overflow/,
		)
		expect(await countMeals(session)).toBe(1)
		expect(
			await prisma.shoppingListItem.count({
				where: { list: { householdId: session.householdId } },
			}),
		).toBe(0)

		await prisma.$executeRawUnsafe(`DROP TRIGGER restore_test_fault`)
		const { body } = await restore(session, file)
		expect(body.results.recipes).toEqual({ created: 0, skipped: 1, errored: 0 })
		expect(body.results.meals).toEqual({ created: 1, skipped: 1, errored: 0 })
		expect(body.results.shoppingLists).toEqual({ created: 1, skipped: 0 })
		expect(await countMeals(session)).toBe(2)
	})

	test.each([
		{
			section: 'Recipe',
			table: 'Recipe',
			when: `NEW."title" = 'Boom'`,
			file: fullExport({
				recipes: [{ title: 'Boom', ingredients: [], instructions: [] }],
			}),
		},
		{
			section: 'Menu',
			table: 'Menu',
			when: `NEW."title" = 'Boom'`,
			file: fullExport({ menus: [{ title: 'Boom' }] }),
		},
		{
			section: 'Shopping',
			table: 'ShoppingListItem',
			when: `NEW."name" = 'boom'`,
			file: fullExport({
				shoppingLists: [{ name: 'Shopping', items: [{ name: 'boom' }] }],
			}),
		},
	])(
		'an unexpected database error in the $section step stops the restore',
		async ({ table, when, file }) => {
			consoleError.mockImplementation(() => {})
			const session = await setupUser()
			await prisma.$executeRawUnsafe(
				`CREATE TRIGGER restore_test_fault BEFORE INSERT ON "${table}"
				WHEN ${when} BEGIN SELECT abs(-9223372036854775808); END`,
			)
			expect(await restore(session, file)).toEqual({
				status: 500,
				body: { error: RESTORE_STOPPED, results: null },
			})
		},
	)

	test('Recipes saved before an unexpected error keep their sub-Recipe links after a rerun', async () => {
		consoleError.mockImplementation(() => {})
		const session = await setupUser()
		const file = fullExport({
			recipes: [
				{
					title: 'Alpha',
					ingredients: [{ name: 'beta sauce', linkedRecipeRef: 'beta' }],
					instructions: [],
				},
				{ ref: 'beta', title: 'Beta', ingredients: [], instructions: [] },
				{ title: 'Gamma', ingredients: [], instructions: [] },
			],
		})
		await prisma.$executeRawUnsafe(
			`CREATE TRIGGER restore_test_fault BEFORE INSERT ON "Recipe"
			WHEN NEW."title" = 'Gamma' BEGIN SELECT abs(-9223372036854775808); END`,
		)
		expect((await restore(session, file)).status).toBe(500)
		await prisma.$executeRawUnsafe(`DROP TRIGGER restore_test_fault`)

		const { body } = await restore(session, file)
		expect(body.results.recipes).toEqual({ created: 1, skipped: 2, errored: 0 })
		const beta = await prisma.recipe.findFirstOrThrow({
			where: { householdId: session.householdId, title: 'Beta' },
			select: { id: true },
		})
		expect(
			await prisma.ingredient.findMany({
				where: { recipe: { householdId: session.householdId, title: 'Alpha' } },
				select: { linkedRecipeId: true },
			}),
		).toEqual([{ linkedRecipeId: beta.id }])
	})

	test('a Meal deleted before its Shopping links are written loses only its links', async () => {
		consoleError.mockImplementation(() => {})
		const session = await setupUser()
		const link = (ref: string) => ({
			sourceMealRef: ref,
			orphaned: false,
			fingerprint: {
				canonicalName: `leeks ${ref}`,
				name: 'leeks',
				quantity: null,
				unit: null,
			},
		})
		// The Soup Meal goes once the Shopping items are in, after the Plan pass
		// restored it and before the links to it are written.
		await prisma.$executeRawUnsafe(
			`CREATE TRIGGER restore_test_delete_meal AFTER INSERT ON "ShoppingListItem"
			BEGIN DELETE FROM "Meal" WHERE "genericText" = 'Soup'; END`,
		)
		const { status, body } = await restore(
			session,
			fullExport({
				mealPlans: [
					{
						weekStart: WEEK,
						meals: [
							{ ref: 'm1', date: WEDNESDAY, genericText: 'Soup' },
							{ ref: 'm2', date: WEDNESDAY, genericText: 'Stew' },
						],
					},
				],
				shoppingLists: [
					{
						name: 'Shopping',
						items: [
							{ name: 'leeks', mealContributions: [link('m1'), link('m2')] },
						],
					},
				],
			}),
		)
		expect(status).toBe(200)
		expect(body.results.shoppingLists).toEqual({ created: 1, skipped: 0 })
		expect(
			await prisma.mealShoppingContribution.findMany({
				where: { item: { list: { householdId: session.householdId } } },
				select: {
					canonicalName: true,
					meal: { select: { genericText: true } },
				},
			}),
		).toEqual([{ canonicalName: 'leeks m2', meal: { genericText: 'Stew' } }])
		expect(
			consoleError.mock.calls.some((call) =>
				JSON.stringify(call).includes('meal-gone'),
			),
		).toBe(true)
	})

	test('each failure is logged with where it was, never with what the user wrote', async () => {
		const session = await setupUser()
		posthog.captureServerEvent.mockClear()
		consoleError.mockImplementation(() => {})
		await restore(
			session,
			fullExport({
				mealPlans: [
					{
						weekStart: 'not a week',
						meals: [{ date: WEDNESDAY, genericText: 'Secret soup' }],
					},
					{
						weekStart: WEEK,
						meals: [{ date: 'someday', genericText: 'Secret stew' }],
					},
				],
			}),
		)
		const lines = consoleError.mock.calls.map((call) =>
			call.map((arg) => JSON.stringify(arg) ?? String(arg)).join(' '),
		)
		expect(lines).toHaveLength(2)
		expect(lines[0]).toContain('mealPlans[0]')
		expect(lines[0]).toContain('invalid-week')
		expect(lines[1]).toContain('mealPlans[1].meals[0]')
		expect(lines[1]).toContain('invalid-date')
		expect(lines.join('\n')).not.toMatch(/Secret/)

		// Analytics gets the same, under its own event: a user's bad file isn't
		// a server error.
		const events = posthog.captureServerEvent.mock.calls
		expect(events.map(([, event]) => event)).toEqual(['restore_failed_items'])
		expect(events[0]![0]).toBe(session.userId)
		expect(events[0]![2]).toMatchObject({
			failureCount: 2,
			failures: [
				{ at: 'mealPlans[0]', reason: 'invalid-week', count: 1 },
				{ at: 'mealPlans[1].meals[0]', reason: 'invalid-date' },
			],
		})
		expect(JSON.stringify(events)).not.toMatch(/Secret/)
	})
})

describe('size and count limits', () => {
	async function streamedRequest(
		session: Session,
		bytes: number,
		headers: Record<string, string> = {},
	) {
		const chunk = new TextEncoder().encode(' '.repeat(64 * 1024))
		let sent = 0
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (sent >= bytes) return controller.close()
				controller.enqueue(chunk)
				sent += chunk.byteLength
			},
		})
		const request = new Request(IMPORT_URL, {
			method: 'POST',
			headers: {
				cookie: await getSessionCookieHeader(session),
				'Content-Type': 'multipart/form-data; boundary=restore-test',
				...headers,
			},
			body,
			// @ts-expect-error Node needs this for a streamed request body.
			duplex: 'half',
		})
		return { request, sentBytes: () => sent }
	}

	test('a body over the cap with no Content-Length is refused while it is read', async () => {
		const session = await setupUser()
		const { request, sentBytes } = await streamedRequest(
			session,
			RESTORE_MAX_FILE_BYTES * 3,
		)
		const result = (await action({ request, ...ARGS_BASE })) as any
		expect(result.init.status).toBe(413)
		expect(result.data.error).toMatch(/too big/i)
		expect(sentBytes()).toBeLessThan(RESTORE_MAX_FILE_BYTES * 2)
	})

	test('a body that declares a Content-Length over the cap is refused before it is read', async () => {
		const session = await setupUser()
		const { request, sentBytes } = await streamedRequest(
			session,
			RESTORE_MAX_FILE_BYTES * 3,
			{ 'Content-Length': String(RESTORE_MAX_FILE_BYTES * 3) },
		)
		const result = (await action({ request, ...ARGS_BASE })) as any
		expect(result.init.status).toBe(413)
		expect(sentBytes()).toBeLessThan(1024 * 1024)
	})

	test('a file over the cap is refused, even inside a well-formed form', async () => {
		const session = await setupUser()
		const text =
			JSON.stringify({ recipeCount: 0, recipes: [] }) +
			' '.repeat(RESTORE_MAX_FILE_BYTES)
		const result = (await restoreText(session, text)) as any
		expect(result.init.status).toBe(413)
		expect(result.data.error).toMatch(/too big/i)
	})

	test('a urlencoded body is refused, so the cap has no way around it', async () => {
		const session = await setupUser()
		const request = new Request(IMPORT_URL, {
			method: 'POST',
			headers: {
				cookie: await getSessionCookieHeader(session),
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				importData: JSON.stringify({ recipeCount: 0, recipes: [] }),
			}).toString(),
		})
		const result = (await action({ request, ...ARGS_BASE })) as any
		expect(result.init.status).toBe(400)
		// Only a tab on the page from before the form sent multipart posts this.
		expect(result.data.error).toContain('Reload the page and try again.')
	})

	test('a file right at the cap, full of line breaks, is taken whole when sent as the file itself', async () => {
		const session = await setupUser()
		const head = JSON.stringify({ recipeCount: 0, recipes: [] })
		const text = head + '\n'.repeat(RESTORE_MAX_FILE_BYTES - head.length)
		const result = (await restoreText(
			session,
			new File([text], 'export.json', { type: 'application/json' }),
		)) as any
		expect(result.error).toBeNull()
		expect(result.results.recipes).toEqual({
			created: 0,
			skipped: 0,
			errored: 0,
		})
	})

	test.each([
		{
			shape: 'nesting',
			extra:
				'['.repeat(RESTORE_JSON_LIMITS.depth + 1) +
				']'.repeat(RESTORE_JSON_LIMITS.depth + 1),
		},
		{
			shape: 'arrays',
			extra: `[${Array(RESTORE_JSON_LIMITS.containers).fill('[]').join(',')}]`,
		},
		{
			shape: 'values',
			extra: `[${Array(RESTORE_JSON_LIMITS.separators + 2)
				.fill('0')
				.join(',')}]`,
		},
	])(
		'a file with more $shape than any export is refused before it is parsed',
		async ({ extra }) => {
			const session = await setupUser()
			const parse = vi.spyOn(JSON, 'parse')
			try {
				const result = (await restoreText(
					session,
					`{"recipeCount":0,"recipes":[],"padding":${extra}}`,
				)) as any
				expect(result.init.status).toBe(400)
				expect(result.data.error).toMatch(/more than a Quartermaster export/)
				expect(
					parse.mock.calls.filter(([text]) => String(text).includes('padding')),
				).toEqual([])
			} finally {
				parse.mockRestore()
			}
		},
	)

	test.each([
		{ text: `a " ${'['.repeat(20)} " b` },
		// A text ending in a backslash: its closing quote still closes it.
		{ text: 'ends in a backslash \\', after: '['.repeat(20) },
	])(
		'escaped quotes and backslashes keep brackets inside their text: %j',
		async ({ text, after }) => {
			const session = await setupUser()
			const { status, body } = await restore(session, {
				recipeCount: 1,
				recipes: [
					{
						title: 'Escapes',
						description: text,
						notes: after ?? null,
						ingredients: [],
						instructions: [],
					},
				],
			})
			expect(status).toBe(200)
			expect(body.results.recipes).toEqual({
				created: 1,
				skipped: 0,
				errored: 0,
			})
		},
	)

	test('brackets and quotes inside text are not counted as structure', async () => {
		const session = await setupUser()
		const tricky = `${'['.repeat(40)} "quoted" \\ ${'{'.repeat(40)}`
		const { body } = await restore(session, {
			recipeCount: 1,
			recipes: [
				{
					title: 'Brackets',
					description: tricky,
					ingredients: [],
					instructions: [],
				},
			],
		})
		expect(body.results.recipes).toEqual({ created: 1, skipped: 0, errored: 0 })
		expect(
			await prisma.recipe.findFirstOrThrow({
				where: { householdId: session.householdId },
				select: { description: true },
			}),
		).toEqual({ description: tricky })
	})

	test('a second restore while one is running is told to wait, and the next one runs', async () => {
		const session = await setupUser()
		const file = { recipeCount: 0, recipes: [] }
		let release!: () => void
		const held = new Promise<void>((resolve) => (release = resolve))
		const findMany = prisma.recipe.findMany.bind(prisma.recipe)
		const spy = vi
			.spyOn(prisma.recipe, 'findMany')
			.mockImplementationOnce((async (...args: any[]) => {
				await held
				return (findMany as any)(...args)
			}) as any)
		const first = restore(session, file)
		try {
			await vi.waitFor(() => expect(spy).toHaveBeenCalled())

			// The second request is turned away before its body is read.
			let pulls = 0
			const body = new ReadableStream<Uint8Array>(
				{
					pull(controller) {
						pulls++
						controller.close()
					},
				},
				{ highWaterMark: 0 },
			)
			const second = (await action({
				request: new Request(IMPORT_URL, {
					method: 'POST',
					headers: {
						cookie: await getSessionCookieHeader(session),
						'Content-Type': 'multipart/form-data; boundary=restore-test',
					},
					body,
					// @ts-expect-error Node needs this for a streamed request body.
					duplex: 'half',
				}),
				...ARGS_BASE,
			})) as any
			expect(second.init.status).toBe(409)
			expect(second.data.error).toBe(
				'Another restore is running. Try again in a minute.',
			)
			expect(pulls).toBe(0)

			release()
			expect((await first).status).toBe(200)
			expect((await restore(session, file)).status).toBe(200)
		} finally {
			// Let the first restore finish even when an assertion failed, so the
			// lock doesn't outlive this test.
			release()
			await first.catch(() => {})
			spy.mockRestore()
		}
	})

	test('a small file of many empty Recipes is refused on its count, before the schema looks at them', async () => {
		const session = await setupUser()
		const count = RESTORE_JSON_LIMITS.containers - 10
		const text = `{"recipeCount":0,"recipes":[${Array(count).fill('{}').join(',')}]}`
		const result = (await restoreText(session, text)) as any
		expect(result.init.status).toBe(400)
		// Only the count check before the schema writes this; the schema would
		// complain about a Recipe with no title.
		expect(result.data.error).toBe(
			`This file has ${count.toLocaleString('en-US')} Recipes. A restore takes up to 500.`,
		)
	})

	test('a list within its limit stops at its first bad element', () => {
		const item = z.object({ name: z.string() })
		const bad = Array(1000).fill({})
		expect(z.array(item).safeParse(bad).error!.issues).toHaveLength(1000)
		const result = boundedArray(item, 1000).safeParse(bad)
		expect(result.error!.issues).toHaveLength(1)
		expect(result.error!.issues[0]!.path).toEqual([0, 'name'])
		expect(boundedArray(item, 2).safeParse(bad).error!.issues).toHaveLength(1)
	})

	test('a file with more Meals than a restore takes is refused, naming the limit, with nothing written', async () => {
		const session = await setupUser()
		const perPlan = 200
		const plans = Math.ceil((RESTORE_LIMITS.meals + 1) / perPlan)
		const { status, body } = await restore(
			session,
			fullExport({
				recipes: [{ title: 'Kofta', ingredients: [], instructions: [] }],
				mealPlans: Array.from({ length: plans }, (_, week) => ({
					weekStart: new Date(Date.UTC(2020, 0, 6 + week * 7)).toISOString(),
					meals: Array.from({ length: perPlan }, () => ({
						date: WEDNESDAY,
						genericText: 'x',
					})),
				})),
			}),
		)
		expect(status).toBe(400)
		expect(body.error).toContain(RESTORE_LIMITS.meals.toLocaleString('en-US'))
		expect(body.error).toMatch(/Meals/)
		expect(
			await prisma.recipe.count({
				where: { householdId: session.householdId },
			}),
		).toBe(0)
	})

	const contribution = {
		sourceMealRef: null,
		orphaned: true,
		fingerprint: { canonicalName: 'a', name: 'a', quantity: null, unit: null },
	}
	const chunks = <T>(all: T[], size: number) =>
		Array.from({ length: Math.ceil(all.length / size) }, (_, i) =>
			all.slice(i * size, (i + 1) * size),
		)
	test.each([
		{
			cap: 'recipeLines' as const,
			label: /Recipe ingredients and steps/,
			file: () => ({
				recipeCount: 1,
				recipes: chunks(
					Array(RESTORE_LIMITS.recipeLines + 1).fill('a'),
					200,
				).map((instructions, i) => ({
					title: `R${i}`,
					ingredients: [],
					instructions,
				})),
			}),
		},
		{
			cap: 'menuCards' as const,
			label: /cards on Menus/,
			file: () =>
				fullExport({
					menus: chunks(
						chunks(Array(RESTORE_LIMITS.menuCards + 1).fill({}), 100).map(
							(items) => ({ name: 'Course', items }),
						),
						20,
					).map((sections, i) => ({ title: `Menu ${i}`, sections })),
				}),
		},
		{
			cap: 'meals' as const,
			label: /Meals/,
			file: () =>
				fullExport({
					mealPlans: chunks(
						Array(RESTORE_LIMITS.meals + 1).fill({ date: WEDNESDAY }),
						200,
					).map((meals) => ({ weekStart: WEEK, meals })),
				}),
		},
		{
			cap: 'mealCards' as const,
			label: /cards on Meals/,
			file: () =>
				fullExport({
					mealPlans: chunks(
						chunks(Array(RESTORE_LIMITS.mealCards + 1).fill({}), 100).map(
							(items) => ({ date: WEDNESDAY, items }),
						),
						200,
					).map((meals) => ({ weekStart: WEEK, meals })),
				}),
		},
		{
			cap: 'shoppingItems' as const,
			label: /Shopping items/,
			file: () =>
				fullExport({
					shoppingLists: chunks(
						Array(RESTORE_LIMITS.shoppingItems + 1).fill({ name: 'a' }),
						500,
					).map((items) => ({ name: 'Shopping', items })),
				}),
		},
		{
			cap: 'shoppingMealLinks' as const,
			label: /Meal links on Shopping items/,
			file: () =>
				fullExport({
					shoppingLists: [
						{
							name: 'Shopping',
							items: chunks(
								Array(RESTORE_LIMITS.shoppingMealLinks + 1).fill(contribution),
								500,
							).map((mealContributions, i) => ({
								name: `item ${i}`,
								mealContributions,
							})),
						},
					],
				}),
		},
	])(
		'a file one over the $cap total is refused, naming the limit',
		async ({ cap, label, file }) => {
			const session = await setupUser()
			const { status, body } = await restore(session, file())
			expect(status).toBe(400)
			expect(body.error).toContain(
				`A restore takes up to ${RESTORE_LIMITS[cap].toLocaleString('en-US')}.`,
			)
			expect(body.error).toMatch(label)
		},
	)

	test('a plan that carries both Meals and their mirrored entries counts its Meals once', async () => {
		// Every Meal here has nothing to restore, so the restore is quick and
		// logs each one as a failure.
		consoleError.mockImplementation(() => {})
		const session = await setupUser()
		const perPlan = 100
		const plans = Math.ceil((RESTORE_LIMITS.meals / perPlan) * 0.6)
		const { status, body } = await restore(
			session,
			fullExport({
				mealPlans: Array.from({ length: plans }, () => ({
					weekStart: WEEK,
					meals: Array(perPlan).fill({ date: WEDNESDAY }),
					entries: Array(perPlan).fill({
						date: WEDNESDAY,
						mealType: 'dinner',
						recipe: 'Ghost',
					}),
				})),
			}),
		)
		expect(status).toBe(200)
		expect(body.results.meals.errored).toBe(plans * perPlan)
	})

	test('Shopping items right at the cap restore, and one more is refused', async () => {
		const session = await setupUser()
		const items = (count: number) =>
			Array.from({ length: count }, (_, i) => ({ name: `item ${i}` }))
		const lists = (count: number) => {
			const all = items(count)
			const out = []
			for (let i = 0; i < all.length; i += 500) {
				out.push({ name: 'Shopping', items: all.slice(i, i + 500) })
			}
			return out
		}

		const over = await restore(
			session,
			fullExport({ shoppingLists: lists(RESTORE_LIMITS.shoppingItems + 1) }),
		)
		expect(over.status).toBe(400)
		expect(over.body.error).toMatch(/Shopping items/)

		const atCap = await restore(
			session,
			fullExport({ shoppingLists: lists(RESTORE_LIMITS.shoppingItems) }),
		)
		expect(atCap.body.results.shoppingLists.created).toBe(
			RESTORE_LIMITS.shoppingItems,
		)
	})
})
