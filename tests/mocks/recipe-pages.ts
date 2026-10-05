import { http, HttpResponse, type HttpHandler } from 'msw'

/**
 * Recipe pages for the URL import. The import resolves the page's host with
 * real DNS and then requests the checked address, naming the host in the Host
 * header, so these handlers match on the path under any origin. Use a real
 * public host such as example.com in the imported URL.
 */
export const E2E_RECIPE_PATH = '/e2e/chickpea-lunch'

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
	http.get(`*${E2E_RECIPE_PATH}`, () => htmlStream(chickpeaLunchPage)),
]
