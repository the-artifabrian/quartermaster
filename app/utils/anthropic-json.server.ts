import { z } from 'zod'

export const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1'
const ANTHROPIC_API_URL = `${ANTHROPIC_API_BASE}/messages`
const ANTHROPIC_API_VERSION = '2023-06-01'

// Recheck both IDs against the Models API (GET /v1/models) whenever this file
// is touched; a model that is current today is a generation behind after the
// next release. The server checks each id once at boot and logs one that the
// API does not know (anthropic-model-check.server.ts).
//
// Text extraction runs on Haiku 5.5: it took 12 to 23 s on Haiku 4.5 and
// Sonnet 5, and the input is already text. Images run on Sonnet 5.5, because
// photographed cookbook pages (glare, two columns, prose quantities) are where
// a smaller model drops or reorders ingredients, and at this volume the price
// difference is cents a month. `vision` stays its own key so the two can move
// independently without touching a caller.
export const ANTHROPIC_MODELS = {
	fast: 'claude-haiku-5-5',
	vision: 'claude-sonnet-5-5',
} as const

type AnthropicModel = (typeof ANTHROPIC_MODELS)[keyof typeof ANTHROPIC_MODELS]

export type AnthropicContentBlock =
	| { type: 'text'; text: string }
	| {
			type: 'image'
			source: {
				type: 'base64'
				media_type: string
				data: string
			}
	  }

/**
 * The JSON Schema subset structured outputs accepts. It has no string or
 * numeric constraints and no recursion, so the feature-level caps and
 * coercions stay in the callers' Zod schemas; this only fixes the shape and
 * the types of what comes back.
 */
export type JsonSchema =
	| { type: 'string'; enum?: readonly string[] }
	| { type: 'number' | 'integer' | 'boolean' | 'null' }
	| { type: 'array'; items: JsonSchema }
	| {
			type: 'object'
			properties: Record<string, JsonSchema>
			required: readonly string[]
			additionalProperties: false
	  }
	| { anyOf: readonly JsonSchema[] }

/** A field the model may leave empty. `null` is a type, not an absent key. */
export function nullable(schema: JsonSchema): JsonSchema {
	return { anyOf: [schema, { type: 'null' }] }
}

export type AnthropicJsonFailure =
	| { kind: 'configuration' }
	| { kind: 'rate-limit'; status: 429 }
	| { kind: 'provider'; status?: number }
	| { kind: 'timeout' }
	| { kind: 'empty-response' }
	| { kind: 'max-tokens' }
	| { kind: 'parse' }
	| { kind: 'schema' }

export type AnthropicJsonResult<T> =
	{ ok: true; data: T } | { ok: false; failure: AnthropicJsonFailure }

/**
 * How much the model thinks before it answers. Thinking is on by default on the
 * 5.5 models and spends from `maxTokens`; `low` is the documented setting for
 * extraction and classification latency.
 */
export type AnthropicEffort = 'low' | 'medium' | 'high'

export type AnthropicJsonRequest<T> = {
	feature: string
	model: AnthropicModel
	/** Covers the thinking as well as the JSON. */
	maxTokens: number
	effort: AnthropicEffort
	/**
	 * Turns thinking off for a caller whose timeout leaves no room for it.
	 * Omitted, thinking stays at the model's default; a budget is never sent,
	 * since the 5.5 models reject one.
	 */
	thinking?: 'disabled'
	timeoutMs: number
	system: string
	prompt: string | AnthropicContentBlock[]
	/** Constrains the response through `output_config.format`. */
	jsonSchema: JsonSchema
	schema: z.ZodType<T>
}

export type AnthropicJsonAdapter = {
	apiKey: () => string | undefined
	fetch: typeof globalThis.fetch
	logError: (message: string, details: Record<string, unknown>) => void
}

const defaultAdapter: AnthropicJsonAdapter = {
	apiKey: () => process.env.ANTHROPIC_API_KEY,
	fetch: (input, init) => globalThis.fetch(input, init),
	logError: (message, details) => console.error(message, details),
}

const AnthropicResponseSchema = z.object({
	content: z
		.array(
			z.object({
				type: z.string(),
				text: z.string().optional(),
			}),
		)
		.default([]),
	stop_reason: z.string().nullish(),
})

/** The key and version every Anthropic API request sends. */
export function anthropicHeaders(apiKey: string) {
	return {
		'x-api-key': apiKey,
		'anthropic-version': ANTHROPIC_API_VERSION,
	}
}

export function isAnthropicConfigured(
	adapter: AnthropicJsonAdapter = defaultAdapter,
): boolean {
	return Boolean(adapter.apiKey())
}

/**
 * Parse the JSON value from an Anthropic text response and validate it through
 * the caller's feature-local schema.
 *
 * `output_config.format` means the response is bare, schema-valid JSON. A
 * response that is not is a real failure, reported as `kind: 'parse'` rather
 * than scraped for something usable.
 */
export function parseAnthropicJson<T>(
	text: string,
	schema: z.ZodType<T>,
): AnthropicJsonResult<T> {
	const parsedJson = tryParseJson(text.trim())
	if (!parsedJson.ok) return parsedJson

	const parsedSchema = schema.safeParse(parsedJson.data)
	if (!parsedSchema.success) {
		return { ok: false, failure: { kind: 'schema' } }
	}

	return { ok: true, data: parsedSchema.data }
}

/**
 * Send one explicit Anthropic request and return only schema-validated JSON.
 * Prompts, schemas, limits, and user-facing error wording remain feature-local.
 */
export async function requestAnthropicJson<T>(
	request: AnthropicJsonRequest<T>,
	adapter: AnthropicJsonAdapter = defaultAdapter,
): Promise<AnthropicJsonResult<T>> {
	const apiKey = adapter.apiKey()
	if (!apiKey) return { ok: false, failure: { kind: 'configuration' } }

	let response: Response
	try {
		response = await adapter.fetch(ANTHROPIC_API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...anthropicHeaders(apiKey),
			},
			body: JSON.stringify({
				model: request.model,
				max_tokens: request.maxTokens,
				system: request.system,
				messages: [{ role: 'user', content: request.prompt }],
				...(request.thinking === 'disabled' && {
					thinking: { type: 'disabled' },
				}),
				// No temperature, top_p, top_k, prefill or thinking budget: the
				// 5.5 models reject each with a 400.
				output_config: {
					effort: request.effort,
					// Structured outputs: the response is schema-valid by
					// construction, so a stray sentence or fence can no longer
					// turn a good answer into a parse failure.
					format: { type: 'json_schema', schema: request.jsonSchema },
				},
			}),
			signal: AbortSignal.timeout(request.timeoutMs),
		})
	} catch (error) {
		const failure: AnthropicJsonFailure = isTimeoutError(error)
			? { kind: 'timeout' }
			: { kind: 'provider' }
		adapter.logError('Anthropic JSON request failed', {
			feature: request.feature,
			kind: failure.kind,
			error,
		})
		return { ok: false, failure }
	}

	if (!response.ok) {
		const failure: AnthropicJsonFailure =
			response.status === 429
				? { kind: 'rate-limit', status: 429 }
				: { kind: 'provider', status: response.status }
		adapter.logError('Anthropic JSON request failed', {
			feature: request.feature,
			kind: failure.kind,
			status: response.status,
			statusText: response.statusText,
		})
		return { ok: false, failure }
	}

	let rawResponse: unknown
	try {
		rawResponse = await response.json()
	} catch (error) {
		adapter.logError('Anthropic JSON response was invalid', {
			feature: request.feature,
			kind: 'provider',
			error,
		})
		return { ok: false, failure: { kind: 'provider' } }
	}

	const parsedResponse = AnthropicResponseSchema.safeParse(rawResponse)
	if (!parsedResponse.success) {
		adapter.logError('Anthropic JSON response was invalid', {
			feature: request.feature,
			kind: 'provider',
			issues: parsedResponse.error.issues,
		})
		return { ok: false, failure: { kind: 'provider' } }
	}

	// A max_tokens stop means the JSON is cut mid-value. Report it as its own
	// failure rather than letting the parse fail, which reads to the caller like
	// the model found nothing.
	if (parsedResponse.data.stop_reason === 'max_tokens') {
		adapter.logError('Anthropic JSON response hit max_tokens', {
			feature: request.feature,
			kind: 'max-tokens',
			maxTokens: request.maxTokens,
		})
		return { ok: false, failure: { kind: 'max-tokens' } }
	}

	// A refusal can stop mid-JSON. Haiku has no server-side fallback model, so
	// it is a provider failure, logged on its own line so it is not mistaken
	// for an outage.
	if (parsedResponse.data.stop_reason === 'refusal') {
		adapter.logError('Anthropic JSON response was a refusal', {
			feature: request.feature,
			kind: 'provider',
			model: request.model,
		})
		return { ok: false, failure: { kind: 'provider' } }
	}

	// Thinking blocks come first on the 5.5 models; the answer is the text
	// block, found by type rather than position.
	const text = parsedResponse.data.content.find(
		(block) => block.type === 'text' && block.text,
	)?.text
	if (!text) return { ok: false, failure: { kind: 'empty-response' } }

	const result = parseAnthropicJson(text, request.schema)
	if (!result.ok) {
		adapter.logError('Anthropic JSON response failed validation', {
			feature: request.feature,
			kind: result.failure.kind,
		})
	}
	return result
}

function tryParseJson(
	value: string,
): { ok: true; data: unknown } | { ok: false; failure: { kind: 'parse' } } {
	try {
		return { ok: true, data: JSON.parse(value) }
	} catch {
		return { ok: false, failure: { kind: 'parse' } }
	}
}

function isTimeoutError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		error.name === 'TimeoutError'
	)
}
