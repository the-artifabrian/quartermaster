import { type Page } from '@playwright/test'
import { expect, test } from '#tests/playwright-utils.ts'

// The fonts come from /assets, so a launch never waits on a
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
	}
	expect(crossOrigin).toEqual([])
})

/** Opens `path` and reports the font files it fetched and preloaded. */
async function fontsOn(page: Page, path: string) {
	const fetched: string[] = []
	const onRequest = (request: { url(): string }) => {
		const file = new URL(request.url()).pathname.split('/').at(-1) ?? ''
		if (file.endsWith('.woff2')) fetched.push(file)
	}
	page.on('request', onRequest)
	await page.goto(path)
	await page.evaluate(() => document.fonts.ready)
	page.off('request', onRequest)
	const preloaded = await page
		.locator('link[rel="preload"][as="font"]')
		.evaluateAll((links) =>
			links.map((link) => link.getAttribute('href')!.split('/').at(-1)!),
		)
	return { fetched, preloaded }
}

const face = (name: string) => new RegExp(`^${name}-[\\w-]+\\.woff2$`)

test('the homepage keeps Young Serif, DM Sans and its espresso Log in', async ({
	page,
}) => {
	const { fetched, preloaded } = await fontsOn(page, '/')
	expect(preloaded).toEqual([
		expect.stringMatching(face('dm-sans-latin')),
		expect.stringMatching(face('young-serif-latin')),
	])
	expect(fetched.filter((file) => /newsreader|schibsted/.test(file))).toEqual(
		[],
	)

	const styles = await page.evaluate(() => {
		const family = (el: Element | null) =>
			el
				? getComputedStyle(el).fontFamily.split(',')[0]!.replace(/"/g, '')
				: null
		const logIn = document.querySelector('[data-site-header] a[href="/login"]')
		return {
			headline: family(document.querySelector('main h1')),
			headlineWeight: getComputedStyle(document.querySelector('main h1')!)
				.fontWeight,
			// Inherited, as most of the page's text is.
			body: family(document.querySelector('footer nav a')),
			logo: family(
				document.querySelector('[data-site-header] a[href="/"] span'),
			),
			logIn: logIn ? getComputedStyle(logIn).backgroundColor : null,
		}
	})
	expect(styles).toEqual({
		headline: 'Young Serif',
		headlineWeight: '400',
		body: 'DM Sans',
		logo: 'DM Sans',
		// espresso-raised
		logIn: 'rgb(65, 55, 41)',
	})
})

test('an app page sets Newsreader and Schibsted Grotesk and never loads the homepage faces', async ({
	page,
}) => {
	const { fetched, preloaded } = await fontsOn(page, '/login')
	expect(preloaded).toEqual([
		expect.stringMatching(face('schibsted-grotesk-latin')),
		expect.stringMatching(face('newsreader-latin')),
	])
	expect(
		fetched.filter((file) => /young-serif|dm-sans|source-sans/.test(file)),
	).toEqual([])

	const styles = await page.evaluate(() => {
		const style = (el: Element | null) => getComputedStyle(el!)
		const h1 = style(document.querySelector('main h1'))
		return {
			title: h1.fontFamily.split(',')[0]!.replace(/"/g, ''),
			titleWeight: h1.fontWeight,
			titleFigures: h1.fontVariantNumeric,
			body: style(document.querySelector('main label'))
				.fontFamily.split(',')[0]!
				.replace(/"/g, ''),
			signUp: style(
				document.querySelector('[data-site-header] a[href="/signup"]'),
			).backgroundColor,
		}
	})
	expect(styles).toEqual({
		title: 'Newsreader',
		titleWeight: '500',
		titleFigures: 'lining-nums',
		body: 'Schibsted Grotesk',
		// The green fill
		signUp: 'rgb(31, 90, 61)',
	})
})
