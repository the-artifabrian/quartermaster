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

/**
 * The import reads the body through a stream reader. Under Bun, a mocked
 * response built from a string or bytes reads as empty that way, though
 * `text()` works, so the page is sent as a stream.
 */
function htmlStream(html: string) {
	const bytes = new TextEncoder().encode(html)
	return new HttpResponse(
		new ReadableStream({
			start(controller) {
				controller.enqueue(bytes)
				controller.close()
			},
		}),
		{ headers: { 'Content-Type': 'text/html; charset=utf-8' } },
	)
}

export const handlers: Array<HttpHandler> = [
	http.get(E2E_RECIPE_URL, () => htmlStream(chickpeaLunchPage)),
	http.get(E2E_MISSING_URL, () => new HttpResponse(null, { status: 404 })),
]
