import {
	ANTHROPIC_API_BASE,
	ANTHROPIC_API_VERSION,
	ANTHROPIC_MODELS,
} from './anthropic-json.server.ts'

const CHECK_TIMEOUT_MS = 10_000

export type AnthropicModelCheckAdapter = {
	apiKey: () => string | undefined
	fetch: typeof globalThis.fetch
	logError: (message: string) => void
	logWarn: (message: string) => void
}

const defaultAdapter: AnthropicModelCheckAdapter = {
	apiKey: () => process.env.ANTHROPIC_API_KEY,
	fetch: (input, init) => globalThis.fetch(input, init),
	logError: (message) => console.error(message),
	logWarn: (message) => console.warn(message),
}

/**
 * Ask the Models API about each configured model once, at boot. A model id
 * the API does not know would otherwise surface only as a 404 on the next
 * import; here it is one error line naming the id, right after the deploy.
 *
 * It never throws. A wrong id breaks the AI features only, and crashing the
 * server for it would take the Shopping list down with them; an unreachable
 * API at boot says nothing about the ids, so it is a warning.
 */
export async function checkAnthropicModels(
	models: readonly string[] = Object.values(ANTHROPIC_MODELS),
	adapter: AnthropicModelCheckAdapter = defaultAdapter,
): Promise<void> {
	const apiKey = adapter.apiKey()
	if (!apiKey) return

	await Promise.all(
		[...new Set(models)].map(async (model) => {
			let response: Response
			try {
				response = await adapter.fetch(
					`${ANTHROPIC_API_BASE}/models/${encodeURIComponent(model)}`,
					{
						headers: {
							'x-api-key': apiKey,
							'anthropic-version': ANTHROPIC_API_VERSION,
						},
						signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
					},
				)
			} catch (error) {
				adapter.logWarn(
					`⚠️ Could not reach the Anthropic Models API to check ${model}: ${String(error)}`,
				)
				return
			}

			if (response.status === 404) {
				adapter.logError(
					`❌ Anthropic model ${model} does not exist (404 from the Models API). Every request that uses it will fail; fix ANTHROPIC_MODELS in app/utils/anthropic-json.server.ts.`,
				)
			} else if (!response.ok) {
				adapter.logError(
					`❌ Anthropic Models API answered ${response.status} for ${model}; AI requests are likely to fail too.`,
				)
			}
		}),
	)
}
