import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

/**
 * Plan's Today is the browser's calendar day, as its timezone hint names it.
 *
 * The server runs on the real clock, so each zone below is checked against
 * the real time. Kiritimati (UTC+14) and Pago Pago (UTC−11) are 25 hours
 * apart, so at any moment at least one of them is on another day than UTC,
 * and a server that ignored the hint would fail that one.
 */
const ZONES = ['Pacific/Kiritimati', 'Pacific/Pago_Pago']

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const ROUND_TRIP = { timeout: 15_000 }

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')

/** "Nov 24" for a `yyyy-MM-dd` day, the way the Plan heading shows it. */
function monthDay(day: string) {
	const [, month, date] = day.split('-').map(Number)
	return `${MONTHS[month! - 1]} ${date}`
}

for (const zone of ZONES) {
	test.describe(zone, () => {
		test.use({ timezoneId: zone })

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

			const sheet = page.getByRole('dialog', { name: 'Add Meal' })
			await expect(async () => {
				await page.getByRole('button', { name: /^Add Meal to/ }).tap()
				await expect(sheet).toBeVisible({ timeout: 1000 })
			}).toPass({ timeout: 10_000 })
			await sheet.getByRole('button', { name: /Miso Soup/ }).tap()
			await expect(sheet).toBeHidden()
			await expect(
				mobile.getByRole('link', { name: 'Miso Soup' }),
			).toBeVisible()

			await expect
				.poll(
					() =>
						prisma.meal
							.findMany({
								where: { recipeItems: { some: { recipeId: recipe.id } } },
								select: { date: true },
							})
							.then((meals) => meals.map((meal) => meal.date.toISOString())),
					ROUND_TRIP,
				)
				.toEqual([`${localToday}T00:00:00.000Z`])
			// Taps only land once the page has hydrated, so any mismatch is in by now.
			expect(hydrationErrors).toEqual([])
		})
	})
}
