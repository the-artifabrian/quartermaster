import { randomUUID } from 'node:crypto'
import { http, HttpResponse, passthrough, type HttpHandler } from 'msw'
import { createFixture, readFixture } from './utils.ts'

const passthroughAnthropic = process.env.NODE_ENV !== 'test'

/**
 * The key Playwright gives its server (`playwright.config.ts`), so an e2e run
 * never reaches the real API with the developer's own key. Requests made with
 * it get canned answers below and are never passed through.
 */
export const E2E_ANTHROPIC_KEY = 'e2e-mock-anthropic-key'

/**
 * A Household metadata name that makes the canned extraction find nothing:
 * the prompt lists the Household's names, and a test adds this one.
 */
export const E2E_UNREADABLE_MARKER = 'E2E unreadable'

/**
 * A Household metadata name that has the mock count the calls it gets: the
 * prompt lists the Household's names, so a test adds one and reads the count
 * with `aiCallsFor`. The mock runs in the server's process, so the count is
 * a fixture file both processes can read.
 */
export function newAiCallMarker() {
	return `e2e-ai-calls-${randomUUID().slice(0, 8)}`
}

const AI_CALL_MARKER = /e2e-ai-calls-[0-9a-f]{8}/

/** How many messages calls the mock got with this marker in the prompt. */
export async function aiCallsFor(marker: string) {
	try {
		return Number(await readFixture('anthropic', marker))
	} catch {
		return 0
	}
}

async function countAiCall(prompt: string) {
	const marker = prompt.match(AI_CALL_MARKER)?.[0]
	if (marker)
		await createFixture('anthropic', marker, (await aiCallsFor(marker)) + 1)
}

/**
 * A canned image extraction: a Recipe whose title counts the images that
 * arrived, or nothing found when the prompt holds `E2E_UNREADABLE_MARKER`.
 */
const e2eMessagesHandler = http.post(
	'https://api.anthropic.com/v1/messages',
	async ({ request }) => {
		if (request.headers.get('x-api-key') !== E2E_ANTHROPIC_KEY) return
		const body = (await request.json()) as {
			messages: Array<{
				content: Array<{ type: string; text?: string }>
			}>
		}
		const content = body.messages[0]?.content ?? []
		const images = content.filter((block) => block.type === 'image').length
		const prompt = content.find((block) => block.type === 'text')?.text ?? ''
		await countAiCall(prompt)
		const answer = prompt.includes(E2E_UNREADABLE_MARKER)
			? { error: 'no_recipe_found' }
			: {
					title: `Shared screenshot salad from ${images} ${images === 1 ? 'image' : 'images'}`,
					description: null,
					notes: null,
					activeTime: null,
					totalTime: null,
					yieldAmount: null,
					yieldLabel: null,
					metadata: {},
					ingredients: [
						{ name: 'cucumber', amount: '1', unit: null, notes: null },
					],
					instructions: ['Slice the cucumber and serve.'],
				}
		return HttpResponse.json({
			type: 'message',
			role: 'assistant',
			content: [{ type: 'text', text: JSON.stringify(answer) }],
			stop_reason: 'end_turn',
		})
	},
)

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
	e2eMessagesHandler,
	...(passthroughAnthropic
		? [http.post('https://api.anthropic.com/v1/messages', () => passthrough())]
		: []),
]
