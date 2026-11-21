/**
 * What a full restore does with tiers, with data that doesn't land, and with
 * files that are too big. Failure list:
 *
 * Tiers (Plan and Shopping are free features)
 * - A Free user's full restore skips the Plan and Shopping sections.
 * - A Free Household with one Meal never ticks "Plan a Meal" in Getting
 *   Started.
 *
 * Skipped means "already there"; anything else that didn't land is a failure
 * - A Recipe the Household already has gets counted as failed instead of
 *   skipped.
 * - A Meal already in the Plan gets counted as failed on a second restore.
 * - A Meal card with a title but an unknown ref (a missing Recipe card, kept
 *   on purpose) gets counted as failed.
 * - A Meal whose only card has neither a title nor a known ref vanishes as
 *   "skipped".
 * - A Meal whose Recipe is deleted while the restore runs vanishes as
 *   "skipped", or takes the rest of its week down with it.
 * - A Meal with an unreadable date vanishes as "skipped".
 * - A plan with an unreadable weekStart drops all its Meals uncounted while
 *   the result still reads as a success.
 * - A pre-#104 entry whose Recipe isn't in the file vanishes as "skipped".
 * - A malformed Shopping item drops the whole Shopping section uncounted, or
 *   leaves Recipes half-restored.
 * - A database error that isn't one of the expected write failures is
 *   swallowed and the restore reports success, and a second run then
 *   duplicates what the first one saved.
 * - A failure is logged with the user's own text in it, or isn't logged.
 *
 * Size and count limits
 * - A body over the cap is read whole before anything checks its size, when
 *   it declares no Content-Length.
 * - A body that declares a Content-Length over the cap is read at all.
 * - A urlencoded body skips the cap that applies to the form's own encoding.
 * - A file within every per-list limit still carries thousands of Meals or
 *   Shopping items and keeps the server writing for minutes.
 * - A file right at a count cap gets refused.
 */
import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader as recipesLoader } from '../../recipes/index.tsx'
import { action, RESTORE_LIMITS, RESTORE_MAX_FILE_BYTES } from './import.tsx'
import '#tests/setup/db-setup.ts'

const ARGS_BASE = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/settings/profile/import',
	url: new URL(`${BASE_URL}/settings/profile/import`),
}
const IMPORT_URL = `${BASE_URL}/settings/profile/import`

async function setupUser({ tier = 'pro' as string | null } = {}) {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: {
					create: {
						...createUser(),
						...(tier ? { subscription: { create: { tier } } } : {}),
					},
				},
			},
			select: { id: true, userId: true },
		})
		const household = await tx.household.create({
			data: {
				name: 'Restore Household',
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		return { ...session, householdId: household.id }
	})
}

type Session = Awaited<ReturnType<typeof setupUser>>

async function restoreText(session: Session, text: string) {
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

	test('a pre-#104 entry whose Recipe is not in the file counts as a failed Plan entry', async () => {
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
		expect(body.error).toContain('shoppingLists.0.items.1.name')
		expect(
			await prisma.recipe.count({
				where: { householdId: session.householdId },
			}),
		).toBe(0)
	})

	test('an unexpected database error stops the restore, and a second run finishes it without duplicates', async () => {
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

		await expect(restoreText(session, JSON.stringify(file))).rejects.toThrow(
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
			const session = await setupUser()
			await prisma.$executeRawUnsafe(
				`CREATE TRIGGER restore_test_fault BEFORE INSERT ON "${table}"
				WHEN ${when} BEGIN SELECT abs(-9223372036854775808); END`,
			)
			await expect(restoreText(session, JSON.stringify(file))).rejects.toThrow(
				/integer overflow/,
			)
		},
	)

	test('each failure is logged with where it was, never with what the user wrote', async () => {
		const session = await setupUser()
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
