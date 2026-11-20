// Failure list for the public image route (no login in front of it):
// - a `src` naming a file in public/ that isn't an image (site.webmanifest)
//   must answer, not take the process down
// - a `src` naming another site must not make the server fetch it
// - a stored object whose bytes aren't an image must answer with an error,
//   not take the process down, and must keep doing so on a repeat
// - an oversized width or height must be refused before sharp allocates it
// - a valid stored image still serves, and its AVIF transform is cached
//   under the source's own path
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { RouterContextProvider } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { loader } from './images.tsx'

const BASE_URL = 'https://useqm.app'

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
function storedImage(objectKey: string, extra: Record<string, string> = {}) {
	vi.stubEnv('MOCKS', 'true')
	return request({ objectKey, w: '16', h: '16', ...extra })
}

test.each([
	['a non-image file in public', '/site.webmanifest'],
	['an image in public', '/og-image.png'],
	['another site', 'https://example.com/photo.png'],
	['a path that climbs out of public', '/../tests/fixtures/images/notes/4.png'],
])('refuses a src naming %s', async (_, src) => {
	const response = await request({ src, w: '16', h: '16' })
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(400)
})

test('answers with an error for a stored object that is not an image, every time', async () => {
	const directory = './tests/fixtures/uploaded/image-route-test'
	await mkdir(directory, { recursive: true })
	// A JPEG signature followed by text: passes a type check, fails to decode.
	await writeFile(
		path.join(directory, 'not-an-image.jpg'),
		Buffer.concat([
			Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
			Buffer.from('this is not a photo'),
		]),
	)
	try {
		for (const attempt of [1, 2]) {
			const result = await storedImage('image-route-test/not-an-image.jpg', {
				format: 'webp',
			})
			if (result instanceof Response) {
				expect(result.status, `attempt ${attempt}`).toBeGreaterThanOrEqual(400)
			} else {
				expect(result, `attempt ${attempt}`).toBeInstanceOf(Error)
			}
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test.each([
	['width', { w: '16000', h: '16' }],
	['height', { w: '16', h: '16000' }],
	['non-numeric width', { w: 'wide', h: '16' }],
])('refuses an oversized %s', async (_, size) => {
	const response = await storedImage('notes/0.png', size)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(400)
})

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

// The AVIF pipeline is the route's own (a lower encoder effort), so the
// cache must still file the result where openimg's default pipeline would:
// under the source's path, not a key of the pipeline's.
test('serves an AVIF transform of a stored image and caches it under the source image', async () => {
	const cacheFolder = './tests/fixtures/openimg'
	for (const file of await listFiles(cacheFolder)) {
		if (file.includes(path.join('notes', '0-png'))) await rm(file)
	}
	const response = await storedImage('notes/0.png', { format: 'avif' })
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(200)
	expect((response as Response).headers.get('content-type')).toBe('image/avif')
	await (response as Response).arrayBuffer()
	const cached = (await listFiles(cacheFolder)).filter(
		(file) => file.includes(path.join('notes', '0-png')) && file.endsWith('.avif'),
	)
	expect(cached).toHaveLength(1)
})
