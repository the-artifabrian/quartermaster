import { type Page, type PlaywrightWorkerArgs } from '@playwright/test'
import { formatMonthDay, parseDate, todayInTimeZone } from '#app/utils/date.ts'
import { expect, test, waitForHydration } from '#tests/playwright-utils.ts'

// On a first visit the hint check writes its cookies and reloads the page,
// and Chromium can send that reload before it has stored them. These tests
// make that happen every time: the reload of the page reaches the server
// without the cookies named, through a request of its own.
async function sendReloadWithout(
	page: Page,
	playwright: PlaywrightWorkerArgs['playwright'],
	dropped: (name: string) => boolean,
) {
	const request = await playwright.request.newContext()
	let documents = 0
	await page.route(
		(url) => url.pathname === '/',
		async (route) => {
			if (route.request().resourceType() !== 'document') {
				return route.fallback()
			}
			documents += 1
			const headers = { ...(await route.request().allHeaders()) }
			const cookie = (headers.cookie ?? '')
				.split(';')
				.map((part) => part.trim())
				.filter((part) => part && !dropped(part.split('=')[0]!))
				.join('; ')
			if (cookie) headers.cookie = cookie
			else delete headers.cookie
			const response = await request.fetch(route.request(), { headers })
			await route.fulfill({ response })
		},
	)
	return {
		documents: () => documents,
		[Symbol.asyncDispose]: () => request.dispose(),
	}
}

/** Data requests the page makes after its documents. */
function countDataRequests(page: Page) {
	const urls: string[] = []
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.endsWith('.data')) {
			urls.push(request.url())
		}
	})
	return urls
}

test.describe('a first visit a day off UTC', () => {
	// A zone on another date than UTC right now (see marketing-pages).
	const timeZone =
		todayInTimeZone('Pacific/Kiritimati') !== todayInTimeZone('UTC')
			? 'Pacific/Kiritimati'
			: 'Pacific/Pago_Pago'
	test.use({ timezoneId: timeZone })

	test('shows the visitor’s day when the reload lost the time zone', async ({
		page,
		playwright,
	}) => {
		await using reload = await sendReloadWithout(
			page,
			playwright,
			(name) => name === 'CH-time-zone',
		)
		const dataRequests = countDataRequests(page)
		const today = parseDate(todayInTimeZone(timeZone))

		await page.goto('/')
		await waitForHydration(page)
		// The reload happened and reached the server without the zone.
		expect(reload.documents()).toBe(2)
		await expect(
			page.getByRole('img', {
				name: `The Plan on a phone: today, `,
				exact: false,
			}),
		).toHaveAccessibleName(new RegExp(`, ${formatMonthDay(today)}, `))
		// One load more, and no more after it.
		await page.waitForTimeout(500)
		expect(dataRequests).toHaveLength(1)
	})
})

test.describe('a first visit with a dark system', () => {
	test.use({ colorScheme: 'dark' })

	test('ends dark when the reload lost every hint', async ({
		page,
		playwright,
	}) => {
		await using reload = await sendReloadWithout(page, playwright, (name) =>
			name.startsWith('CH-'),
		)
		await page.goto('/')
		await waitForHydration(page)
		expect(reload.documents()).toBe(2)
		await expect(page.locator('html')).toHaveClass(/\bdark\b/)
	})
})
