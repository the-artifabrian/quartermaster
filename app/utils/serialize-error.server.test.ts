import { expect, test } from 'vitest'
import { serializeError } from './serialize-error.server.ts'

test('an Error serializes to its message', () => {
	expect(serializeError(new Error('boom'))).toBe('boom')
})

test('a route ErrorResponse serializes to status, statusText, and data', () => {
	const errorResponse = {
		status: 404,
		statusText: 'Not Found',
		data: { message: 'no such recipe' },
		internal: false,
	}
	expect(serializeError(errorResponse)).toBe(
		'404 Not Found: {"message":"no such recipe"}',
	)
})

test('a route ErrorResponse with an empty statusText omits it', () => {
	const errorResponse = {
		status: 404,
		statusText: '',
		data: 'not found',
		internal: false,
	}
	expect(serializeError(errorResponse)).toBe('404: "not found"')
})

test('a string serializes to itself', () => {
	expect(serializeError('plain message')).toBe('plain message')
})

test('a plain object serializes to JSON instead of "[object Object]"', () => {
	expect(serializeError({ code: 'ECONNRESET' })).toBe('{"code":"ECONNRESET"}')
})

test('null and undefined serialize to readable strings', () => {
	expect(serializeError(null)).toBe('null')
	expect(serializeError(undefined)).toBe('undefined')
})

test('a circular object falls back to String() without throwing', () => {
	const circular: Record<string, unknown> = {}
	circular.self = circular
	expect(serializeError(circular)).toBe('[object Object]')
})
