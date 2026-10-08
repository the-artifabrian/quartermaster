import { describe, expect, test } from 'vitest'
import {
	downscaleImageToFit,
	MAX_DOWNSCALED_EDGE,
	type DecodeImage,
} from './downscale-image.ts'

const MB = 1024 * 1024

function photo(bytes: number, name = 'IMG_0001.JPG', type = 'image/jpeg') {
	return new File([new Uint8Array(bytes)], name, { type })
}

/**
 * A decoder whose JPEG output size is `bytesPerPixel` times the area it is
 * asked to draw, and that records every size it was asked for.
 */
function fakeDecoder(width: number, height: number, bytesPerPixel: number) {
	const requested: Array<[number, number]> = []
	const decode: DecodeImage = async () => ({
		width,
		height,
		async toJpeg(w, h) {
			requested.push([w, h])
			return new Blob([new Uint8Array(Math.round(w * h * bytesPerPixel))], {
				type: 'image/jpeg',
			})
		},
		close() {},
	})
	return { decode, requested }
}

describe('downscaleImageToFit', () => {
	test('returns a photo under the limit untouched', async () => {
		const file = photo(2 * MB, 'pasta.png', 'image/png')
		const { decode, requested } = fakeDecoder(4000, 3000, 1)
		expect(await downscaleImageToFit(file, 3 * MB, decode)).toBe(file)
		expect(requested).toEqual([])
	})

	test('returns a photo exactly at the limit untouched', async () => {
		const file = photo(3 * MB)
		const { decode } = fakeDecoder(4000, 3000, 1)
		expect(await downscaleImageToFit(file, 3 * MB, decode)).toBe(file)
	})

	test('re-encodes an oversized photo as a JPEG under the limit', async () => {
		const file = photo(5 * MB, 'IMG_0001.HEIC.png', 'image/png')
		const { decode } = fakeDecoder(4032, 3024, 0.3)
		const result = await downscaleImageToFit(file, 3 * MB, decode)
		expect(result).not.toBe(file)
		expect(result.size).toBeLessThanOrEqual(3 * MB)
		expect(result.type).toBe('image/jpeg')
		expect(result.name).toBe('IMG_0001.HEIC.jpg')
	})

	test('names an extensionless photo with .jpg', async () => {
		const file = photo(5 * MB, 'photo')
		const { decode } = fakeDecoder(4032, 3024, 0.3)
		const result = await downscaleImageToFit(file, 3 * MB, decode)
		expect(result.name).toBe('photo.jpg')
	})

	test('caps the longest edge and keeps the aspect ratio', async () => {
		const { decode, requested } = fakeDecoder(3024, 4032, 0.1)
		await downscaleImageToFit(photo(5 * MB), 3 * MB, decode)
		const [w, h] = requested[0]!
		expect(h).toBe(MAX_DOWNSCALED_EDGE)
		expect(w / h).toBeCloseTo(3024 / 4032, 2)
	})

	test('does not upscale a small photo that is large on disk', async () => {
		const { decode, requested } = fakeDecoder(64, 48, 1)
		const result = await downscaleImageToFit(photo(4 * MB), 3 * MB, decode)
		expect(requested[0]).toEqual([64, 48])
		expect(result.size).toBeLessThanOrEqual(3 * MB)
	})

	test('shrinks further while the encoded photo is still over the limit', async () => {
		// 2048×1536 at 2 bytes per pixel is 6 MB, so the first try fails.
		const { decode, requested } = fakeDecoder(4032, 3024, 2)
		const result = await downscaleImageToFit(photo(8 * MB), 3 * MB, decode)
		expect(requested.length).toBeGreaterThan(1)
		const [w1] = requested[0]!
		const [w2] = requested[1]!
		expect(w2).toBeLessThan(w1)
		expect(result.size).toBeLessThanOrEqual(3 * MB)
	})

	test('returns the original when no size fits, so the server can say why', async () => {
		const file = photo(5 * MB)
		const { decode } = fakeDecoder(4032, 3024, 1000)
		expect(await downscaleImageToFit(file, 3 * MB, decode)).toBe(file)
	})

	test('returns the original when the browser cannot decode it', async () => {
		const file = photo(5 * MB)
		const decode: DecodeImage = async () => {
			throw new Error('unsupported')
		}
		expect(await downscaleImageToFit(file, 3 * MB, decode)).toBe(file)
	})

	test('leaves a file that is not an image alone', async () => {
		const file = photo(5 * MB, 'notes.txt', 'text/plain')
		const { decode, requested } = fakeDecoder(4000, 3000, 0.1)
		expect(await downscaleImageToFit(file, 3 * MB, decode)).toBe(file)
		expect(requested).toEqual([])
	})
})
