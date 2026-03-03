import { http, HttpResponse } from 'msw'
import { describe, expect, test, vi } from 'vitest'
import { server } from '#tests/mocks/index.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { parseSpeechItemsWithLLM } from './speech-parse-llm.server.ts'

describe('parseSpeechItemsWithLLM', () => {
	test('returns null when no API key', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', '')
		const result = await parseSpeechItemsWithLLM('two pounds of chicken')
		expect(result).toBeNull()
	})

	test('returns parsed items on success', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [
						{
							type: 'text',
							text: JSON.stringify([
								{ name: 'chicken', quantity: '2', unit: 'lb' },
								{ name: 'eggs', quantity: '12', unit: '' },
								{ name: 'milk', quantity: '', unit: '' },
							]),
						},
					],
				})
			}),
		)

		const result = await parseSpeechItemsWithLLM(
			'two pounds of chicken, a dozen eggs, and milk',
		)
		expect(result).toHaveLength(3)
		expect(result![0]).toEqual({ name: 'chicken', quantity: '2', unit: 'lb' })
		expect(result![1]).toEqual({ name: 'eggs', quantity: '12', unit: '' })
		expect(result![2]).toEqual({ name: 'milk', quantity: '', unit: '' })
	})

	test('handles markdown code blocks in response', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [
						{
							type: 'text',
							text: '```json\n[{"name": "apples", "quantity": "3", "unit": ""}]\n```',
						},
					],
				})
			}),
		)

		const result = await parseSpeechItemsWithLLM('three apples')
		expect(result).toHaveLength(1)
		expect(result![0]).toEqual({ name: 'apples', quantity: '3', unit: '' })
	})

	test('returns null on 500 API error', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
		consoleError.mockImplementation(() => {})

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json(
					{ error: 'internal_error' },
					{ status: 500 },
				)
			}),
		)

		const result = await parseSpeechItemsWithLLM('some groceries')
		expect(result).toBeNull()
	})

	test('returns null on 429 rate limit', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
		consoleError.mockImplementation(() => {})

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json(
					{ error: 'rate_limited' },
					{ status: 429 },
				)
			}),
		)

		const result = await parseSpeechItemsWithLLM('some groceries')
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

		const result = await parseSpeechItemsWithLLM('some groceries')
		expect(result).toBeNull()
	})

	test('returns null on empty response text', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [{ type: 'text', text: '' }],
				})
			}),
		)

		const result = await parseSpeechItemsWithLLM('some groceries')
		expect(result).toBeNull()
	})

	test('skips items with missing name field', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [
						{
							type: 'text',
							text: JSON.stringify([
								{ name: 'bread', quantity: '1', unit: '' },
								{ quantity: '2', unit: 'lb' },
								{ name: 'butter', quantity: '', unit: '' },
							]),
						},
					],
				})
			}),
		)

		const result = await parseSpeechItemsWithLLM('bread and butter')
		expect(result).toHaveLength(2)
		expect(result![0]!.name).toBe('bread')
		expect(result![1]!.name).toBe('butter')
	})

	test('skips items with empty or whitespace-only names', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [
						{
							type: 'text',
							text: JSON.stringify([
								{ name: '', quantity: '1', unit: '' },
								{ name: '   ', quantity: '2', unit: '' },
								{ name: 'milk', quantity: '', unit: '' },
							]),
						},
					],
				})
			}),
		)

		const result = await parseSpeechItemsWithLLM('some stuff')
		expect(result).toHaveLength(1)
		expect(result![0]!.name).toBe('milk')
	})

	test('trims and lowercases names, lowercases units', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [
						{
							type: 'text',
							text: JSON.stringify([
								{ name: '  Chicken Breast ', quantity: ' 2 ', unit: ' LB ' },
							]),
						},
					],
				})
			}),
		)

		const result = await parseSpeechItemsWithLLM('two pounds of chicken breast')
		expect(result).toHaveLength(1)
		expect(result![0]).toEqual({
			name: 'chicken breast',
			quantity: '2',
			unit: 'lb',
		})
	})

	test('coerces numeric quantity to string', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [
						{
							type: 'text',
							text: JSON.stringify([
								{ name: 'bananas', quantity: 5, unit: '' },
							]),
						},
					],
				})
			}),
		)

		const result = await parseSpeechItemsWithLLM('five bananas')
		expect(result).toHaveLength(1)
		expect(result![0]!.quantity).toBe('5')
	})

	test('lowercases item names', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [
						{
							type: 'text',
							text: JSON.stringify([
								{ name: 'Parmesan Cheese', quantity: '', unit: '' },
							]),
						},
					],
				})
			}),
		)

		const result = await parseSpeechItemsWithLLM('Parmesan Cheese')
		expect(result).toHaveLength(1)
		expect(result![0]!.name).toBe('parmesan cheese')
	})

	test('returns empty array when LLM returns no items', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [{ type: 'text', text: '[]' }],
				})
			}),
		)

		const result = await parseSpeechItemsWithLLM('um yeah')
		expect(result).toEqual([])
	})

	test('caps at 50 items', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

		const items = Array.from({ length: 60 }, (_, i) => ({
			name: `item${i}`,
			quantity: '1',
			unit: '',
		}))

		server.use(
			http.post('https://api.anthropic.com/v1/messages', () => {
				return HttpResponse.json({
					content: [{ type: 'text', text: JSON.stringify(items) }],
				})
			}),
		)

		const result = await parseSpeechItemsWithLLM('lots of items')
		expect(result).toHaveLength(50)
	})
})
