import { http, HttpResponse } from 'msw'
import { describe, expect, test, vi } from 'vitest'
import { server } from '#tests/mocks/index.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { getLLMSubstitutions } from './substitution-llm.server.ts'

describe('getLLMSubstitutions', () => {
	test('returns null when no API key', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', '')
		const result = await getLLMSubstitutions('tamarind paste')
		expect(result).toBeNull()
	})

	test('returns parsed substitutions on success', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [
						{
							type: 'text',
							text: JSON.stringify([
								{
									replacement: 'lime juice + brown sugar',
									context: 'Mix 1 tbsp lime juice with 1 tsp brown sugar.',
									ratio: 'per 1 tbsp tamarind paste',
								},
								{
									replacement: 'Worcestershire sauce',
									context: 'Similar tangy-sweet flavor profile.',
									ratio: null,
								},
							]),
						},
					],
				})
			}),
		)

		const result = await getLLMSubstitutions('tamarind paste')
		expect(result).not.toBeNull()
		expect(result).toHaveLength(2)
		expect(result![0]!.replacement).toBe('lime juice + brown sugar')
		expect(result![0]!.context).toBe(
			'Mix 1 tbsp lime juice with 1 tsp brown sugar.',
		)
	})

	test('handles markdown code blocks in response', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [
						{
							type: 'text',
							text: '```json\n[{"replacement": "vinegar + sugar", "context": "Quick swap."}]\n```',
						},
					],
				})
			}),
		)

		const result = await getLLMSubstitutions('mirin')
		expect(result).not.toBeNull()
		expect(result![0]!.replacement).toBe('vinegar + sugar')
	})

	test('returns null on API error', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
		consoleError.mockImplementation(() => {})

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({ error: 'rate_limited' }, { status: 429 })
			}),
		)

		const result = await getLLMSubstitutions('saffron')
		expect(result).toBeNull()
	})

	test('returns null on malformed response', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [{ type: 'text', text: 'Not JSON at all' }],
				})
			}),
		)

		const result = await getLLMSubstitutions('dragon fruit')
		expect(result).toBeNull()
	})

	test('caps at 4 substitutions', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [
						{
							type: 'text',
							text: JSON.stringify([
								{ replacement: 'sub1' },
								{ replacement: 'sub2' },
								{ replacement: 'sub3' },
								{ replacement: 'sub4' },
								{ replacement: 'sub5' },
								{ replacement: 'sub6' },
							]),
						},
					],
				})
			}),
		)

		const result = await getLLMSubstitutions('obscure ingredient')
		expect(result).not.toBeNull()
		expect(result).toHaveLength(4)
	})

	test('sends system message in API request', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
		let capturedBody: any = null

		server.use(
			http.post(
				'https://api.anthropic.com/v1/messages',
				async ({ request }) => {
					capturedBody = await request.json()
					return HttpResponse.json({
						content: [
							{
								type: 'text',
								text: '[{"replacement": "test", "context": "test"}]',
							},
						],
					})
				},
			),
		)

		await getLLMSubstitutions('saffron')
		expect(capturedBody.system).toContain('practical home cook')
		expect(capturedBody.model).toBe('claude-haiku-4-5-20251001')
	})
})
