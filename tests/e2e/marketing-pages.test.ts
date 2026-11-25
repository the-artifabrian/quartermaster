import { type Page } from '@playwright/test'
import {
	addDaysUTC,
	formatWeekRange,
	getWeekStart,
	parseDate,
	serializeDate,
	todayInTimeZone,
} from '#app/utils/date.ts'
import { expect, test, waitForHydration } from '#tests/playwright-utils.ts'

// Every public page is checked on its own: the footer is shared, but a page
// can leave the layout.
const SOURCE_URL = 'https://github.com/the-artifabrian/quartermaster'
const FOOTER_LINKS = [
	'About',
	'Support',
	'Privacy',
	'Terms',
	'Source on GitHub',
]

// The footer sits inside <main>, so it has no contentinfo role; its nav is
// named instead.
function footer(page: Page) {
	return page.getByRole('navigation', { name: 'Footer' })
}

for (const pagePath of ['/', '/about', '/support', '/privacy', '/tos']) {
	test(`${pagePath} links to the source code in its footer`, async ({
		page,
	}) => {
		await page.goto(pagePath)
		const link = footer(page).getByRole('link', { name: 'Source on GitHub' })
		await expect(link).toBeVisible()
		await expect(link).toHaveAttribute('href', SOURCE_URL)
	})
}

test('the footer fits a phone without scrolling sideways', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/')
	await footer(page).scrollIntoViewIfNeeded()
	// The width left beside any scrollbar.
	const width = await page.evaluate(() => document.documentElement.clientWidth)
	for (const name of FOOTER_LINKS) {
		const link = footer(page).getByRole('link', { name, exact: true })
		const box = (await link.boundingBox())!
		expect(box.x, name).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width, name).toBeLessThanOrEqual(width)
		// The links wrap as whole words: no link breaks across two lines.
		const lines = await link.evaluate((el) => {
			const range = document.createRange()
			range.selectNodeContents(el)
			return new Set([...range.getClientRects()].map((rect) => rect.top)).size
		})
		expect(lines, name).toBe(1)
	}
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth),
	).toBeLessThanOrEqual(width)
})

test('About says the app is open source and links to the code', async ({
	page,
}) => {
	await page.goto('/about')
	const main = page.getByRole('main')
	await expect(main.getByText(/open source/)).toBeVisible()
	await expect(
		main.getByRole('link', { name: 'read it on GitHub' }),
	).toHaveAttribute('href', SOURCE_URL)
})

test.describe('the homepage Plans follow the visitor’s calendar', () => {
	// A zone on another date than UTC right now, so a loader that ignored the
	// visitor's zone would draw the wrong day. Kiritimati is a day ahead of
	// UTC from 10:00 UTC, Pago Pago a day behind until 11:00 UTC.
	const timeZone =
		todayInTimeZone('Pacific/Kiritimati') !== todayInTimeZone('UTC')
			? 'Pacific/Kiritimati'
			: 'Pacific/Pago_Pago'
	test.use({ timezoneId: timeZone })

	test('the hero marks today and the Plan section shows next week', async ({
		page,
	}) => {
		// A production build reports a mismatch as a minified React error,
		// often as an uncaught page error rather than a console line.
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
		const today = parseDate(todayInTimeZone(timeZone))
		const nextWeek = addDaysUTC(getWeekStart(today), 7)

		await page.goto('/')
		await waitForHydration(page)
		const hero = page.getByRole('img', {
			name: 'This week’s Plan, Monday to Sunday',
		})
		const todayRow = hero.locator('section').filter({ hasText: 'Today' })
		await expect(todayRow).toHaveCount(1)
		await expect(todayRow.locator('p.font-serif').first()).toHaveText(
			String(today.getUTCDate()),
		)
		// Only yesterday's Meal is cooked, so the hero looks the same every day.
		const isMonday = today.getUTCDay() === 1
		await expect(hero.locator('p.line-through')).toHaveCount(isMonday ? 0 : 1)

		const range = formatWeekRange(nextWeek, serializeDate(today))
		await expect(
			page.getByRole('img', {
				name: `The Plan page: next week, ${range}`,
				exact: false,
			}),
		).toBeVisible()
		expect(hydrationErrors).toEqual([])
	})
})
