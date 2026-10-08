import { type Page } from '@playwright/test'
import { getCurrentWeekStart, getWeekDays, isToday } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 } })

const DATA_NETWORK_TIMEOUT_MS = 4000
const SERVER_DELAY_MS = 8000

function bottomNav(page: Page) {
	return page
		.getByRole('navigation', { name: 'Main' })
		.filter({ has: page.getByRole('link', { name: 'Plan', exact: true }) })
}

/** Open Shopping under the worker's control and wait for hydration. */
async function openShopping(page: Page) {
	await page.goto('/shopping')
	await page.evaluate(() => navigator.serviceWorker.ready)
	// The worker does not claim the page that installed it; a first registration
	// takes control at the next document.
	if (
		!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
	) {
		await page.reload()
	}
	await page.waitForFunction(
		() =>
			Boolean(navigator.serviceWorker.controller) &&
			[
				...document.querySelectorAll<HTMLInputElement>(
					'input[name="originClientId"]',
				),
			].some((input) => input.value),
	)
}

/** The text the worker's session cache holds for `url`, or null. */
function cachedData(page: Page, url: string) {
	return page.evaluate(async (key) => {
		for (const cacheName of await caches.keys()) {
			if (!cacheName.startsWith('qm-data-')) continue
			const cached = await (await caches.open(cacheName)).match(key)
			if (cached) return cached.text()
		}
		return null
	}, url)
}

test('a stalled Plan answers from the session cache after 4 s, and the late response refreshes it', async ({
	page,
	context,
	login,
}) => {
	test.setTimeout(60_000)
	const user = await login()
	const weekStart = getCurrentWeekStart()
	const today = getWeekDays(weekStart).find(isToday) ?? weekStart
	const mealPlan = await prisma.mealPlan.create({
		data: { householdId: user.householdId, weekStart },
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

	// Warm load: the Shopping → Plan navigation's Route data, cached by the
	// worker once the page has named its session.
	await openShopping(page)
	const planData: string[] = []
	const recordPlanData = (request: { url: () => string }) => {
		if (new URL(request.url()).pathname === '/plan.data') {
			planData.push(request.url())
		}
	}
	page.on('request', recordPlanData)
	await bottomNav(page).getByRole('link', { name: 'Plan', exact: true }).click()
	await expect(mobile.getByText('Tacos')).toBeVisible()
	page.off('request', recordPlanData)
	expect(planData.length).toBeGreaterThan(0)
	// A request that left before the worker knew the session went uncached;
	// ask again through the worker until each one is held.
	for (const url of planData) {
		await expect
			.poll(
				() =>
					page.evaluate(
						async ({ url }) => {
							for (const cacheName of await caches.keys()) {
								if (!cacheName.startsWith('qm-data-')) continue
								if (await (await caches.open(cacheName)).match(url)) return true
							}
							await fetch(url)
							return false
						},
						{ url },
					),
				{ message: `the session cache holds ${url}` },
			)
			.toBe(true)
	}

	// A fresh document (nothing in memory), then the other member's change and a
	// connection that stalls on every Route data request.
	await openShopping(page)
	await prisma.meal.create({
		data: {
			mealPlanId: mealPlan.id,
			date: today,
			order: 1,
			genericText: "Sam's curry",
		},
	})
	await context.addCookies([
		{
			name: 'qm-e2e-delay-ms',
			value: String(SERVER_DELAY_MS),
			domain: 'localhost',
			path: '/',
		},
	])

	const startedAt = Date.now()
	await bottomNav(page).getByRole('link', { name: 'Plan', exact: true }).click()
	await expect(mobile.getByText('Tacos')).toBeVisible({ timeout: 6000 })
	const waited = Date.now() - startedAt
	expect(waited).toBeGreaterThanOrEqual(DATA_NETWORK_TIMEOUT_MS - 500)
	expect(waited).toBeLessThan(SERVER_DELAY_MS)
	// The page shows the cached Plan, not the server's newer one.
	await expect(mobile.getByText("Sam's curry")).toHaveCount(0)
	expect(await prisma.meal.count({ where: { mealPlanId: mealPlan.id } })).toBe(
		2,
	)

	// The stalled request keeps going, and its answer replaces the cached copy.
	const planUrl = planData.find((url) =>
		(new URL(url).searchParams.get('_routes') ?? '').includes('routes/plan'),
	)
	expect(planUrl).toBeDefined()
	await expect
		.poll(() => cachedData(page, planUrl!), {
			message: 'the late response refreshes the cache',
			timeout: SERVER_DELAY_MS + 5000,
		})
		.toContain("Sam's curry")
})
