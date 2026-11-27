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

/** The window that gives a `layout`-wide page beside the 15px scrollbar. */
async function openAt(page: Page, layout: number) {
	await page.setViewportSize({ width: layout + 15, height: 800 })
	await page.goto('/')
	await page.evaluate(() => document.fonts.ready)
	expect(
		await page.evaluate(
			() => document.documentElement.getBoundingClientRect().width,
		),
	).toBe(layout)
}

/** The homepage's phones, each a scaled 390px screen in a frame. */
async function phoneBoxes(page: Page) {
	return page.locator('main [data-phone-frame]').evaluateAll((phones) =>
		phones.map((phone) => {
			const inner = phone.firstElementChild as HTMLElement
			const slot = phone.querySelector('[data-phone-slot]')!
			const screen = phone.querySelector('[data-phone-screen]')!
			const box = (el: Element) => {
				const { x, y, width, height } = el.getBoundingClientRect()
				return { x, y, width, height }
			}
			// The page's content edges where the phone sits.
			const container = phone.closest('.container')!
			const style = getComputedStyle(container)
			const outer = container.getBoundingClientRect()
			// A step's phone also keeps to its own grid item.
			const item = phone.closest('#how-it-works > div')
			const itemBox = item?.getBoundingClientRect()
			return {
				label: phone.getAttribute('aria-label'),
				role: phone.getAttribute('role'),
				phoneHidden: phone.getAttribute('aria-hidden'),
				innerHidden: inner.getAttribute('aria-hidden'),
				inert: inner.inert,
				focusable: phone.querySelectorAll(
					'a[href], button, input, select, textarea, [tabindex]',
				).length,
				shown: phone.getBoundingClientRect().width > 0,
				phone: box(phone),
				slot: box(slot),
				screen: box(screen),
				content: {
					left: outer.left + parseFloat(style.paddingLeft),
					right: outer.right - parseFloat(style.paddingRight),
				},
				item: itemBox ? { left: itemBox.left, right: itemBox.right } : null,
			}
		}),
	)
}

for (const layout of [320, 640, 768, 1280, 1440]) {
	test(`the homepage's phones fit a ${layout}px page, inert and filled to their frames`, async ({
		page,
	}) => {
		await openAt(page, layout)
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
		).toBeLessThanOrEqual(layout)
		const phones = await phoneBoxes(page)
		// The hero's Plan and Shopping, then one for each step.
		expect(phones).toHaveLength(6)
		for (const phone of phones) {
			// An image named for what it shows, or kept out of the tree.
			const name = phone.label ?? 'a phone kept out of the tree'
			if (phone.role === 'img') expect(phone.label).toBeTruthy()
			else expect(phone.phoneHidden, name).toBe('true')
			expect(phone.innerHidden, name).toBe('true')
			expect(phone.inert, name).toBe(true)
			expect(phone.focusable, name).toBe(0)
			if (!phone.shown) continue
			expect(phone.phone.x, name).toBeGreaterThanOrEqual(
				phone.content.left - 0.5,
			)
			expect(phone.phone.x + phone.phone.width, name).toBeLessThanOrEqual(
				phone.content.right + 0.5,
			)
			if (phone.item) {
				expect(phone.phone.x, name).toBeGreaterThanOrEqual(
					phone.item.left - 0.5,
				)
				expect(phone.phone.x + phone.phone.width, name).toBeLessThanOrEqual(
					phone.item.right + 0.5,
				)
			}
			// The scaled screen covers its slot in the frame, with no strip
			// left beside or under it.
			for (const side of ['x', 'y', 'width', 'height'] as const) {
				expect(
					Math.abs(phone.screen[side] - phone.slot[side]),
					`${name} ${side}`,
				).toBeLessThan(0.5)
			}
		}
	})
}

/** The hero's phones, and where its bottom edge cuts them. */
async function heroPhones(page: Page) {
	return page
		.locator('main > div > section')
		.first()
		.evaluate((hero) => {
			const cut = hero.getBoundingClientRect().bottom
			const frames = [...hero.querySelectorAll('[data-phone-frame]')].map(
				(frame) => {
					const r = frame.getBoundingClientRect()
					return {
						label: frame.getAttribute('aria-label'),
						shown: r.width > 0,
						left: r.left,
						right: r.right,
						width: r.width,
					}
				},
			)
			const plan = hero.querySelector('[data-phone-frame][role="img"]')!
			const bottom = (el: Element) => el.getBoundingClientRect().bottom
			const meals = plan.querySelectorAll('[data-mock-meal]')
			return {
				cut,
				frames,
				dayHeading: bottom(plan.querySelector('[data-day-heading]')!),
				secondMeal: bottom(meals[1]!),
				thirdMeal: {
					top: meals[2]!.getBoundingClientRect().top,
					bottom: bottom(meals[2]!),
				},
			}
		})
}

for (const layout of [320, 390, 640, 1024, 1280]) {
	test(`the hero's cut falls below the Plan's day and first two Meals at ${layout}px`, async ({
		page,
	}) => {
		await openAt(page, layout)
		const hero = await heroPhones(page)
		expect(hero.dayHeading).toBeLessThan(hero.cut)
		expect(hero.secondMeal).toBeLessThan(hero.cut)
		// It cuts through the third, so no bare screen shows above the cut.
		expect(hero.thirdMeal.top).toBeLessThan(hero.cut)
		expect(hero.thirdMeal.bottom).toBeGreaterThan(hero.cut)
	})
}

test('the hero shows Plan alone on a phone and Plan in front of Shopping from 640px', async ({
	page,
}) => {
	await openAt(page, 390)
	let hero = await heroPhones(page)
	expect(hero.frames.filter((frame) => frame.shown)).toHaveLength(1)

	await openAt(page, 640)
	hero = await heroPhones(page)
	const [shopping, plan] = hero.frames
	expect(shopping!.shown && plan!.shown).toBe(true)
	// Shopping sits up and to the right, its left third under the Plan.
	const covered = (plan!.right - shopping!.left) / shopping!.width
	expect(covered).toBeGreaterThan(0.25)
	expect(covered).toBeLessThan(0.4)
})

test('the hero reads as one picture, and Shopping as one, in the steps', async ({
	page,
}) => {
	await openAt(page, 1280)
	const hero = page.locator('main > div > section').first()
	await expect(hero.getByRole('img')).toHaveCount(1)
	await expect(hero.getByRole('img')).toHaveAccessibleName(
		/^The Plan on a phone/,
	)
	await expect(
		page.getByRole('img', { name: /^Shopping on a phone/ }),
	).toHaveCount(1)
})

for (const layout of [390, 768, 1280]) {
	test(`the steps read Recipes, Plan, Staples, Shopping at ${layout}px`, async ({
		page,
	}) => {
		await openAt(page, layout)
		const steps = await page
			.locator('#how-it-works > div')
			.evaluateAll((items) =>
				items
					.map((item) => {
						const r = item.querySelector('h2')!.getBoundingClientRect()
						const phone = item.querySelector('[role="img"]')!
						return {
							heading: item.querySelector('h2')!.textContent,
							phone: phone.getAttribute('aria-label')!.split(' on a phone')[0],
							phoneAbove: phone.getBoundingClientRect().top < r.top,
							top: Math.round(r.top),
							left: Math.round(r.left),
						}
					})
					// Reading order: by row, then left to right.
					.sort((a, b) => a.top - b.top || a.left - b.left),
			)
		expect(steps.map(({ heading, phone }) => `${heading} | ${phone}`)).toEqual([
			'Your Recipes, in one place | A Recipe',
			'A week pencilled in | The Plan',
			'Minus what you already have | Staples',
			'Pick what you’ll buy | Shopping',
		])
		// One column on a phone puts each phone under its text; columns put it
		// on top.
		expect(steps.map((step) => step.phoneAbove)).toEqual(
			Array(4).fill(layout >= 640),
		)
	})
}

test('each step reads as its number, heading and text, then its picture', async ({
	page,
}) => {
	await openAt(page, 1280)
	const snapshot = await page.locator('#how-it-works').ariaSnapshot()
	const lines = snapshot
		.split('\n')
		.map(
			(line) => line.trim().replace(/^- '?/, '').split(':')[0]!.split(' ')[0],
		)
	// Four times over: the number and heading, the text, then the image.
	expect(lines.join(' ')).toBe(
		Array(4).fill('paragraph heading paragraph img').join(' '),
	)
})
