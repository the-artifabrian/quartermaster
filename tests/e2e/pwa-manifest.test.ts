import { expect, test } from '@playwright/test'

/* eslint-disable playwright/no-raw-locators -- this test inspects document head metadata */

test('Chromium accepts the manifest and its install icons', async ({
	page,
	context,
}) => {
	await page.goto('/login')
	await page.evaluate(() => navigator.serviceWorker.ready)

	const session = await context.newCDPSession(page)
	const browserManifest = await session.send('Page.getAppManifest')
	expect(new URL(browserManifest.url).pathname).toBe('/site.webmanifest')
	expect(browserManifest.errors).toEqual([])
	expect(browserManifest.data).toBeTruthy()

	const manifest = JSON.parse(browserManifest.data ?? '{}') as {
		icons: Array<{ src: string }>
	}
	for (const icon of manifest.icons) {
		const response = await page.request.get(icon.src)
		expect(response.ok(), `${icon.src} should load`).toBe(true)
		expect(response.headers()['content-type']).toBe('image/png')
	}

	const appleTouchIconLink = page.locator('link[rel="apple-touch-icon"]')
	await expect(appleTouchIconLink).toHaveAttribute('href', /apple-touch-icon/)
	const appleTouchIcon = await appleTouchIconLink.evaluate(
		(element: HTMLLinkElement) => element.href,
	)
	const appleResponse = await page.request.get(appleTouchIcon!)
	expect(appleResponse.ok()).toBe(true)
	expect(appleResponse.headers()['content-type']).toBe('image/png')

	const { installabilityErrors } = await session.send(
		'Page.getInstallabilityErrors',
	)
	expect(installabilityErrors).toEqual([])
})
