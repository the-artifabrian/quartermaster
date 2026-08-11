import { describe, expect, test, vi } from 'vitest'
import { createEventStreamRegistry } from './event-streams.server.ts'

describe('event stream registry', () => {
	test('closes registered streams once and allows early unregister', () => {
		const registry = createEventStreamRegistry()
		const retained = vi.fn()
		const removed = vi.fn()
		registry.register(retained)
		const unregister = registry.register(removed)
		unregister()

		registry.closeAll()
		registry.closeAll()

		expect(retained).toHaveBeenCalledOnce()
		expect(removed).not.toHaveBeenCalled()
	})

	test('immediately closes a stream registered after shutdown starts', () => {
		const registry = createEventStreamRegistry()
		const lateStream = vi.fn()
		registry.closeAll()

		registry.register(lateStream)

		expect(lateStream).toHaveBeenCalledOnce()
	})

	test('continues closing streams when one cleanup fails', () => {
		const registry = createEventStreamRegistry()
		const error = new Error('close failed')
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		const healthyStream = vi.fn()
		registry.register(() => {
			throw error
		})
		registry.register(healthyStream)

		registry.closeAll()

		expect(consoleError).toHaveBeenCalledWith(
			'Failed to close event stream during shutdown',
			error,
		)
		expect(healthyStream).toHaveBeenCalledOnce()
	})
})
