// Failure list for the check a Recipe photo passes before it is stored (a
// stored file the image route can't decode answers every view with an error,
// and one that costs too much to decode can take the server's memory):
// - real JPEG, PNG and WebP photos pass, and keep the type of their bytes
// - the type comes from the bytes, never the browser's type or the name: a
//   JPEG sent as image/png or named .png is still a JPEG
// - a text file named .jpg and sent as image/jpeg is refused as unusable
// - an empty file is refused, and so is one shorter than any signature
// - a JPEG cut off partway is refused, though its header still reads
// - a PNG signature followed by anything else is refused
// - decoded size counts channels and bytes per sample: a PNG at the limit
//   passes and one row more is refused as too big, even as a small file;
//   the same pixels at 16 bits are refused
// - a progressive JPEG, an interlaced PNG or a WebP decodes whole, so it is
//   refused at a size its baseline or plain twin passes
// - a 48 MP phone photo, as a baseline JPEG, passes; one past the JPEG limit
//   is refused
// - a photo the browser leaves unshrunk stays under every limit
// - an iPhone HEIC is refused by its signature, whatever type it is sent as
// - formats sharp reads that the form doesn't offer (GIF, SVG, AVIF) are
//   refused
// The queue every photo job waits in:
// - two overlapping jobs run one at a time, in order
// - a job that waits past its limit never runs, and the queue carries on
// - a job whose request is aborted while it waits never runs
// - a job that throws gives its turn to the next
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp, { type Sharp } from 'sharp'
import { describe, expect, test } from 'vitest'
import {
	checkRecipePhoto,
	MAX_DECODED_BYTES,
	MAX_JPEG_DECODED_BYTES,
	MAX_WHOLE_DECODED_BYTES,
	PhotoQueueTimeout,
	withPhotoSlot,
} from './recipe-photo.server.ts'
import { MAX_UNSHRUNK_PIXELS } from './recipe-validation.ts'

function upload(bytes: Uint8Array | string, name: string, type: string) {
	const part = typeof bytes === 'string' ? bytes : new Uint8Array(bytes)
	return new File([part], name, { type })
}

function solid(width = 40, height = 30) {
	return sharp({
		create: { width, height, channels: 3, background: '#c86b3c' },
		limitInputPixels: false,
	})
}

async function check(bytes: Uint8Array | string, name: string, type: string) {
	return checkRecipePhoto(upload(bytes, name, type))
}

const unusable = { ok: false, reason: 'unusable' }
const tooBig = { ok: false, reason: 'too-big' }

test.each([
	['JPEG', () => solid().jpeg().toBuffer(), 'image/jpeg', 'jpg'],
	['PNG', () => solid().png().toBuffer(), 'image/png', 'png'],
	['WebP', () => solid().webp().toBuffer(), 'image/webp', 'webp'],
])('a real %s passes', async (_, make, type, extension) => {
	const bytes = await make()
	const result = await check(bytes, `photo.${extension}`, type)
	expect(result).toMatchObject({ ok: true, photo: { type, extension } })
	if (!result.ok) return
	expect(Buffer.from(result.photo.bytes).equals(bytes)).toBe(true)
})

test('takes the type from the bytes, not the browser or the name', async () => {
	const jpeg = await solid().jpeg().toBuffer()
	expect(await check(jpeg, 'photo.png', 'image/png')).toMatchObject({
		ok: true,
		photo: { type: 'image/jpeg', extension: 'jpg' },
	})
})

test('refuses a text file named .jpg and sent as a JPEG', async () => {
	expect(
		await check('Grandma’s soup, serves 4', 'soup.jpg', 'image/jpeg'),
	).toEqual(unusable)
})

test.each([
	['an empty file', new Uint8Array(0)],
	['a bare JPEG signature', new Uint8Array([0xff, 0xd8, 0xff])],
])('refuses %s', async (_, bytes) => {
	expect(await check(bytes, 'photo.jpg', 'image/jpeg')).toEqual(unusable)
})

test('refuses a JPEG cut off partway', async () => {
	const jpeg = await solid(400, 300).jpeg().toBuffer()
	const cut = jpeg.subarray(0, Math.floor(jpeg.length * 0.6))
	// The header survives the cut, so only a decode can tell.
	expect((await sharp(cut).metadata()).width).toBe(400)
	expect(await check(cut, 'photo.jpg', 'image/jpeg')).toEqual(unusable)
})

test('refuses a PNG signature followed by anything else', async () => {
	const bytes = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		Buffer.alloc(64, 7),
	])
	expect(await check(bytes, 'photo.png', 'image/png')).toEqual(unusable)
})

describe('decoded size', () => {
	// An 8-bit RGB PNG at exactly the limit, then one row taller.
	const width = 4096
	const height = Math.floor(MAX_DECODED_BYTES / (width * 3))

	test('passes a PNG at the limit and refuses one row more, as small files', async () => {
		const atLimit = await solid(width, height).png().toBuffer()
		const over = await solid(width, height + 1)
			.png()
			.toBuffer()
		expect(width * height * 3).toBeLessThanOrEqual(MAX_DECODED_BYTES)
		expect(width * (height + 1) * 3).toBeGreaterThan(MAX_DECODED_BYTES)
		// The 3 MB upload limit alone would let both through.
		expect(over.byteLength).toBeLessThan(1024 * 1024)

		expect(await check(atLimit, 'big.png', 'image/png')).toMatchObject({
			ok: true,
		})
		expect(await check(over, 'bigger.png', 'image/png')).toEqual(tooBig)
	})

	test('counts the bytes per sample: the same pixels at 16 bits are refused', async () => {
		// 8-bit: half the limit. 16-bit: just over it.
		const edge = Math.ceil(Math.sqrt(MAX_DECODED_BYTES / 6)) + 1
		const plain = await solid(edge, edge).png().toBuffer()
		const deep = await solid(edge, edge).toColourspace('rgb16').png().toBuffer()
		expect((await sharp(deep).metadata()).depth).toBe('ushort')

		expect(await check(plain, 'plain.png', 'image/png')).toMatchObject({
			ok: true,
		})
		expect(await check(deep, 'deep.png', 'image/png')).toEqual(tooBig)
	})

	test.each([
		[
			'a progressive JPEG',
			(s: Sharp) => s.jpeg(),
			(s: Sharp) => s.jpeg({ progressive: true }),
		],
		[
			'an interlaced PNG',
			(s: Sharp) => s.png(),
			(s: Sharp) => s.png({ progressive: true }),
		],
		['a WebP', (s: Sharp) => s.png(), (s: Sharp) => s.webp()],
	])('refuses %s at a size its plain twin passes', async (_, plain, whole) => {
		// Over the limit for decoding whole, under the others.
		const edge = Math.ceil(Math.sqrt(MAX_WHOLE_DECODED_BYTES / 3)) + 1
		expect(edge * edge * 3).toBeLessThan(MAX_DECODED_BYTES)
		const plainBytes = await plain(solid(edge, edge)).toBuffer()
		const wholeBytes = await whole(solid(edge, edge)).toBuffer()

		expect(await check(plainBytes, 'plain', 'image/png')).toMatchObject({
			ok: true,
		})
		expect(await check(wholeBytes, 'whole', 'image/png')).toEqual(tooBig)
	})

	test('passes a 48 MP phone photo and refuses a JPEG past the limit', async () => {
		const photo = await solid(8064, 6048).jpeg().toBuffer()
		const width = 8192
		const over = await solid(
			width,
			Math.floor(MAX_JPEG_DECODED_BYTES / (width * 3)) + 1,
		)
			.jpeg()
			.toBuffer()
		expect(await check(photo, 'IMG_0001.JPG', 'image/jpeg')).toMatchObject({
			ok: true,
		})
		expect(await check(over, 'scan.jpg', 'image/jpeg')).toEqual(tooBig)
	})

	test('keeps any 8-bit photo the browser leaves unshrunk under every limit', () => {
		// RGBA is the most an 8-bit photo holds per pixel.
		expect(MAX_UNSHRUNK_PIXELS * 4).toBeLessThanOrEqual(MAX_WHOLE_DECODED_BYTES)
	})
})

test('refuses an iPhone HEIC by its signature', async () => {
	const heic = await readFile(
		path.join(process.cwd(), 'tests/fixtures/photos/iphone.heic'),
	)
	expect(await check(heic, 'IMG_0001.HEIC', 'image/heic')).toEqual(unusable)
	// Sent with a JPEG's type it is still refused.
	expect(await check(heic, 'IMG_0001.jpg', 'image/jpeg')).toEqual(unusable)
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
	expect(await check(await make(), 'photo', type)).toEqual(unusable)
})

describe('the photo job queue', () => {
	function deferred() {
		let resolve!: () => void
		let reject!: (error: Error) => void
		const promise = new Promise<void>((res, rej) => {
			resolve = res
			reject = rej
		})
		return { promise, resolve, reject }
	}

	test('runs overlapping jobs one at a time, in order', async () => {
		const events: Array<string> = []
		const first = deferred()
		const job = (name: string, done?: Promise<void>) => async () => {
			events.push(`start ${name}`)
			await done
			events.push(`end ${name}`)
		}
		const a = withPhotoSlot(job('a', first.promise))
		const b = withPhotoSlot(job('b'))
		const c = withPhotoSlot(job('c'))
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(events).toEqual(['start a'])
		first.resolve()
		await Promise.all([a, b, c])
		expect(events).toEqual([
			'start a',
			'end a',
			'start b',
			'end b',
			'start c',
			'end c',
		])
	})

	test('a job that waits past its limit never runs, and the queue carries on', async () => {
		const first = deferred()
		const held = withPhotoSlot(() => first.promise)
		let ran = false
		await expect(
			withPhotoSlot(
				async () => {
					ran = true
				},
				{ waitMs: 20 },
			),
		).rejects.toBeInstanceOf(PhotoQueueTimeout)
		first.resolve()
		await held
		expect(ran).toBe(false)
		await expect(withPhotoSlot(async () => 'next')).resolves.toBe('next')
	})

	test('a job whose request is aborted while it waits never runs', async () => {
		const first = deferred()
		const held = withPhotoSlot(() => first.promise)
		const controller = new AbortController()
		let ran = false
		const waiting = withPhotoSlot(
			async () => {
				ran = true
			},
			{ signal: controller.signal },
		)
		controller.abort()
		await expect(waiting).rejects.toBeDefined()
		first.resolve()
		await held
		expect(ran).toBe(false)
		await expect(withPhotoSlot(async () => 'next')).resolves.toBe('next')
	})

	test('a job that throws gives its turn to the next', async () => {
		const failing = withPhotoSlot(async () => {
			throw new Error('decode failed')
		})
		const next = withPhotoSlot(async () => 'next')
		await expect(failing).rejects.toThrow('decode failed')
		await expect(next).resolves.toBe('next')
	})
})
