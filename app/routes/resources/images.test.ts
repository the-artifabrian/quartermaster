import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { loader } from './images.tsx'

const BASE_URL = 'https://useqm.app'

async function image(src: string, format?: string) {
	const url = new URL(`${BASE_URL}/resources/images`)
	url.searchParams.set('src', src)
	url.searchParams.set('w', '16')
	url.searchParams.set('h', '16')
	if (format) url.searchParams.set('format', format)
	return loader({
		request: new Request(url),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/resources/images',
		url,
	}).catch((error: unknown) => error)
}

// A real image outside public/, so a traversal that got through would serve it.
const OUTSIDE_PUBLIC = '/tests/fixtures/images/notes/4.png'

test.each([
	['out of public', `/..${OUTSIDE_PUBLIC}`],
	['out of the Vite assets folder', `/assets/..${OUTSIDE_PUBLIC}`],
	['through a nested folder', `/favicons/../..${OUTSIDE_PUBLIC}`],
	['with backslashes', `/..\\..${OUTSIDE_PUBLIC}`],
])('refuses a src that climbs %s', async (_, src) => {
	const response = await image(src)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(400)
})

test('serves an image from public', async () => {
	const response = await image('/og-image.png')
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(200)
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
test('serves an AVIF transform and caches it under the source image', async () => {
	const cacheFolder = './tests/fixtures/openimg'
	for (const file of await listFiles(cacheFolder)) {
		if (file.includes('og-image')) await rm(file)
	}
	const response = await image('/og-image.png', 'avif')
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(200)
	expect((response as Response).headers.get('content-type')).toBe('image/avif')
	await (response as Response).arrayBuffer()
	const cached = (await listFiles(cacheFolder)).filter(
		(file) => file.includes('og-image') && file.endsWith('.avif'),
	)
	expect(cached).toHaveLength(1)
	expect(cached[0]).toContain(path.join('public', 'og-image-png'))
})
