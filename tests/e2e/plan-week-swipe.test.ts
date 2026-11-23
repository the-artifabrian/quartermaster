import { type Locator, type Page } from '@playwright/test'
import { expect, hydrated, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function swipe(
	page: Page,
	target: Locator,
	{
		fromX,
		toX,
		ms,
		holdMs = 0,
		steps = 12,
	}: {
		fromX: number
		toX: number
		ms: number
		holdMs?: number
		steps?: number
	},
) {
	const box = (await target.boundingBox())!
	const y = box.y + box.height / 2
	const cdp = await page.context().newCDPSession(page)
	const point = (x: number) => [{ x: box.x + box.width * x, y, id: 1 }]
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: point(fromX),
	})
	for (let i = 1; i <= steps; i++) {
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: point(fromX + ((toX - fromX) * i) / steps),
		})
		await page.waitForTimeout(ms / steps)
	}
	if (holdMs) await page.waitForTimeout(holdMs)
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	})
	await cdp.detach()
}

test('swiping the Plan day strip turns the week; a short swipe does not', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/plan?weekStart=2026-11-16')
	const strip = page.locator('[data-slot="mobile-week-days"]')
	await expect(page.getByText('Nov 16 – 22')).toBeVisible()
	await hydrated(strip)
	await swipe(page, strip, { fromX: 0.2, toX: 0.8, ms: 240 })
	await expect(page).toHaveURL(/weekStart=2026-11-09/)
	await expect(page.getByText('Nov 9 – 15')).toBeVisible()

	await swipe(page, strip, { fromX: 0.8, toX: 0.2, ms: 240 })
	await expect(page).toHaveURL(/weekStart=2026-11-16/)
	await expect(page.getByText('Nov 16 – 22')).toBeVisible()

	// A short swipe, and a quick one held still before lifting, both snap
	// back. Navigation is async, so watch for it rather than for the URL.
	await hydrated(strip)
	const weekLoads: string[] = []
	page.on('request', (request) => {
		if (/weekStart=2026-11-(09|23)/.test(request.url())) {
			weekLoads.push(request.url())
		}
	})
	const settled = () =>
		expect
			.poll(() =>
				strip.evaluate((element) => getComputedStyle(element).transform),
			)
			.toBe('none')
	await swipe(page, strip, { fromX: 0.5, toX: 0.6, ms: 600 })
	await settled()
	await swipe(page, strip, {
		fromX: 0.5,
		toX: 0.7,
		ms: 0,
		steps: 3,
		holdMs: 400,
	})
	await settled()
	// Long enough for a navigation the swipe started to reach the network.
	await page.waitForTimeout(300)
	expect(weekLoads).toEqual([])
	await expect(page.getByText('Nov 16 – 22')).toBeVisible()

	// A tap still picks a day: one that isn't already picked, since the week
	// that holds today opens on today.
	const day = strip
		.getByRole('button', { name: /^Show .*, Nov \d+,/, pressed: false })
		.first()
	const name = (await day.getAttribute('aria-label'))!
	await day.click()
	await expect(
		strip.getByRole('button', { name, exact: true }),
	).toHaveAttribute('aria-pressed', 'true')
})
