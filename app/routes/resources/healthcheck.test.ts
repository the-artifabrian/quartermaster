import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	assertApplicationHealthy: vi.fn(),
}))

vi.mock('#app/utils/healthcheck.server.ts', () => ({
	assertApplicationHealthy: mocks.assertApplicationHealthy,
}))

import { loader } from './healthcheck.tsx'

describe('healthcheck resource route', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test('returns a non-cacheable success', async () => {
		mocks.assertApplicationHealthy.mockResolvedValue(undefined)

		const response = await loader()

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('OK')
		expect(response.headers.get('Cache-Control')).toBe('no-store')
	})

	test('returns 500 when a required resource is unhealthy', async () => {
		const error = new Error('attempt to write a readonly database')
		mocks.assertApplicationHealthy.mockRejectedValue(error)
		const consoleErrorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {})

		const response = await loader()

		expect(response.status).toBe(500)
		expect(await response.text()).toBe('ERROR')
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		expect(consoleErrorSpy).toHaveBeenCalledWith('healthcheck ❌', { error })
	})
})
