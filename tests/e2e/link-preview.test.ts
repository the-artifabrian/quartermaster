import { expect, test } from '@playwright/test'

/* eslint-disable playwright/no-raw-locators -- this test inspects document head metadata */

// A link to a public page, pasted into Slack, LinkedIn or iMessage, unfurls
// with the preview image. Each marketing page's meta replaces root's, so each
// one has to carry the image tags itself.
for (const path of ['/', '/about', '/support', '/privacy', '/tos']) {
	test(`${path} links unfurl with the preview image`, async ({ page }) => {
		await page.goto(path)

		const ogImage = page.locator('meta[property="og:image"]')
		await expect(ogImage).toHaveCount(1)
		const imageUrl = await ogImage.getAttribute('content')
		expect(imageUrl).toMatch(/^https?:\/\/.+\/og-image\.png$/)
		await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
			'content',
			'summary_large_image',
		)

		const image = await page.request.get(new URL(imageUrl!).pathname)
		expect(image.ok()).toBe(true)
		expect(image.headers()['content-type']).toBe('image/png')
	})
}
