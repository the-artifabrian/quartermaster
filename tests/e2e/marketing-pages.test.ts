import { type Page } from '@playwright/test'
import {
	formatMonthDay,
	formatWeekRange,
	formatWeekdayName,
	getWeekStart,
	parseDate,
	serializeDate,
	todayInTimeZone,
} from '#app/utils/date.ts'
import { nextSaturday } from '#app/utils/homepage-plan-days.ts'
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

	test('the hero picks today and the Plan section the coming Saturday', async ({
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
		const todayString = todayInTimeZone(timeZone)
		const today = parseDate(todayString)
		const saturday = parseDate(nextSaturday(todayString))

		await page.goto('/')
		await waitForHydration(page)
		const hero = page.getByRole('img', {
			name: `The Plan on a phone: today, ${formatWeekdayName(today)}, ${formatMonthDay(today)}`,
			exact: false,
		})
		await expect(hero.locator('[data-strip-day][data-picked]')).toHaveText(
			String(today.getUTCDate()),
		)
		await expect(hero.locator('[data-strip-day][data-today]')).toHaveCount(1)
		await expect(hero.locator('[data-day-heading]')).toHaveText(
			formatMonthDay(today),
		)
		await expect(hero.locator('[data-week-range]')).toHaveText(
			formatWeekRange(getWeekStart(today), todayString),
		)
		// One cooked dish whatever the day, so the picture is the same daily.
		await expect(hero.locator('.line-through')).toHaveCount(1)

		const plan = page.getByRole('img', {
			name: `The Plan on a phone: ${formatWeekdayName(saturday)}, ${formatMonthDay(saturday)}`,
			exact: false,
		})
		await expect(plan.locator('[data-strip-day][data-picked]')).toHaveText(
			String(saturday.getUTCDate()),
		)
		// Saturday and Sunday look a week on, where today isn't in the strip.
		const sameWeek =
			serializeDate(getWeekStart(saturday)) ===
			serializeDate(getWeekStart(today))
		await expect(plan.locator('[data-strip-day][data-today]')).toHaveCount(
			sameWeek ? 1 : 0,
		)
		expect(hydrationErrors).toEqual([])
	})
})

/** The homepage's phone pictures, each a scaled 390px screen in a frame. */
async function phoneBoxes(page: Page) {
	return page.locator('main [role="img"]').evaluateAll((phones) =>
		phones.map((phone) => {
			const slot = phone.querySelector('[data-phone-slot]')!
			const screen = phone.querySelector('[data-phone-screen]')!
			const box = (el: Element) => {
				const { x, y, width, height } = el.getBoundingClientRect()
				return { x, y, width, height }
			}
			return {
				label: phone.getAttribute('aria-label'),
				hidden: phone.firstElementChild?.getAttribute('aria-hidden'),
				focusable: phone.querySelectorAll(
					'a[href], button, input, select, textarea, [tabindex]',
				).length,
				phone: box(phone),
				slot: box(slot),
				screen: box(screen),
			}
		}),
	)
}

for (const width of [320, 768]) {
	test(`the homepage's phones fit a ${width}px page, filled to their frames`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 800 })
		await page.goto('/')
		const clientWidth = await page.evaluate(
			() => document.documentElement.clientWidth,
		)
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
		).toBeLessThanOrEqual(clientWidth)
		const phones = await phoneBoxes(page)
		// The hero's Plan and Shopping, then one for each step.
		expect(phones).toHaveLength(6)
		for (const phone of phones) {
			expect(phone.label, 'named for what it shows').toBeTruthy()
			expect(phone.hidden).toBe('true')
			expect(phone.focusable, phone.label!).toBe(0)
			expect(phone.phone.x).toBeGreaterThanOrEqual(0)
			expect(phone.phone.x + phone.phone.width).toBeLessThanOrEqual(clientWidth)
			// The scaled screen covers its slot in the frame, with no strip
			// left beside or under it.
			for (const side of ['x', 'y', 'width', 'height'] as const) {
				expect(
					Math.abs(phone.screen[side] - phone.slot[side]),
					`${phone.label} ${side}`,
				).toBeLessThan(0.5)
			}
		}
	})
}

for (const width of [390, 1280]) {
	test(`See how it works lands the first section under the header at ${width}px`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await page.setViewportSize({ width, height: 800 })
		await page.goto('/')
		await waitForHydration(page)
		await page.getByRole('link', { name: 'See how it works' }).click()
		await expect(page).toHaveURL(/#how-it-works$/)
		// Reduced motion jumps: the place is final at once.
		const top = await page.evaluate(() => {
			const header = document.querySelector('[data-site-header]')!
			const stuck = getComputedStyle(header).position === 'sticky'
			return {
				section: document
					.getElementById('how-it-works')!
					.getBoundingClientRect().top,
				under: stuck ? header.getBoundingClientRect().bottom : 0,
			}
		})
		expect(top.section - top.under).toBeGreaterThanOrEqual(8)
		expect(top.section - top.under).toBeLessThanOrEqual(48)
	})
}
