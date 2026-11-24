import { type Page } from '@playwright/test'
import { expect, test } from '#tests/playwright-utils.ts'

// Failure list for the public pages' links to the source code:
// - a marketing page's footer has no link to the source (the footer is
//   shared, but a page can leave the layout);
// - the link points at the wrong place (a typo, another repo, a relative
//   path);
// - the link shows different words, or only an icon, so a reader can't tell
//   where it goes;
// - a fifth footer link pushes the row wider than a 390px phone, so a link
//   runs off either edge or the page scrolls sideways;
// - About leaves out the sentence that the app is open source, or links it
//   somewhere else.

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
