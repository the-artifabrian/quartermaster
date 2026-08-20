import { z } from 'zod'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_API_VERSION = '2023-06-01'

export const ANTHROPIC_MODELS = {
	fast: 'claude-haiku-4-5-20251001',
	vision: 'claude-sonnet-4-6',
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

export type AnthropicJsonFailure =
	| { kind: 'configuration' }
	| { kind: 'rate-limit'; status: 429 }
	| { kind: 'provider'; status?: number }
	| { kind: 'timeout' }
	| { kind: 'empty-response' }
	| { kind: 'parse' }
	| { kind: 'schema' }

export type AnthropicJsonResult<T> =
	{ ok: true; data: T } | { ok: false; failure: AnthropicJsonFailure }

export type AnthropicJsonRequest<T> = {
	feature: string
	model: AnthropicModel
	maxTokens: number
	timeoutMs: number
	system: string
	prompt: string | AnthropicContentBlock[]
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
})

export function isAnthropicConfigured(
	adapter: AnthropicJsonAdapter = defaultAdapter,
): boolean {
	return Boolean(adapter.apiKey())
}

/**
 * Parse the JSON value from an Anthropic text response and validate it through
 * the caller's feature-local schema.
 */
export function parseAnthropicJson<T>(
	text: string,
	schema: z.ZodType<T>,
): AnthropicJsonResult<T> {
	const parsedJson = parseJsonValue(text)
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
				'x-api-key': apiKey,
				'anthropic-version': ANTHROPIC_API_VERSION,
			},
			body: JSON.stringify({
				model: request.model,
				max_tokens: request.maxTokens,
				system: request.system,
				messages: [{ role: 'user', content: request.prompt }],
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

function parseJsonValue(
	text: string,
): { ok: true; data: unknown } | { ok: false; failure: { kind: 'parse' } } {
	const trimmed = text.trim()
	const direct = tryParseJson(trimmed)
	if (direct.ok) return direct

	const objectStart = trimmed.indexOf('{')
	const arrayStart = trimmed.indexOf('[')
	const starts = [objectStart, arrayStart].filter((index) => index >= 0)
	if (starts.length === 0) return { ok: false, failure: { kind: 'parse' } }

	const start = Math.min(...starts)
	const closingCharacter = trimmed[start] === '{' ? '}' : ']'
	const end = trimmed.lastIndexOf(closingCharacter)
	if (end <= start) return { ok: false, failure: { kind: 'parse' } }

	return tryParseJson(trimmed.slice(start, end + 1))
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
