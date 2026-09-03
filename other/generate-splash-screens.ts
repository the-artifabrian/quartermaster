/**
 * Generate branded iOS PWA startup images from the shared launch configuration.
 *
 * Run: bun other/generate-splash-screens.ts
 *
 * Output goes to public/splash/. These are committed so production builds do
 * not need Sharp or image generation.
 */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
	iosStartupImages,
	iosStartupLogoScale,
	launchThemes,
} from '../app/utils/pwa-launch.ts'

const outputDirectory = new URL('../public/splash/', import.meta.url)
const canonicalLogoPath = fileURLToPath(
	new URL('../app/assets/favicons/favicon.svg', import.meta.url),
)

async function main() {
	await mkdir(outputDirectory, { recursive: true })

	for (const image of iosStartupImages) {
		const filename = image.href.split('/').at(-1)
		if (!filename) throw new Error(`Invalid startup-image path: ${image.href}`)
		const logoSize = Math.round(
			Math.min(image.pixelWidth, image.pixelHeight) * iosStartupLogoScale,
		)
		const logo = await sharp(canonicalLogoPath)
			.resize(logoSize, logoSize)
			.png()
			.toBuffer()

		await sharp({
			create: {
				width: image.pixelWidth,
				height: image.pixelHeight,
				channels: 3,
				background: launchThemes[image.theme].canvas,
			},
		})
			.composite([
				{
					input: logo,
					left: Math.round((image.pixelWidth - logoSize) / 2),
					top: Math.round((image.pixelHeight - logoSize) / 2),
				},
			])
			.png()
			.toFile(fileURLToPath(new URL(filename, outputDirectory)))

		console.log(`Generated ${filename}`)
	}
}

await main()
