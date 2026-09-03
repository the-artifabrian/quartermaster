/**
 * @vitest-environment jsdom
 */
import { expect, test, vi } from 'vitest'
import {
	getCurrentRouteId,
	getPwaDisplayMode,
	getPwaSessionContext,
} from './pwa-performance.ts'

function setupPwaTestEnvironment() {
	const navigatorDescriptors = new Map(
		['standalone', 'serviceWorker', 'connection'].map((property) => [
			property,
			Object.getOwnPropertyDescriptor(navigator, property),
		]),
	)
	return {
		[Symbol.dispose]() {
			vi.restoreAllMocks()
			vi.unstubAllGlobals()
			for (const [property, descriptor] of navigatorDescriptors) {
				if (descriptor) Object.defineProperty(navigator, property, descriptor)
				else Reflect.deleteProperty(navigator, property)
			}
		},
	}
}

test('uses stable route ids instead of dynamic URL pathnames', () => {
	using _environment = setupPwaTestEnvironment()
	expect(
		getCurrentRouteId([
			{ id: 'root' },
			{ id: 'routes/recipes/_layout' },
			{ id: 'routes/recipes/$recipeId' },
		]),
	).toBe('routes/recipes/$recipeId')
	expect(getCurrentRouteId([])).toBe('unknown')
})

test('detects browser and installed display modes without assuming iOS support', () => {
	using _environment = setupPwaTestEnvironment()
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({ matches: false })),
	)
	expect(getPwaDisplayMode()).toBe('browser')

	vi.mocked(matchMedia).mockReturnValue({
		matches: true,
	} as MediaQueryList)
	expect(getPwaDisplayMode()).toBe('standalone')
})

test('recognizes the iOS standalone signal when display-mode media is absent', () => {
	using _environment = setupPwaTestEnvironment()
	vi.stubGlobal('matchMedia', undefined)
	Object.defineProperty(navigator, 'standalone', {
		configurable: true,
		value: true,
	})

	expect(getPwaDisplayMode()).toBe('standalone')
})

test('captures only coarse, non-content launch context with safe fallbacks', () => {
	using _environment = setupPwaTestEnvironment()
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({ matches: false })),
	)
	vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
	Object.defineProperty(navigator, 'serviceWorker', {
		configurable: true,
		value: undefined,
	})
	Object.defineProperty(navigator, 'connection', {
		configurable: true,
		value: { effectiveType: '4g' },
	})

	expect(
		getPwaSessionContext({
			appBuild: 'abc123def456',
			initialRoute: 'routes/recipes/$recipeId',
		}),
	).toEqual({
		app_build: 'abc123def456',
		display_mode: 'browser',
		initial_route: 'routes/recipes/$recipeId',
		navigation_type: 'unknown',
		initial_visibility: 'visible',
		service_worker_controlled: false,
		service_worker_state: 'uncontrolled',
		connection_type: '4g',
	})
})
