import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {
	SAMPLE_HOUSEHOLD,
	type SampleHouseholdContent,
} from '#app/utils/sample-household-data.ts'

/**
 * Writes a tiny WebP for every photo the content names, so the demo template
 * builds in tests and e2e runs without the real stock photos. Each file gets
 * its own colour; `shade` changes them all, standing in for new photos.
 */
export async function writeTinyDemoPhotos(
	dir: string,
	{
		content = SAMPLE_HOUSEHOLD,
		shade = 0,
	}: { content?: SampleHouseholdContent; shade?: number } = {},
) {
	await fs.mkdir(dir, { recursive: true })
	const files = content.recipes.flatMap((recipe) =>
		recipe.photo ? [recipe.photo] : [],
	)
	for (const [index, file] of files.entries()) {
		await writeTinyPhoto(path.join(dir, file), index * 16 + shade)
	}
	return files
}

/** One 8 × 8 WebP of a single colour. */
export async function writeTinyPhoto(file: string, seed: number) {
	const bytes = await sharp({
		create: {
			width: 8,
			height: 8,
			channels: 3,
			background: {
				r: (seed * 37) % 256,
				g: (seed * 91) % 256,
				b: (seed * 53) % 256,
			},
		},
	})
		.webp({ lossless: true })
		.toBuffer()
	await fs.writeFile(file, bytes)
}
