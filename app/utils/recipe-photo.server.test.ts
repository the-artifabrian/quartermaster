// Failure list for the check a Recipe photo passes before it is stored (a
// stored file the image route can't decode answers every view with an error):
// - real JPEG, PNG and WebP photos pass, and keep the type of their bytes
// - the type comes from the bytes, never the browser's type or the name: a
//   JPEG sent as image/png or named .png is still a JPEG
// - a text file named .jpg and sent as image/jpeg is refused
// - an empty file is refused, and so is one shorter than any signature
// - a JPEG cut off partway is refused, though its header still reads
// - a PNG signature followed by anything else is refused
// - a photo at the pixel cap passes; one pixel row over it is refused, even
//   as a small file
// - an iPhone HEIC is refused: sharp reads its header, but this build can't
//   decode it, so the image route couldn't show it
// - formats sharp reads that the form doesn't offer (GIF, SVG, AVIF) are
//   refused
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { expect, test } from 'vitest'
import { checkRecipePhoto, MAX_PHOTO_PIXELS } from './recipe-photo.server.ts'

const SQUARE_EDGE = Math.floor(Math.sqrt(MAX_PHOTO_PIXELS))

function upload(bytes: Uint8Array | string, name: string, type: string) {
	const part = typeof bytes === 'string' ? bytes : new Uint8Array(bytes)
	return new File([part], name, { type })
}

function solid(width = 40, height = 30) {
	return sharp({
		create: { width, height, channels: 3, background: '#c86b3c' },
	})
}

test.each([
	['JPEG', () => solid().jpeg().toBuffer(), 'image/jpeg', 'jpg'],
	['PNG', () => solid().png().toBuffer(), 'image/png', 'png'],
	['WebP', () => solid().webp().toBuffer(), 'image/webp', 'webp'],
])('a real %s passes', async (_, make, type, extension) => {
	const bytes = await make()
	const photo = await checkRecipePhoto(
		upload(bytes, `photo.${extension}`, type),
	)
	expect(photo).toMatchObject({ type, extension })
	expect(Buffer.from(photo!.bytes).equals(bytes)).toBe(true)
})

test('takes the type from the bytes, not the browser or the name', async () => {
	const jpeg = await solid().jpeg().toBuffer()
	const photo = await checkRecipePhoto(upload(jpeg, 'photo.png', 'image/png'))
	expect(photo).toMatchObject({ type: 'image/jpeg', extension: 'jpg' })
})

test('refuses a text file named .jpg and sent as a JPEG', async () => {
	const file = upload('Grandma’s soup, serves 4', 'soup.jpg', 'image/jpeg')
	expect(await checkRecipePhoto(file)).toBeNull()
})

test.each([
	['an empty file', new Uint8Array(0)],
	['a bare JPEG signature', new Uint8Array([0xff, 0xd8, 0xff])],
])('refuses %s', async (_, bytes) => {
	expect(
		await checkRecipePhoto(upload(bytes, 'photo.jpg', 'image/jpeg')),
	).toBeNull()
})

test('refuses a JPEG cut off partway', async () => {
	const jpeg = await solid(400, 300).jpeg().toBuffer()
	const cut = jpeg.subarray(0, Math.floor(jpeg.length * 0.6))
	// The header survives the cut, so only a decode can tell.
	expect((await sharp(cut).metadata()).width).toBe(400)
	expect(
		await checkRecipePhoto(upload(cut, 'photo.jpg', 'image/jpeg')),
	).toBeNull()
})

test('refuses a PNG signature followed by anything else', async () => {
	const bytes = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		Buffer.alloc(64, 7),
	])
	expect(
		await checkRecipePhoto(upload(bytes, 'photo.png', 'image/png')),
	).toBeNull()
})

test('passes a photo at the pixel cap and refuses one just over it', async () => {
	const atCap = await solid(SQUARE_EDGE, SQUARE_EDGE).png().toBuffer()
	const overCap = await solid(SQUARE_EDGE, SQUARE_EDGE + 1)
		.png()
		.toBuffer()
	expect(SQUARE_EDGE * SQUARE_EDGE).toBeLessThanOrEqual(MAX_PHOTO_PIXELS)
	expect(SQUARE_EDGE * (SQUARE_EDGE + 1)).toBeGreaterThan(MAX_PHOTO_PIXELS)
	// Small files: the size limit alone would let both through.
	expect(overCap.byteLength).toBeLessThan(1024 * 1024)

	expect(
		await checkRecipePhoto(upload(atCap, 'big.png', 'image/png')),
	).toMatchObject({ type: 'image/png' })
	expect(
		await checkRecipePhoto(upload(overCap, 'bigger.png', 'image/png')),
	).toBeNull()
})

test('refuses an iPhone HEIC', async () => {
	const heic = await readFile(
		path.join(process.cwd(), 'tests/fixtures/photos/iphone.heic'),
	)
	expect(
		await checkRecipePhoto(upload(heic, 'IMG_0001.HEIC', 'image/heic')),
	).toBeNull()
	// Sent with a JPEG's type it is still refused.
	expect(
		await checkRecipePhoto(upload(heic, 'IMG_0001.jpg', 'image/jpeg')),
	).toBeNull()
})

test.each([
	['GIF', () => solid().gif().toBuffer(), 'image/gif'],
	['AVIF', () => solid().avif().toBuffer(), 'image/avif'],
	[
		'SVG',
		async () =>
			Buffer.from(
				'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30"/></svg>',
			),
		'image/svg+xml',
	],
])('refuses a %s, which the form doesn’t offer', async (_, make, type) => {
	expect(await checkRecipePhoto(upload(await make(), 'photo', type))).toBeNull()
})
