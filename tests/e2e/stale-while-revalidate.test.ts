import { type Page } from '@playwright/test'
import { getCurrentWeekStart, getWeekDays, isToday } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

// page.route cannot see requests a service worker answers.
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } })

const PLAN_ROUTE = 'routes/plan/index'

function bottomNav(page: Page) {
	return page
		.getByRole('navigation', { name: 'Main' })
		.filter({ has: page.getByRole('link', { name: 'Shop', exact: true }) })
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

	await nav.getByRole('link', { name: 'Shop', exact: true }).click()
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
	let release = () => {}
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	const planRequests: Array<{ pathname: string; showedTacos: boolean }> = []
	await page.route('**/plan.data*', async (route) => {
		if (isPlanData(route.request().url())) {
			planRequests.push(
				await page.evaluate(() => ({
					pathname: window.location.pathname,
					showedTacos: document.body.innerText.includes('Tacos'),
				})),
			)
		}
		await gate
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

	release()
	await expect(mobile.getByText("Sam's curry")).toBeVisible()
	await expect(mobile.getByText('Tacos')).toBeVisible()
	// Fresh data does not start another revalidation.
	await page.waitForTimeout(500)
	expect(planRequests).toHaveLength(1)
	expect(await prisma.meal.count({ where: { mealPlanId: mealPlan.id } })).toBe(
		2,
	)
})
