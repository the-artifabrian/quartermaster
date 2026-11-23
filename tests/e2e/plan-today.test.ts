import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

/**
 * Plan's Today is the browser's calendar day, as its timezone hint names it,
 * not the server's or UTC's.
 *
 * The server runs on the real clock (page.clock only moves the browser's), so
 * the zone is picked from the real time: one whose day differs from UTC's
 * right now. Pago Pago (UTC−11) is a day behind before 11:00 UTC; Kiritimati
 * (UTC+14) is a day ahead from 10:00 UTC.
 */
const zone =
	new Date().getUTCHours() < 10 ? 'Pacific/Pago_Pago' : 'Pacific/Kiritimati'

test.use({
	viewport: { width: 390, height: 844 },
	hasTouch: true,
	timezoneId: zone,
})

const ROUND_TRIP = { timeout: 15_000 }

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')

/** "Nov 24" for a `yyyy-MM-dd` day, the way the Plan heading shows it. */
function monthDay(day: string) {
	const [, month, date] = day.split('-').map(Number)
	return `${MONTHS[month! - 1]} ${date}`
}

test('Plan opens on the browser’s today, and a Meal added to it lands on that day', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Miso Soup',
			userId: user.id,
			householdId: user.householdId,
		},
	})
	// The hint cookie the page's own check would set on a first visit, so the
	// first paint below is already a real one.
	await page.context().addCookies([
		{
			name: 'CH-time-zone',
			value: encodeURIComponent(zone),
			domain: 'localhost',
			path: '/',
		},
	])

	const hydrationErrors: string[] = []
	const isHydrationError = (text: string) =>
		/hydrat|Minified React error #(418|419|421|422|423|425)/i.test(text)
	page.on('console', (message) => {
		if (message.type() === 'error' && isHydrationError(message.text())) {
			hydrationErrors.push(message.text())
		}
	})
	page.on('pageerror', (error) => {
		if (isHydrationError(String(error))) hydrationErrors.push(String(error))
	})

	await page.goto('/plan')
	const localToday = await page.evaluate(() =>
		new Date().toLocaleDateString('en-CA'),
	)
	const utcToday = new Date().toISOString().slice(0, 10)
	expect(localToday, 'the zone should put the browser on another day').not.toBe(
		utcToday,
	)

	// The server's HTML already marks the local day as Today.
	const html = await (await page.request.get('/plan')).text()
	expect(html).toMatch(
		new RegExp(
			`aria-current="date" aria-label="Show Today, ${monthDay(localToday)},`,
		),
	)

	const mobile = page.getByTestId('mobile-plan')
	const todayButton = mobile.locator('[aria-current="date"]')
	await expect(todayButton).toHaveCount(1)
	await expect(todayButton).toHaveAccessibleName(
		new RegExp(`^Show Today, ${monthDay(localToday)},`),
	)
	await expect(mobile.getByRole('heading', { level: 2 })).toHaveText(
		monthDay(localToday),
	)
	// The browser drew the same day the server did.
	expect(hydrationErrors).toEqual([])

	const sheet = page.getByRole('dialog', { name: 'Add a Meal' })
	await expect(async () => {
		await page.getByRole('button', { name: /^Add Meal to/ }).tap()
		await expect(sheet).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 10_000 })
	await sheet.getByRole('button', { name: /Miso Soup/ }).tap()
	await expect(sheet).toBeHidden()
	await expect(mobile.getByRole('link', { name: 'Miso Soup' })).toBeVisible()

	await expect
		.poll(
			() =>
				prisma.meal
					.findMany({
						where: { recipeItems: { some: { recipeId: recipe.id } } },
						select: { date: true },
					})
					.then((meals) =>
						meals.map((meal) => meal.date.toISOString().slice(0, 10)),
					),
			ROUND_TRIP,
		)
		.toEqual([localToday])
	// Taps only land once the page has hydrated, so any mismatch is in by now.
	expect(hydrationErrors).toEqual([])
})
