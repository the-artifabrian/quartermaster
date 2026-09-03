import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { links } from '../root.tsx'
import { launchThemes } from './pwa-launch.ts'

type ManifestIcon = {
	src: string
	sizes: string
	type: string
	purpose?: string
}

type ManifestShortcut = {
	name: string
	short_name: string
	url: string
}

type WebManifest = {
	id: string
	name: string
	short_name: string
	lang: string
	start_url: string
	scope: string
	display: string
	description: string
	theme_color: string
	background_color: string
	icons: ManifestIcon[]
	shortcuts: ManifestShortcut[]
}

const manifestPath = new URL('../../public/site.webmanifest', import.meta.url)
const maskableIconPath = fileURLToPath(
	new URL('../../public/favicons/maskable-icon-512x512.png', import.meta.url),
)

async function readManifest() {
	return JSON.parse(await readFile(manifestPath, 'utf8')) as WebManifest
}

describe('PWA install metadata', () => {
	test('preserves app identity and adds concise in-scope shortcuts', async () => {
		const manifest = await readManifest()

		expect(manifest).toMatchObject({
			id: '/',
			name: 'Quartermaster',
			short_name: 'Quartermaster',
			lang: 'en',
			start_url: '/plan',
			scope: '/',
			display: 'standalone',
			theme_color: launchThemes.light.canvas,
			background_color: launchThemes.light.canvas,
		})
		expect(manifest.description).toBeTruthy()
		expect(manifest.shortcuts).toEqual([
			{ name: 'Plan', short_name: 'Plan', url: '/plan' },
			{ name: 'Shopping', short_name: 'Shopping', url: '/shopping' },
			{ name: 'Recipes', short_name: 'Recipes', url: '/recipes' },
		])
		for (const shortcut of manifest.shortcuts) {
			expect(new URL(shortcut.url, 'https://quartermaster.test').origin).toBe(
				'https://quartermaster.test',
			)
			expect(shortcut.url.startsWith(manifest.scope)).toBe(true)
		}
	})

	test('declares a separate safe-zone-aware maskable icon', async () => {
		const manifest = await readManifest()
		const maskable = manifest.icons.find((icon) => icon.purpose === 'maskable')

		expect(maskable).toEqual({
			src: '/favicons/maskable-icon-512x512.png',
			sizes: '512x512',
			type: 'image/png',
			purpose: 'maskable',
		})
		expect(maskable?.src).not.toBe('/favicons/android-chrome-512x512.png')

		const { data, info } = await sharp(maskableIconPath)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true })
		expect({ width: info.width, height: info.height }).toEqual({
			width: 512,
			height: 512,
		})

		const background = [...data.subarray(0, info.channels)]
		const center = info.width / 2
		const safeRadius = info.width * 0.4
		let unsafeArtworkPixels = 0
		for (let y = 0; y < info.height; y++) {
			for (let x = 0; x < info.width; x++) {
				const offset = (y * info.width + x) * info.channels
				const pixel = [...data.subarray(offset, offset + info.channels)]
				if (
					pixel.some((channel, index) => channel !== background[index]) &&
					Math.hypot(x + 0.5 - center, y + 0.5 - center) > safeRadius
				) {
					unsafeArtworkPixels++
				}
			}
		}
		expect(unsafeArtworkPixels).toBe(0)
	})

	test('keeps the dedicated Apple touch icon in document metadata', () => {
		const appleTouchIcon = links().find(
			(link) => 'rel' in link && link.rel === 'apple-touch-icon',
		)

		expect(appleTouchIcon).toMatchObject({ rel: 'apple-touch-icon' })
		expect(appleTouchIcon).toHaveProperty(
			'href',
			expect.stringContaining('apple-touch-icon'),
		)
		expect(appleTouchIcon).not.toHaveProperty(
			'href',
			'/favicons/maskable-icon-512x512.png',
		)
	})
})
