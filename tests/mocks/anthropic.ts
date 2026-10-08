import { http, HttpResponse, passthrough, type HttpHandler } from 'msw'

const passthroughAnthropic = process.env.NODE_ENV !== 'test'

// The ids the Models API answers for. The boot check asks about each
// configured model; a typo or retired id gets the API's 404 here as well, so
// a mocks-mode boot shows the same error production would.
const KNOWN_MODELS = new Set(['claude-haiku-5-5', 'claude-sonnet-5-5'])

const modelsHandler = http.get(
	'https://api.anthropic.com/v1/models/:id',
	({ params }) => {
		const id = String(params.id)
		if (!KNOWN_MODELS.has(id)) {
			return HttpResponse.json(
				{
					type: 'error',
					error: { type: 'not_found_error', message: `model: ${id}` },
				},
				{ status: 404 },
			)
		}
		return HttpResponse.json({
			type: 'model',
			id,
			display_name: id,
			created_at: '2026-01-01T00:00:00Z',
		})
	},
)

export const handlers: Array<HttpHandler> = [
	modelsHandler,
	...(passthroughAnthropic
		? [http.post('https://api.anthropic.com/v1/messages', () => passthrough())]
		: []),
]
