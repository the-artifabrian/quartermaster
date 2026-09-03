export type PwaDisplayMode = 'browser' | 'standalone'

export type PwaSessionContext = {
	app_build: string
	display_mode: PwaDisplayMode
	initial_route: string
	navigation_type: string
	initial_visibility: DocumentVisibilityState
	service_worker_controlled: boolean
	service_worker_state: ServiceWorkerState | 'uncontrolled'
	connection_type?: string
}

type NavigatorWithPwaSignals = Navigator & {
	standalone?: boolean
	connection?: { effectiveType?: string }
}

/** Return the stable leaf route id, never a pathname containing record ids. */
export function getCurrentRouteId(matches: ReadonlyArray<{ id: string }>) {
	return matches.at(-1)?.id ?? 'unknown'
}

export function getPwaDisplayMode(): PwaDisplayMode {
	const nav = navigator as NavigatorWithPwaSignals
	const standaloneMedia =
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(display-mode: standalone)').matches
	return standaloneMedia || nav.standalone === true ? 'standalone' : 'browser'
}

function getNavigationType() {
	if (typeof performance.getEntriesByType !== 'function') return 'unknown'
	const navigation = performance.getEntriesByType('navigation')[0] as
		PerformanceNavigationTiming | undefined
	return navigation?.type ?? 'unknown'
}

export function getServiceWorkerContext() {
	const controller = navigator.serviceWorker?.controller
	return {
		service_worker_controlled: Boolean(controller),
		service_worker_state: controller?.state ?? ('uncontrolled' as const),
	}
}

/**
 * Snapshot the low-cardinality context shared by launch, Web Vitals, and route
 * navigation events. PostHog already supplies browser/OS/device properties.
 */
export function getPwaSessionContext({
	appBuild,
	initialRoute,
}: {
	appBuild?: string
	initialRoute: string
}): PwaSessionContext {
	const nav = navigator as NavigatorWithPwaSignals
	return {
		app_build: appBuild || 'unknown',
		display_mode: getPwaDisplayMode(),
		initial_route: initialRoute,
		navigation_type: getNavigationType(),
		initial_visibility: document.visibilityState,
		...getServiceWorkerContext(),
		...(nav.connection?.effectiveType
			? { connection_type: nav.connection.effectiveType }
			: {}),
	}
}
