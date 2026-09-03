import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { links } from '../root.tsx'
import {
	iosStartupImages,
	iosStartupLogoScale,
	iosStartupScreens,
	launchThemes,
} from './pwa-launch.ts'

const splashDirectory = fileURLToPath(
	new URL('../../public/splash/', import.meta.url),
)
const canonicalLogoPath = fileURLToPath(
	new URL('../assets/favicons/favicon.svg', import.meta.url),
)

function filename(href: string) {
	const value = href.split('/').at(-1)
	if (!value) throw new Error(`Invalid startup-image path: ${href}`)
	return value
}

function rgb(hex: string) {
	return [1, 3, 5].map((offset) =>
		Number.parseInt(hex.slice(offset, offset + 2), 16),
	)
}

async function renderCanonicalLogo(size: number, background: string) {
	const logo = await sharp(canonicalLogoPath)
		.resize(size, size)
		.png()
		.toBuffer()

	return sharp({
		create: { width: size, height: size, channels: 3, background },
	})
		.composite([{ input: logo }])
		.removeAlpha()
		.raw()
		.toBuffer()
}

describe('PWA launch configuration', () => {
	test('declares each configured startup image exactly once, including iPhone Air', () => {
		expect(iosStartupScreens).toContainEqual(
			expect.objectContaining({ width: 420, height: 912, dpr: 3 }),
		)

		const startupLinks = links().flatMap((link) => {
			if (
				!('rel' in link) ||
				link.rel !== 'apple-touch-startup-image' ||
				!('href' in link)
			) {
				return []
			}
			return [
				{
					rel: link.rel,
					href: link.href,
					media: 'media' in link ? link.media : undefined,
				},
			]
		})
		expect(startupLinks).toEqual(
			iosStartupImages.map(({ href, media }) => ({
				rel: 'apple-touch-startup-image',
				href,
				media,
			})),
		)
		expect(new Set(startupLinks.map((link) => link.href)).size).toBe(
			startupLinks.length,
		)
	})

	test('keeps generated images, declarations, and canonical logo in sync', async () => {
		const expectedFiles = iosStartupImages
			.map(({ href }) => filename(href))
			.sort()
		const actualFiles = (await readdir(splashDirectory))
			.filter((file) => file.endsWith('.png'))
			.sort()

		expect(actualFiles).toEqual(expectedFiles)

		for (const image of iosStartupImages) {
			const path = `${splashDirectory}/${filename(image.href)}`
			const metadata = await sharp(path).metadata()
			expect({ width: metadata.width, height: metadata.height }).toEqual({
				width: image.pixelWidth,
				height: image.pixelHeight,
			})

			const background = launchThemes[image.theme].canvas
			const cornerPixel = await sharp(path)
				.extract({ left: 0, top: 0, width: 1, height: 1 })
				.removeAlpha()
				.raw()
				.toBuffer()
			expect([...cornerPixel]).toEqual(rgb(background))

			const logoSize = Math.round(
				Math.min(image.pixelWidth, image.pixelHeight) * iosStartupLogoScale,
			)
			const left = Math.round((image.pixelWidth - logoSize) / 2)
			const top = Math.round((image.pixelHeight - logoSize) / 2)
			const [actualLogo, expectedLogo] = await Promise.all([
				sharp(path)
					.extract({ left, top, width: logoSize, height: logoSize })
					.removeAlpha()
					.raw()
					.toBuffer(),
				renderCanonicalLogo(logoSize, background),
			])
			expect(Buffer.compare(actualLogo, expectedLogo)).toBe(0)
		}
	})

	test('keeps static launch surfaces aligned with the shared palette', async () => {
		const [manifestSource, css, worker] = await Promise.all([
			readFile(
				new URL('../../public/site.webmanifest', import.meta.url),
				'utf8',
			),
			readFile(new URL('../styles/tailwind.css', import.meta.url), 'utf8'),
			readFile(new URL('../../public/sw.js', import.meta.url), 'utf8'),
		])
		const manifest = JSON.parse(manifestSource) as Record<string, unknown>

		expect(manifest.background_color).toBe(launchThemes.light.canvas)
		expect(manifest.theme_color).toBe(launchThemes.light.canvas)
		expect(manifest).not.toHaveProperty('orientation')

		expect(css).toContain(`--background: ${launchThemes.light.canvas}`)
		expect(css).toContain(`--foreground: ${launchThemes.light.foreground}`)
		expect(css).toContain(`--background: ${launchThemes.dark.canvas}`)
		expect(css).toContain(`--foreground: ${launchThemes.dark.foreground}`)

		for (const palette of Object.values(launchThemes)) {
			expect(worker).toContain(palette.canvas)
			expect(worker).toContain(palette.foreground)
			expect(worker).toContain(palette.mutedForeground)
		}
	})
})
