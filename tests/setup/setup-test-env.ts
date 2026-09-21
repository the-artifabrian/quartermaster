import 'dotenv/config'
import './test-database.ts'
import '#app/utils/env.server.ts'
// we need these to be imported first 👆

import { beforeEach, vi, type MockInstance } from 'vitest'
import './custom-matchers.ts'
import { installNetworkGuard } from './network-guard.ts'

// Everything in this file is paid for by all ~120 test files, so it stays
// cheap. The expensive setup is opt-in and lives next door:
//   - `db-setup.ts` for tests that use the database
//   - `mocks-setup.ts` for tests that call a third-party API
//   - `dom-setup.ts`, loaded below for `@vitest-environment jsdom` files
if (typeof document !== 'undefined') {
	await import('./dom-setup.ts')
}

installNetworkGuard()

export let consoleError: MockInstance<(typeof console)['error']>
export let consoleWarn: MockInstance<(typeof console)['warn']>

beforeEach(() => {
	const originalConsoleError = console.error
	consoleError = vi.spyOn(console, 'error')
	consoleError.mockImplementation(
		(...args: Parameters<typeof console.error>) => {
			originalConsoleError(...args)
			throw new Error(
				'Console error was called. Call consoleError.mockImplementation(() => {}) if this is expected.',
			)
		},
	)

	const originalConsoleWarn = console.warn
	consoleWarn = vi.spyOn(console, 'warn')
	consoleWarn.mockImplementation((...args: Parameters<typeof console.warn>) => {
		originalConsoleWarn(...args)
		throw new Error(
			'Console warn was called. Call consoleWarn.mockImplementation(() => {}) if this is expected.',
		)
	})
})
