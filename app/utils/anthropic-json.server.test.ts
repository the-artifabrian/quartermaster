import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import {
	ANTHROPIC_MODELS,
	isAnthropicConfigured,
	nullable,
	parseAnthropicJson,
	requestAnthropicJson,
	type AnthropicJsonAdapter,
	type AnthropicJsonRequest,
	type JsonSchema,
} from './anthropic-json.server.ts'

const FeatureSchema = z.object({ value: z.string() })

const featureJsonSchema: JsonSchema = {
	type: 'object',
	properties: { value: { type: 'string' } },
	required: ['value'],
	additionalProperties: false,
}

const request: AnthropicJsonRequest<{ value: string }> = {
	feature: 'test-feature',
	model: ANTHROPIC_MODELS.fast,
	maxTokens: 128,
	timeoutMs: 250,
	system: 'Return JSON.',
	prompt: 'Give me a value.',
	jsonSchema: featureJsonSchema,
	schema: FeatureSchema,
}

function makeAdapter(
	fetchImplementation: AnthropicJsonAdapter['fetch'],
	apiKey = 'test-key',
): AnthropicJsonAdapter {
	return {
		apiKey: () => apiKey,
		fetch: fetchImplementation,
		logError: vi.fn(),
	}
}

function anthropicResponse(text: string) {
	return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
		status: 200,
	})
}

describe('parseAnthropicJson', () => {
	test('extracts fenced JSON and validates it with the caller schema', () => {
		expect(
			parseAnthropicJson('```json\n{"value":"ok"}\n```', FeatureSchema),
		).toEqual({ ok: true, data: { value: 'ok' } })
	})

	test('distinguishes malformed JSON from a schema failure', () => {
		expect(parseAnthropicJson('not json', FeatureSchema)).toEqual({
			ok: false,
			failure: { kind: 'parse' },
		})

		const result = parseAnthropicJson('{"value":42}', FeatureSchema)
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.failure.kind).toBe('schema')
	})
})

describe('nullable', () => {
	test('offers the model the value or an explicit null', () => {
		expect(nullable({ type: 'integer' })).toEqual({
			anyOf: [{ type: 'integer' }, { type: 'null' }],
		})
	})
})

describe('requestAnthropicJson', () => {
	test('reports whether the shared provider is configured', () => {
		expect(isAnthropicConfigured(makeAdapter(vi.fn(), 'test-key'))).toBe(true)
		expect(isAnthropicConfigured(makeAdapter(vi.fn(), ''))).toBe(false)
	})

	test('uses shared provider configuration and returns validated data', async () => {
		const fetch = vi.fn<AnthropicJsonAdapter['fetch']>(async () =>
			anthropicResponse('{"value":"ok"}'),
		)
		const result = await requestAnthropicJson(request, makeAdapter(fetch))

		expect(result).toEqual({ ok: true, data: { value: 'ok' } })
		expect(fetch).toHaveBeenCalledOnce()
		const [url, init] = fetch.mock.calls[0]!
		expect(url).toBe('https://api.anthropic.com/v1/messages')
		expect(init?.headers).toMatchObject({
			'x-api-key': 'test-key',
			'anthropic-version': '2023-06-01',
		})
		expect(JSON.parse(init?.body as string)).toMatchObject({
			model: ANTHROPIC_MODELS.fast,
			max_tokens: 128,
			system: 'Return JSON.',
			messages: [{ role: 'user', content: 'Give me a value.' }],
			output_config: {
				format: { type: 'json_schema', schema: featureJsonSchema },
			},
		})
		expect(init?.signal).toBeInstanceOf(AbortSignal)
	})

	test('does not call the provider when it is not configured', async () => {
		const fetch = vi.fn()
		const result = await requestAnthropicJson(request, makeAdapter(fetch, ''))

		expect(result).toEqual({
			ok: false,
			failure: { kind: 'configuration' },
		})
		expect(fetch).not.toHaveBeenCalled()
	})

	test('normalizes rate-limit and provider failures', async () => {
		const rateLimitAdapter = makeAdapter(
			async () => new Response('', { status: 429 }),
		)
		const rateLimited = await requestAnthropicJson(request, rateLimitAdapter)
		expect(rateLimited).toEqual({
			ok: false,
			failure: { kind: 'rate-limit', status: 429 },
		})

		const unavailable = await requestAnthropicJson(
			request,
			makeAdapter(async () => new Response('', { status: 503 })),
		)
		expect(unavailable).toEqual({
			ok: false,
			failure: { kind: 'provider', status: 503 },
		})
		expect(rateLimitAdapter.logError).toHaveBeenCalledWith(
			'Anthropic JSON request failed',
			expect.objectContaining({
				feature: 'test-feature',
				kind: 'rate-limit',
				status: 429,
			}),
		)
	})

	test('normalizes timeouts without waiting for a real timer', async () => {
		const result = await requestAnthropicJson(
			request,
			makeAdapter(async () => {
				throw new DOMException('timed out', 'TimeoutError')
			}),
		)

		expect(result).toEqual({ ok: false, failure: { kind: 'timeout' } })
	})

	test('normalizes empty, parse, and schema failures', async () => {
		const empty = await requestAnthropicJson(
			request,
			makeAdapter(async () => anthropicResponse('')),
		)
		expect(empty).toEqual({
			ok: false,
			failure: { kind: 'empty-response' },
		})

		const malformed = await requestAnthropicJson(
			request,
			makeAdapter(async () => anthropicResponse('not json')),
		)
		expect(malformed).toEqual({
			ok: false,
			failure: { kind: 'parse' },
		})

		const wrongShape = await requestAnthropicJson(
			request,
			makeAdapter(async () => anthropicResponse('{"value":42}')),
		)
		expect(wrongShape.ok).toBe(false)
		if (!wrongShape.ok) expect(wrongShape.failure.kind).toBe('schema')
	})

	test('reports a max_tokens stop as its own failure, not as bad JSON', async () => {
		const logError = vi.fn()
		const truncated = await requestAnthropicJson(request, {
			apiKey: () => 'test-key',
			fetch: async () =>
				new Response(
					JSON.stringify({
						stop_reason: 'max_tokens',
						content: [{ type: 'text', text: '{"value":"cut off mid-va' }],
					}),
					{ status: 200 },
				),
			logError,
		})
		expect(truncated).toEqual({ ok: false, failure: { kind: 'max-tokens' } })
		expect(logError).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ kind: 'max-tokens', feature: 'test-feature' }),
		)
	})

	test('a complete answer is unaffected by its stop reason', async () => {
		const complete = await requestAnthropicJson(
			request,
			makeAdapter(
				async () =>
					new Response(
						JSON.stringify({
							stop_reason: 'end_turn',
							content: [{ type: 'text', text: '{"value":"ok"}' }],
						}),
						{ status: 200 },
					),
			),
		)
		expect(complete).toEqual({ ok: true, data: { value: 'ok' } })
	})
})
