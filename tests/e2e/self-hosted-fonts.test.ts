import { expect, test } from '#tests/playwright-utils.ts'

// #346, 5.4: the fonts come from /assets, so a launch never waits on a
// cross-origin, render-blocking stylesheet.
test('the fonts are served from this origin, preloaded, and nothing is fetched from Google Fonts', async ({
	page,
}) => {
	const crossOrigin: string[] = []
	page.on('request', (request) => {
		const host = new URL(request.url()).hostname
		if (host.endsWith('googleapis.com') || host.endsWith('gstatic.com'))
			crossOrigin.push(request.url())
	})

	for (const path of ['/', '/login']) {
		await page.goto(path)
		await page.evaluate(() => document.fonts.ready)
	}
	expect(crossOrigin).toEqual([])

	const preloads = page.locator('link[rel="preload"][as="font"]')
	await expect(preloads).toHaveCount(2)
	for (const href of await preloads.evaluateAll((links) =>
		links.map((link) => link.getAttribute('href')),
	)) {
		expect(href).toMatch(/^\/assets\/.+\.woff2$/)
		const response = await page.request.get(href!)
		expect(response.status()).toBe(200)
		expect(response.headers()['content-type']).toContain('font/woff2')
	}
	const loaded = await page.evaluate(() =>
		[...document.fonts]
			.filter((face) => face.status === 'loaded')
			.map((face) => face.family.replace(/"/g, '')),
	)
	expect(loaded).toEqual(expect.arrayContaining(['DM Sans', 'Young Serif']))
})
