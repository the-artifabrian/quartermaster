import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { links } from '../root.tsx'
import {
	iosStartupImages,
	iosStartupScreens,
	launchThemes,
} from './pwa-launch.ts'

const splashDirectory = fileURLToPath(
	new URL('../../public/splash/', import.meta.url),
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

	test('keeps generated images and declarations in sync', async () => {
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

			const pixel = await sharp(path)
				.resize(1, 1)
				.removeAlpha()
				.raw()
				.toBuffer()
			expect([...pixel]).toEqual(rgb(launchThemes[image.theme].canvas))
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
