import { expect, test, type Page } from '@playwright/test'
import {
	getIosStartupImage,
	homepageCanvas,
	homepageForeground,
	iosStartupScreens,
	launchThemes,
	type LaunchTheme,
} from '../../app/utils/pwa-launch.ts'

/* eslint-disable playwright/no-raw-locators -- this test inspects document and head metadata */

const checks: Array<{
	theme: LaunchTheme
	viewport: { width: number; height: number }
}> = [
	{ theme: 'light', viewport: { width: 390, height: 844 } },
	{ theme: 'dark', viewport: { width: 420, height: 912 } },
]

for (const { theme, viewport } of checks) {
	test(`${theme} launch surface is ready at ${viewport.width}x${viewport.height}`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport)
		await page.emulateMedia({
			colorScheme: theme === 'light' ? 'dark' : 'light',
		})
		await page.context().addCookies([
			{
				name: 'en_theme',
				value: theme,
				domain: 'localhost',
				path: '/',
			},
		])

		const serverResponse = await page.request.get('/login')
		expect(serverResponse.ok()).toBe(true)
		const serverMarkup = await serverResponse.text()
		expect(serverMarkup).toContain(
			`<html lang="en" class="${theme} h-full overflow-x-hidden">`,
		)
		expect(serverMarkup).toContain(`data-pwa-launch-theme="${theme}"`)
		expect(serverMarkup).toContain(`background:${launchThemes[theme].canvas}`)

		await page.goto('/login')

		await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`))
		await expect(page.locator('html')).toHaveCSS(
			'background-color',
			theme === 'light' ? 'rgb(251, 251, 248)' : 'rgb(21, 21, 19)',
		)
		await expect(page.locator('body')).toHaveCSS(
			'background-color',
			theme === 'light' ? 'rgb(251, 251, 248)' : 'rgb(21, 21, 19)',
		)

		const criticalStyle = page.locator('style[data-pwa-launch-theme]')
		await expect(criticalStyle).toHaveAttribute('data-pwa-launch-theme', theme)
		expect(await criticalStyle.textContent()).toContain(
			launchThemes[theme].canvas,
		)

		const isBeforeStylesheet = async (selector: string) =>
			page
				.locator(selector)
				.evaluate((element) =>
					Boolean(
						element.compareDocumentPosition(
							document.querySelector('link[rel="stylesheet"]')!,
						) & Node.DOCUMENT_POSITION_FOLLOWING,
					),
				)
		expect(await isBeforeStylesheet('style[data-pwa-launch-theme]')).toBe(true)

		await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
			'content',
			'light dark',
		)
		expect(await isBeforeStylesheet('meta[name="color-scheme"]')).toBe(true)
		for (const [name, palette] of Object.entries(launchThemes)) {
			const themeColorSelector = `meta[name="theme-color"][media*="${name}"]`
			await expect(page.locator(themeColorSelector)).toHaveAttribute(
				'content',
				palette.canvas,
			)
			expect(await isBeforeStylesheet(themeColorSelector)).toBe(true)
		}

		const viewportContent = await page
			.locator('meta[name="viewport"]')
			.getAttribute('content')
		expect(viewportContent).not.toContain('maximum-scale')
		expect(viewportContent).not.toContain('user-scalable')

		const screen = iosStartupScreens.find(
			(candidate) =>
				candidate.width === viewport.width &&
				candidate.height === viewport.height,
		)
		expect(screen).toBeDefined()
		const image = getIosStartupImage(screen!, theme)
		await expect(
			page.locator(
				`link[rel="apple-touch-startup-image"][href="${image.href}"]`,
			),
		).toHaveAttribute('media', image.media)
	})
}

/** A hex colour as the browser computes it. */
function rgb(hex: string) {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
	return `rgb(${r}, ${g}, ${b})`
}

async function expectCanvas(page: Page, theme: LaunchTheme, homepage: boolean) {
	const canvas = homepage
		? homepageCanvas
		: {
				light: launchThemes.light.canvas,
				dark: launchThemes.dark.canvas,
			}
	await expect(page.locator('body')).toHaveCSS(
		'background-color',
		rgb(canvas[theme]),
	)
	// The text color outside the homepage's shell (the focused skip link).
	await expect(page.locator('body')).toHaveCSS(
		'color',
		rgb(homepage ? homepageForeground[theme] : launchThemes[theme].foreground),
	)
	for (const scheme of ['light', 'dark'] as const) {
		await expect(
			page.locator(`meta[name="theme-color"][media*="${scheme}"]`),
		).toHaveAttribute('content', canvas[scheme])
	}
}

for (const theme of ['light', 'dark'] as const) {
	test(`the homepage keeps its own canvas and toolbar tint, ${theme}, and hands the app's back on the way out`, async ({
		page,
	}) => {
		await page
			.context()
			.addCookies([
				{ name: 'en_theme', value: theme, domain: 'localhost', path: '/' },
			])
		await page.goto('/')
		await expectCanvas(page, theme, true)

		// Client-side, the values follow the page.
		const logIn = page
			.locator('[data-site-header]')
			.getByRole('link', { name: 'Log in' })
		await expect(page.locator('html')).toHaveAttribute('data-hydrated', '')
		await logIn.click()
		await expect(page).toHaveURL('/login')
		await expectCanvas(page, theme, false)

		await page
			.locator('[data-site-header]')
			.getByRole('link', { name: 'Quartermaster' })
			.click()
		await expect(page).toHaveURL('/')
		await expectCanvas(page, theme, true)
	})
}
