import { type Page } from '@playwright/test'
import { getCurrentWeekStart, getWeekDays, isToday } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

// page.route cannot see requests a service worker answers.
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } })

const PLAN_ROUTE = 'routes/plan/index'
const SHOPPING_ROUTE = 'routes/shopping'

function openGate() {
	let release = () => {}
	const promise = new Promise<void>((resolve) => {
		release = resolve
	})
	return { promise, release }
}

function bottomNav(page: Page) {
	return page
		.getByRole('navigation', { name: 'Main' })
		.filter({ has: page.getByRole('link', { name: 'Shopping', exact: true }) })
}

function isPlanData(url: string) {
	const { pathname, searchParams } = new URL(url)
	return (
		pathname === '/plan.data' &&
		(searchParams.get('_routes') ?? '').split(',').includes(PLAN_ROUTE)
	)
}

test("a revisited Plan shows at once from memory, then shows the other member's change", async ({
	page,
	login,
	insertNewUser,
}) => {
	const alex = await login()
	const sam = await insertNewUser()
	await prisma.householdMember.create({
		data: { householdId: alex.householdId, userId: sam.id, role: 'member' },
	})
	const weekStart = getCurrentWeekStart()
	const today = getWeekDays(weekStart).find(isToday) ?? weekStart
	const mealPlan = await prisma.mealPlan.create({
		data: { householdId: alex.householdId, weekStart },
	})
	await prisma.meal.create({
		data: {
			mealPlanId: mealPlan.id,
			date: today,
			order: 0,
			genericText: 'Tacos',
		},
	})

	const mobile = page.getByTestId('mobile-plan')
	const nav = bottomNav(page)
	const dataRequests: string[] = []
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.endsWith('.data')) {
			dataRequests.push(request.url())
		}
	})
	await page.goto('/plan')
	await expect(mobile.getByText('Tacos')).toBeVisible()
	// The first load renders the server's data and never asks the cache.
	await page.waitForTimeout(300)
	expect(dataRequests).toEqual([])

	await nav.getByRole('link', { name: 'Shopping', exact: true }).click()
	await expect(page).toHaveURL('/shopping')
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

	// Sam plans a meal while Alex is on Shopping.
	await prisma.meal.create({
		data: {
			mealPlanId: mealPlan.id,
			date: today,
			order: 1,
			genericText: "Sam's curry",
		},
	})

	// Hold every Plan .data request until the test lets it go, and note where
	// the page already was when each one left.
	let gate = openGate()
	const planRequests: Array<{ pathname: string; showedTacos: boolean }> = []
	// Root requests pass, but each is noted with where the page was.
	const rootRequests: Array<{ pathname: string; showedTacos: boolean }> = []
	await page.route('**/plan.data*', async (route) => {
		const seen = await page.evaluate(() => ({
			pathname: window.location.pathname,
			showedTacos: document.body.innerText.includes('Tacos'),
		}))
		if (!isPlanData(route.request().url())) {
			rootRequests.push(seen)
			return route.continue()
		}
		planRequests.push(seen)
		await gate.promise
		await route.continue()
	})

	await nav.getByRole('link', { name: 'Plan', exact: true }).click()
	await expect(page).toHaveURL('/plan')
	await expect(mobile.getByText('Tacos')).toBeVisible()
	await expect(mobile.getByText("Sam's curry")).toHaveCount(0)
	// The one Plan request is the revalidation behind the painted page, not
	// the navigation waiting on the server.
	await expect.poll(() => planRequests.length).toBe(1)
	expect(planRequests[0]).toEqual({ pathname: '/plan', showedTacos: true })
	// A tab switch does not wait on root either; root reloads only in the
	// revalidation behind the page.
	expect(rootRequests.every((request) => request.showedTacos)).toBe(true)

	gate.release()
	await expect(mobile.getByText("Sam's curry")).toBeVisible()
	await expect(mobile.getByText('Tacos')).toBeVisible()
	// Fresh data does not start another revalidation.
	await page.waitForTimeout(500)
	expect(planRequests).toHaveLength(1)
	expect(await prisma.meal.count({ where: { mealPlanId: mealPlan.id } })).toBe(
		2,
	)

	// Back (the WKWebView swipe, the browser button) gets Plan from memory too:
	// the browser shows /plan before the loaders run, but the router is still
	// on Shopping. Root reloads on a back navigation (single fetch), so that one
	// request goes before the page shows; Plan's own goes after.
	await nav.getByRole('link', { name: 'Shopping', exact: true }).click()
	await expect(page).toHaveURL('/shopping')
	await expect(mobile).toHaveCount(0)
	gate = openGate()
	planRequests.length = 0
	rootRequests.length = 0
	await page.goBack()
	await expect(page).toHaveURL('/plan')
	await expect(mobile.getByText("Sam's curry")).toBeVisible()
	await expect.poll(() => planRequests.length).toBe(1)
	expect(planRequests[0]).toEqual({ pathname: '/plan', showedTacos: true })
	expect(rootRequests[0]).toEqual({ pathname: '/plan', showedTacos: false })
	gate.release()
	await page.waitForTimeout(500)
	expect(planRequests).toHaveLength(1)
})

test('a checked Shopping item is not shown unchecked from memory', async ({
	page,
	login,
}) => {
	const user = await login()
	const list = await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: { create: { name: 'Rice', quantity: '200', unit: 'g' } },
		},
		include: { items: true },
	})
	const rice = page.getByRole('group', { name: 'Rice shopping item' })
	const nav = bottomNav(page)
	await page.goto('/shopping')
	await page.waitForFunction(() =>
		[
			...document.querySelectorAll<HTMLInputElement>(
				'input[name="originClientId"]',
			),
		].some((input) => input.value),
	)

	// The check is a native fetch, outside the Router.
	await rice.getByRole('button', { name: 'Check off item' }).click()
	await expect(rice.getByRole('button', { name: 'Uncheck item' })).toBeVisible()
	await expect(rice.getByRole('status')).toBeHidden()
	await expect
		.poll(
			async () =>
				(
					await prisma.shoppingListItem.findUniqueOrThrow({
						where: { id: list.items[0]!.id },
					})
				).checked,
		)
		.toBe(true)

	await nav.getByRole('link', { name: 'Plan', exact: true }).click()
	await expect(page).toHaveURL('/plan')

	const gate = openGate()
	const shoppingRequests: string[] = []
	await page.route('**/shopping.data*', async (route) => {
		const { searchParams } = new URL(route.request().url())
		if (
			(searchParams.get('_routes') ?? '').split(',').includes(SHOPPING_ROUTE)
		) {
			shoppingRequests.push(await page.evaluate(() => window.location.pathname))
		}
		await gate.promise
		await route.continue()
	})
	await nav.getByRole('link', { name: 'Shopping', exact: true }).click()
	// The check dropped the remembered Shopping page, so the navigation waits
	// for the server instead of showing Rice unchecked.
	await expect.poll(() => shoppingRequests.length).toBe(1)
	expect(shoppingRequests[0]).toBe('/plan')
	await expect(page).toHaveURL('/plan')
	gate.release()
	await expect(page).toHaveURL('/shopping')
	await expect(rice.getByRole('button', { name: 'Uncheck item' })).toBeVisible()
})
