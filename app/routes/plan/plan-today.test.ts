/**
 * The pages that draw Today, past days or "this week" take them from the
 * browser's timezone hint, so the server renders the day the browser will.
 *
 * Failure list:
 * - Plan opened in Bucharest at 00:30 on a Monday (UTC still Sunday) opens
 *   last week, with no Today in it.
 * - Plan opened in Los Angeles at 20:00 on a Sunday (UTC already Monday)
 *   opens next week, and Sunday isn't Today.
 * - Plan on New Year's night in Bucharest opens the old year's last week.
 * - Plan with no hint cookie fails to load; it should use the UTC day.
 * - Plan with a `weekStart` keeps that week but still knows today.
 * - A malformed `weekStart` on Plan or the From Plan picker fails the load;
 *   it should open today's week. A mid-week day opens its own week.
 * - Shopping's From Plan offers the wrong week as the current one.
 * - The From Plan picker folds a day as past by the server's day.
 * - Add to Plan on a Recipe or a Menu starts on the server's day.
 */
import { RouterContextProvider } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { parseDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { menuTitleKey } from '#app/utils/menu-validation.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader as menuLoader } from '../recipes/menus/$menuId.tsx'
import { loader as recipeLoader } from '../recipes/$recipeId.tsx'
import { loader as pickerLoader } from '../resources/shopping-plan.tsx'
import { loader as shoppingLoader } from '../shopping.tsx'
import { loader as planLoader } from './index.tsx'
import '#tests/setup/db-setup.ts'

afterEach(() => {
	vi.useRealTimers()
})

/** Pins the clock, then signs a new member of a new Household in. */
async function signedInAt(instant: string) {
	vi.useFakeTimers({ toFake: ['Date'] })
	vi.setSystemTime(new Date(instant))
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
		select: { id: true, userId: true },
	})
	const household = await prisma.household.create({
		data: {
			name: 'Today Household',
			members: { create: { userId: session.userId, role: 'owner' } },
		},
	})
	const sessionCookie = await getSessionCookieHeader(session)
	return {
		userId: session.userId,
		householdId: household.id,
		/** A GET to `path` from a browser in `timeZone` (none: no hint yet). */
		request(path: string, timeZone?: string) {
			const cookie = timeZone
				? `${sessionCookie}; CH-time-zone=${encodeURIComponent(timeZone)}`
				: sessionCookie
			return new Request(`${BASE_URL}${path}`, { headers: { cookie } })
		},
	}
}

function args<Params extends Record<string, string>>(
	request: Request,
	params = {} as Params,
) {
	return {
		request,
		params,
		context: new RouterContextProvider(),
		pattern: new URL(request.url).pathname,
		url: new URL(request.url),
	}
}

test('Plan in Bucharest just after midnight on a Monday opens that week, with Monday as Today', async () => {
	const user = await signedInAt('2026-11-22T22:30:00Z')
	const result = await planLoader(
		args(user.request('/plan', 'Europe/Bucharest')),
	)
	expect(result.weekStart).toBe('2026-11-23')
	expect(result.today).toBe('2026-11-23')
})

test('Plan in Los Angeles on a Sunday evening stays on the week ending that Sunday', async () => {
	const user = await signedInAt('2026-11-23T04:00:00Z')
	const result = await planLoader(
		args(user.request('/plan', 'America/Los_Angeles')),
	)
	expect(result.weekStart).toBe('2026-11-16')
	expect(result.today).toBe('2026-11-22')
})

test("Plan in Bucharest on New Year's night opens the week with New Year's Day in it", async () => {
	const user = await signedInAt('2026-12-31T22:30:00Z')
	const result = await planLoader(
		args(user.request('/plan', 'Europe/Bucharest')),
	)
	expect(result.weekStart).toBe('2026-12-28')
	expect(result.today).toBe('2027-01-01')
})

test('Plan with no hint yet uses the UTC day', async () => {
	const user = await signedInAt('2026-11-22T22:30:00Z')
	const result = await planLoader(args(user.request('/plan')))
	expect(result.weekStart).toBe('2026-11-16')
	expect(result.today).toBe('2026-11-22')
})

test('Plan for a chosen week keeps that week and still knows today', async () => {
	const user = await signedInAt('2026-11-22T22:30:00Z')
	const result = await planLoader(
		args(user.request('/plan?weekStart=2026-11-30', 'Europe/Bucharest')),
	)
	expect(result.weekStart).toBe('2026-11-30')
	expect(result.today).toBe('2026-11-23')
})

test.each(['soon', '2026-02-30', '2026-11-30T00:00:00Z'])(
	'Plan and the From Plan picker open this week for weekStart=%s',
	async (weekStart) => {
		const user = await signedInAt('2026-11-22T22:30:00Z')
		const query = `weekStart=${encodeURIComponent(weekStart)}`
		const plan = await planLoader(
			args(user.request(`/plan?${query}`, 'Europe/Bucharest')),
		)
		expect(plan.weekStart).toBe('2026-11-23')
		const picker = await pickerLoader(
			args(
				user.request(`/resources/shopping-plan?${query}`, 'Europe/Bucharest'),
			),
		)
		expect(picker.data).toMatchObject({ weekStart: '2026-11-23' })
	},
)

test('Plan and the From Plan picker open the week a mid-week day falls in', async () => {
	const user = await signedInAt('2026-11-22T22:30:00Z')
	const plan = await planLoader(
		args(user.request('/plan?weekStart=2026-12-03', 'Europe/Bucharest')),
	)
	expect(plan.weekStart).toBe('2026-11-30')
	const picker = await pickerLoader(
		args(
			user.request(
				'/resources/shopping-plan?weekStart=2026-12-03',
				'Europe/Bucharest',
			),
		),
	)
	expect(picker.data).toMatchObject({ weekStart: '2026-11-30' })
})

test("From Plan marks the browser's week as the current one", async () => {
	const user = await signedInAt('2026-11-23T04:00:00Z')
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Soup',
			userId: user.userId,
			householdId: user.householdId,
			ingredients: { create: { name: 'leek', amount: '2', order: 0 } },
		},
	})
	for (const weekStart of ['2026-11-16', '2026-11-23']) {
		await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart: parseDate(weekStart),
				meals: {
					create: {
						date: parseDate(weekStart),
						order: 0,
						recipeItems: {
							create: {
								recipeId: recipe.id,
								recipeTitle: recipe.title,
								order: 0,
							},
						},
					},
				},
			},
		})
	}

	const result = await shoppingLoader(
		args(user.request('/shopping', 'America/Los_Angeles')),
	)

	expect(
		result.weeksWithPlans.map(({ weekStart, isCurrent }) => ({
			weekStart,
			isCurrent,
		})),
	).toEqual([
		{ weekStart: '2026-11-16', isCurrent: true },
		{ weekStart: '2026-11-23', isCurrent: false },
	])
})

test("the From Plan picker sends the browser's today with a week's choices", async () => {
	const user = await signedInAt('2026-11-23T04:00:00Z')
	const result = await pickerLoader(
		args(
			user.request(
				'/resources/shopping-plan?weekStart=2026-11-16',
				'America/Los_Angeles',
			),
		),
	)
	expect(result.data).toMatchObject({
		weekStart: '2026-11-16',
		today: '2026-11-22',
	})
})

test("Add to Plan on a Recipe and on a Menu starts on the browser's today", async () => {
	const user = await signedInAt('2026-11-22T22:30:00Z')
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Soup',
			userId: user.userId,
			householdId: user.householdId,
		},
	})
	const menu = await prisma.menu.create({
		data: {
			title: 'Sunday lunch',
			titleKey: menuTitleKey('Sunday lunch'),
			householdId: user.householdId,
		},
	})

	const recipePage = await recipeLoader(
		args(user.request(`/recipes/${recipe.id}`, 'Europe/Bucharest'), {
			recipeId: recipe.id,
		}),
	)
	const menuPage = await menuLoader(
		args(user.request(`/recipes/menus/${menu.id}`, 'Europe/Bucharest'), {
			menuId: menu.id,
		}),
	)

	expect(recipePage.today).toBe('2026-11-23')
	expect(menuPage.today).toBe('2026-11-23')
})
