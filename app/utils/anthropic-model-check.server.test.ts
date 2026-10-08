import { http, HttpResponse } from 'msw'
import { describe, expect, test, vi } from 'vitest'
import { server } from '#tests/setup/mocks-setup.ts'
import { ANTHROPIC_MODELS } from './anthropic-json.server.ts'
import {
	checkAnthropicModels,
	type AnthropicModelCheckAdapter,
} from './anthropic-model-check.server.ts'

function makeAdapter(apiKey = 'test-key') {
	return {
		apiKey: () => apiKey,
		fetch: (input, init) => globalThis.fetch(input, init),
		logError: vi.fn(),
		logWarn: vi.fn(),
	} satisfies AnthropicModelCheckAdapter
}

describe('checkAnthropicModels', () => {
	test('stays quiet when every configured model exists', async () => {
		const adapter = makeAdapter()
		await checkAnthropicModels(Object.values(ANTHROPIC_MODELS), adapter)

		expect(adapter.logError).not.toHaveBeenCalled()
		expect(adapter.logWarn).not.toHaveBeenCalled()
	})

	test('logs an error naming a configured model the API does not know', async () => {
		const adapter = makeAdapter()
		await checkAnthropicModels(
			['claude-haiku-5-5', 'claude-haiku-5-5-20990101'],
			adapter,
		)

		expect(adapter.logError).toHaveBeenCalledOnce()
		expect(adapter.logError.mock.calls[0]![0]).toContain(
			'claude-haiku-5-5-20990101',
		)
	})

	test('asks with the same key and version the JSON requests send', async () => {
		const seen: Array<{ key: string | null; version: string | null }> = []
		server.use(
			http.get('https://api.anthropic.com/v1/models/:id', ({ request }) => {
				seen.push({
					key: request.headers.get('x-api-key'),
					version: request.headers.get('anthropic-version'),
				})
				return HttpResponse.json({ type: 'model', id: 'claude-haiku-5-5' })
			}),
		)
		await checkAnthropicModels(['claude-haiku-5-5'], makeAdapter('sk-check'))

		expect(seen).toEqual([{ key: 'sk-check', version: '2023-06-01' }])
	})

	test('asks once per model when two keys share one', async () => {
		let calls = 0
		server.use(
			http.get('https://api.anthropic.com/v1/models/:id', () => {
				calls++
				return HttpResponse.json({ type: 'model', id: 'claude-haiku-5-5' })
			}),
		)
		await checkAnthropicModels(
			['claude-haiku-5-5', 'claude-haiku-5-5'],
			makeAdapter(),
		)

		expect(calls).toBe(1)
	})

	test('a network error warns and never throws, so boot carries on', async () => {
		server.use(
			http.get('https://api.anthropic.com/v1/models/:id', () =>
				HttpResponse.error(),
			),
		)
		const adapter = makeAdapter()
		await expect(
			checkAnthropicModels(['claude-haiku-5-5'], adapter),
		).resolves.toBeUndefined()

		expect(adapter.logError).not.toHaveBeenCalled()
		expect(adapter.logWarn).toHaveBeenCalledOnce()
		expect(adapter.logWarn.mock.calls[0]![0]).toContain('claude-haiku-5-5')
	})

	test('a rejected key is an error, since no model can be reached with it', async () => {
		server.use(
			http.get('https://api.anthropic.com/v1/models/:id', () =>
				HttpResponse.json(
					{ type: 'error', error: { type: 'authentication_error' } },
					{ status: 401 },
				),
			),
		)
		const adapter = makeAdapter()
		await checkAnthropicModels(['claude-haiku-5-5'], adapter)

		expect(adapter.logError).toHaveBeenCalledOnce()
		expect(adapter.logError.mock.calls[0]![0]).toContain('401')
	})

	test('does not call the API when no key is configured', async () => {
		let calls = 0
		server.use(
			http.get('https://api.anthropic.com/v1/models/:id', () => {
				calls++
				return HttpResponse.json({})
			}),
		)
		const adapter = makeAdapter('')
		await checkAnthropicModels(['claude-haiku-5-5'], adapter)

		expect(calls).toBe(0)
		expect(adapter.logError).not.toHaveBeenCalled()
	})
})
