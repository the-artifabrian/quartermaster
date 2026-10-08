import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { loader } from './images.tsx'

const BASE_URL = 'https://useqm.app'

async function image(src: string) {
	const url = new URL(`${BASE_URL}/resources/images`)
	url.searchParams.set('src', src)
	url.searchParams.set('w', '16')
	url.searchParams.set('h', '16')
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
