// Failure list for the public image route (no login in front of it):
// - a `src` naming a file in public/ that isn't an image (site.webmanifest)
//   must answer, not take the process down
// - a `src` naming another site must not make the server fetch it
// - a stored object whose bytes aren't an image must answer with an error,
//   not take the process down, and must keep doing so on a repeat
// - a valid stored image still serves, through the signed storage fetch
//   production uses (its origin must match the allowlist), and its AVIF
//   transform is cached under the source's own path
// Keys:
// - keys both writers produce (an upload, a copy) are served
// - anything else is refused with a 400, the same way in mocks mode and in
//   production mode: another prefix, a `..` or `.` segment, a dot in an id,
//   an extra or missing segment, a leading slash, an empty file name, a slash
//   still encoded after one decode, a backslash, a space, non-ASCII, a query
//   character, a file name too long to cache
// Sizes:
// - a listed size is served at exactly that size
// - an unlisted width is served at the next listed size up, and one past the
//   largest at the largest; these share the listed size's cached copy rather
//   than adding one per width asked for
// - a width or a height on its own is snapped too, so it can't make a
//   full-size copy per number
// - no size at all serves the original (the data export links to it), but a
//   format with no size is refused, since nothing asks for a full-size
//   re-encode
// - a format or fit the app never asks for is refused
// - a width that isn't a positive whole number is refused
// Deleting a photo:
// - its cached resizes go with it, so it stops being served, in mocks mode
//   and through storage; another photo's resizes stay
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { RouterContextProvider } from 'react-router'
import sharp from 'sharp'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { deleteRecipeImage } from '#app/utils/storage.server.ts'
import '#tests/setup/mocks-setup.ts'
import { loader } from './images.tsx'

const BASE_URL = 'https://useqm.app'
const CACHE_FOLDER = './tests/fixtures/openimg'
const PHOTO = 'users/fixture-user/recipes/fixture-recipe/images/0.png'
const OTHER_PHOTO = 'users/fixture-user/recipes/fixture-recipe/images/1.png'

afterEach(() => {
	vi.unstubAllEnvs()
})

async function request(params: Record<string, string>) {
	const url = new URL(`${BASE_URL}/resources/images`)
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value)
	}
	return loader({
		request: new Request(url),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/resources/images',
		url,
	}).catch((error: unknown) => error)
}

// In MOCKS mode a stored object is read from tests/fixtures, the way the
// dev server and the e2e suite serve them.
function storedImage(
	objectKey: string,
	extra: Record<string, string> = { w: '72', h: '72' },
) {
	vi.stubEnv('MOCKS', 'true')
	return request({ objectKey, ...extra })
}

function status(result: unknown) {
	expect(result).toBeInstanceOf(Response)
	return (result as Response).status
}

async function dimensions(result: unknown) {
	expect(status(result)).toBe(200)
	const body = Buffer.from(await (result as Response).arrayBuffer())
	const { width, height, format } = await sharp(body).metadata()
	return { width, height, format }
}

async function listFiles(directory: string): Promise<Array<string>> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(
		() => [],
	)
	const nested = await Promise.all(
		entries.map((entry) =>
			entry.isDirectory()
				? listFiles(path.join(directory, entry.name))
				: [path.join(directory, entry.name)],
		),
	)
	return nested.flat()
}

/** Cached resizes of a stored object, matched by its slugged file name. */
async function cachedResizes(objectKey: string) {
	const slug = path.join(
		path.dirname(objectKey),
		path.basename(objectKey).replaceAll('.', '-') + '-w-',
	)
	return (await listFiles(CACHE_FOLDER)).filter((file) => file.includes(slug))
}

async function clearCachedResizes(objectKey: string) {
	for (const file of await cachedResizes(objectKey)) await rm(file)
}

/** A copy of a fixture photo in the mock bucket, removed on dispose. */
async function uploadedPhoto(name: string) {
	const objectKey = `users/image-route-${name}/recipes/r1/images/1732000000000-${name}.png`
	const uploads = './tests/fixtures/uploaded'
	await mkdir(path.join(uploads, path.dirname(objectKey)), { recursive: true })
	await copyFile(
		path.join('./tests/fixtures/images', OTHER_PHOTO),
		path.join(uploads, objectKey),
	)
	return {
		objectKey,
		async [Symbol.asyncDispose]() {
			await clearCachedResizes(objectKey)
			await rm(path.join(uploads, `users/image-route-${name}`), {
				recursive: true,
				force: true,
			})
		},
	}
}

test.each([
	['a non-image file in public', '/site.webmanifest'],
	['an image in public', '/og-image.png'],
	['another site', 'https://example.com/photo.png'],
	['a path that climbs out of public', `/../tests/fixtures/images/${PHOTO}`],
])('refuses a src naming %s', async (_, src) => {
	const response = await request({ src, w: '72', h: '72' })
	expect(status(response)).toBe(400)
})

test('answers with an error for a stored object that is not an image, every time', async () => {
	const directory = './tests/fixtures/uploaded/users/image-route-test'
	const objectKey =
		'users/image-route-test/recipes/r1/images/1732000000000-broken.jpg'
	await mkdir(path.join('./tests/fixtures/uploaded', path.dirname(objectKey)), {
		recursive: true,
	})
	// A JPEG signature followed by text: passes a type check, fails to decode.
	await writeFile(
		path.join('./tests/fixtures/uploaded', objectKey),
		Buffer.concat([
			Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
			Buffer.from('this is not a photo'),
		]),
	)
	try {
		for (const attempt of [1, 2]) {
			const result = await storedImage(objectKey, {
				w: '72',
				h: '72',
				format: 'webp',
			})
			expect(result, `attempt ${attempt}`).toBeInstanceOf(Error)
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

// The AVIF pipeline is the route's own (a lower encoder effort), so the
// cache must still file the result where openimg's default pipeline would:
// under the source's path, not a key of the pipeline's.
test('serves an AVIF transform of a stored image and caches it under the source image', async () => {
	await clearCachedResizes(PHOTO)
	const response = await storedImage(PHOTO, {
		w: '72',
		h: '72',
		format: 'avif',
	})
	expect(status(response)).toBe(200)
	expect((response as Response).headers.get('content-type')).toBe('image/avif')
	await (response as Response).arrayBuffer()
	const cached = (await cachedResizes(PHOTO)).filter((file) =>
		file.endsWith('.avif'),
	)
	expect(cached).toHaveLength(1)
})

test('serves a stored image through the signed storage fetch', async () => {
	vi.stubEnv('MOCKS', 'false')
	const response = await request({
		objectKey: OTHER_PHOTO,
		w: '72',
		h: '72',
		format: 'webp',
	})
	expect(status(response)).toBe(200)
	expect((response as Response).headers.get('content-type')).toBe('image/webp')
})

describe('object keys', () => {
	test.each([
		[
			'an upload',
			'users/cm3abc/recipes/cm3def/images/1732000000000-cm3ghi.jpg',
		],
		[
			'a copy',
			'users/cm3abc/recipes/cm3def/images/cm3jkl-1732000000000-cm3ghi.webp',
		],
		[
			'an id with a dash or an underscore',
			'users/user_1/recipes/r-2/images/a.png',
		],
	])('accepts the shape of %s', async (_, objectKey) => {
		// Not in the bucket, so openimg answers 404 once the key is accepted.
		expect(status(await storedImage(objectKey))).toBe(404)
	})

	const base = 'users/u1/recipes/r1/images'
	test.each([
		['another prefix', 'notes/0.png'],
		['a climb out of the folder', `${base}/../../../../package.json`],
		['a dot segment as the file', `${base}/..`],
		['a single dot as the file', `${base}/.`],
		['a file starting with a dot', `${base}/.env`],
		['a dot in an id', 'users/u1/recipes/../images/0.png'],
		['an extra segment', `${base}/sub/0.png`],
		['a missing images segment', 'users/u1/recipes/r1/0.png'],
		['a leading slash', `/${base}/0.png`],
		['a trailing slash', `${base}/0.png/`],
		['an empty file name', `${base}/`],
		['a slash still encoded', `${base}/a%2F..%2F0.png`],
		['a backslash', `${base}/a\\0.png`],
		['a space', `${base}/a b.png`],
		['a non-ASCII letter', `${base}/é.png`],
		['a query character', `${base}/0.png?x=1`],
		['a file name too long to cache', `${base}/${'a'.repeat(200)}.png`],
	])('refuses %s with a 400 in either storage mode', async (_, objectKey) => {
		for (const mocks of ['true', 'false']) {
			vi.stubEnv('MOCKS', mocks)
			const response = await request({ objectKey, w: '72', h: '72' })
			expect(status(response), `MOCKS=${mocks}`).toBe(400)
		}
	})
})

describe('sizes', () => {
	test.each([
		[
			{ w: '72', h: '72' },
			{ width: 72, height: 72 },
		],
		[
			{ w: '400', h: '300' },
			{ width: 400, height: 300 },
		],
		[
			{ w: '768', h: '576' },
			{ width: 768, height: 576 },
		],
		[
			{ w: '1200', h: '630', fit: 'cover' },
			{ width: 1200, height: 630 },
		],
	])('serves the listed size %o as asked', async (size, expected) => {
		const result = await dimensions(
			await storedImage(PHOTO, { ...size, format: 'webp' }),
		)
		expect(result).toMatchObject(expected)
	})

	test.each([
		['an unlisted width', { w: '700', h: '525' }, { width: 768, height: 576 }],
		[
			'a width past the largest',
			{ w: '16000', h: '16' },
			{ width: 1200, height: 630 },
		],
		['a width on its own', { w: '300' }, { width: 400, height: 300 }],
		['a height on its own', { h: '500' }, { width: 768, height: 576 }],
	])('serves %s at the next listed size up', async (_, size, expected) => {
		const result = await dimensions(
			await storedImage(PHOTO, { ...size, format: 'webp' }),
		)
		expect(result).toMatchObject(expected)
	})

	test('keeps one cached copy for every width that snaps to the same size', async () => {
		await clearCachedResizes(PHOTO)
		for (const w of ['700', '720', '768']) {
			const response = await storedImage(PHOTO, { w, h: '500', format: 'webp' })
			await (response as Response).arrayBuffer()
		}
		expect(await cachedResizes(PHOTO)).toEqual([
			expect.stringMatching(/0-png-w-768-h-576-fit-base\.webp$/),
		])
	})

	test('serves the original when no size is asked for', async () => {
		const result = await dimensions(await storedImage(PHOTO, {}))
		expect(result).toEqual({ width: 1024, height: 1024, format: 'png' })
	})

	test.each([
		['a format with no size', { format: 'avif' }],
		['a format the app never asks for', { w: '72', h: '72', format: 'png' }],
		[
			'another format the app never asks for',
			{ w: '72', h: '72', format: 'jpeg' },
		],
		['a fit the app never asks for', { w: '72', h: '72', fit: 'contain' }],
		['a width that is not a number', { w: 'wide', h: '72' }],
		['a width of zero', { w: '0', h: '72' }],
		['a negative width', { w: '-72', h: '72' }],
		['a fractional width', { w: '72.5', h: '72' }],
		['an empty width', { w: '', h: '72' }],
	])('refuses %s', async (_, params) => {
		expect(status(await storedImage(PHOTO, params))).toBe(400)
	})
})

describe('deleting a photo', () => {
	test.each([
		['mocks mode', 'true'],
		['storage', 'false'],
	])('stops serving its cached resizes (%s)', async (name, mocks) => {
		await using photo = await uploadedPhoto(
			mocks === 'true' ? 'mocks' : 'fetch',
		)
		vi.stubEnv('MOCKS', mocks)
		const sizes: Array<Record<string, string>> = [
			{ w: '72', h: '72' },
			{ w: '400', h: '300', format: 'webp' },
		]
		for (const size of sizes) {
			const response = await request({ objectKey: photo.objectKey, ...size })
			expect(status(response), name).toBe(200)
			await (response as Response).arrayBuffer()
		}
		const response = await request({ objectKey: PHOTO, w: '72', h: '72' })
		await (response as Response).arrayBuffer()
		const otherBefore = await cachedResizes(PHOTO)
		expect(await cachedResizes(photo.objectKey)).toHaveLength(2)

		await deleteRecipeImage(photo.objectKey)

		expect(await cachedResizes(photo.objectKey)).toEqual([])
		expect(
			status(await request({ objectKey: photo.objectKey, w: '72', h: '72' })),
		).toBe(404)
		expect(await cachedResizes(PHOTO)).toEqual(otherBefore)
	})
})
