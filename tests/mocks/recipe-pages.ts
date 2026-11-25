import { http, HttpResponse, type HttpHandler } from 'msw'

/**
 * Recipe pages for the URL import. The import only resolves a host name with
 * real DNS, so these pages sit on an IP literal instead: 203.0.113.10 is in
 * TEST-NET-3, which the public-address guard accepts, and an IP literal is
 * fetched as written, so the handlers can match its exact origin.
 */
const E2E_ORIGIN = 'https://203.0.113.10'
export const E2E_RECIPE_URL = `${E2E_ORIGIN}/e2e/chickpea-lunch`
export const E2E_MISSING_URL = `${E2E_ORIGIN}/e2e/missing`
export const E2E_PHOTO_RECIPE_URL = `${E2E_ORIGIN}/e2e/tomato-soup`
const E2E_PHOTO_URL = `${E2E_ORIGIN}/e2e/tomato-soup.jpg`

const chickpeaLunch = {
	'@context': 'https://schema.org',
	'@type': 'Recipe',
	name: 'Shared chickpea lunch',
	recipeYield: '2 servings',
	recipeIngredient: ['2 cans chickpeas', '1 lemon'],
	recipeInstructions: [
		{
			'@type': 'HowToStep',
			text: 'Toss the chickpeas with lemon juice and serve.',
		},
	],
}

const chickpeaLunchPage = `<!doctype html><html><head><title>${chickpeaLunch.name}</title><script type="application/ld+json">${JSON.stringify(chickpeaLunch)}</script></head><body><h1>${chickpeaLunch.name}</h1></body></html>`

const tomatoSoup = {
	'@context': 'https://schema.org',
	'@type': 'Recipe',
	name: 'Roast tomato soup',
	image: [
		{ '@type': 'ImageObject', url: E2E_PHOTO_URL, width: 48, height: 32 },
	],
	recipeIngredient: ['1 kg tomatoes', '1 onion'],
	recipeInstructions: ['Roast the tomatoes and onion, then blend.'],
}

const tomatoSoupPage = `<!doctype html><html><head><title>${tomatoSoup.name}</title><script type="application/ld+json">${JSON.stringify(tomatoSoup)}</script></head><body><h1>${tomatoSoup.name}</h1></body></html>`

/**
 * A 48×32 JPEG, a few hundred bytes. A large photo makes the image route's
 * AVIF encode slow enough to flake on a slow runner.
 */
const tomatoSoupPhoto = Uint8Array.from(
	atob(
		'/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAgADADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCgJK6AAAAAAAAAA//Z',
	),
	(char) => char.charCodeAt(0),
)

/**
 * The import reads the body through a stream reader. Under Bun, a mocked
 * response built from a string or bytes reads as empty that way, though
 * `text()` works, so pages and photos are sent as streams.
 */
function htmlStream(html: string) {
	return byteStream(new TextEncoder().encode(html), 'text/html; charset=utf-8')
}

function byteStream(bytes: Uint8Array, type: string) {
	return new HttpResponse(
		new ReadableStream({
			start(controller) {
				controller.enqueue(bytes)
				controller.close()
			},
		}),
		{ headers: { 'Content-Type': type } },
	)
}

export const handlers: Array<HttpHandler> = [
	http.get(E2E_RECIPE_URL, () => htmlStream(chickpeaLunchPage)),
	http.get(E2E_MISSING_URL, () => new HttpResponse(null, { status: 404 })),
	http.get(E2E_PHOTO_RECIPE_URL, () => htmlStream(tomatoSoupPage)),
	http.get(E2E_PHOTO_URL, () => byteStream(tomatoSoupPhoto, 'image/jpeg')),
]
