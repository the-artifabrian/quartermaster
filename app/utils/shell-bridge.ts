/**
 * The Web app's side of the iOS shell bridge. The shell registers
 * `WKScriptMessageHandler`s named `haptic`, `theme`, `refresh` and `launch`;
 * every call here checks that its handler exists, so outside the shell
 * (Safari, the Home Screen install, an older shell build) each one does
 * nothing.
 */

export type HapticKind =
	'selection' | 'light' | 'medium' | 'success' | 'warning' | 'error'

type ShellHandlerName = 'haptic' | 'theme' | 'refresh' | 'launch'

declare global {
	interface Window {
		webkit?: {
			messageHandlers?: Partial<
				Record<ShellHandlerName, { postMessage: (message: string) => void }>
			>
		}
		/** Epoch-ms stamps the shell injects at document start. */
		__qmShell?: { initAt: number; loadAt: number }
	}
}

const HAPTIC_KINDS: ReadonlySet<string> = new Set<HapticKind>([
	'selection',
	'light',
	'medium',
	'success',
	'warning',
	'error',
])

function post(name: ShellHandlerName, message: string) {
	if (typeof window === 'undefined') return
	try {
		const handler = window.webkit?.messageHandlers?.[name]
		if (typeof handler?.postMessage !== 'function') return
		handler.postMessage(message)
	} catch {
		// Feedback for the shell must never break the action that caused it.
	}
}

export function haptic(kind: HapticKind) {
	if (!HAPTIC_KINDS.has(kind)) return
	post('haptic', kind)
}

/** The shell sets the status bar style from this. */
export function postTheme(theme: 'light' | 'dark') {
	if (theme !== 'light' && theme !== 'dark') return
	post('theme', theme)
}

type ShellRevalidator = {
	state: 'idle' | 'loading'
	revalidate: () => Promise<void>
}

let getRevalidator: (() => ShellRevalidator) | null = null

/**
 * Called from the hydrated root with the router's revalidator. Until then,
 * and after the root unmounts, a pull answers `done` at once.
 */
export function connectShellRefresh(get: () => ShellRevalidator) {
	getRevalidator = get
	return () => {
		if (getRevalidator === get) getRevalidator = null
	}
}

function onShellRefresh() {
	const revalidator = getRevalidator?.()
	if (!revalidator || revalidator.state !== 'idle') {
		post('refresh', 'done')
		return
	}
	revalidator.revalidate().then(
		() => post('refresh', 'done'),
		() => post('refresh', 'done'),
	)
}

/**
 * The shell dispatches `qm:refresh` on pull to refresh. Listen before
 * hydration so an early pull still gets its `done`.
 */
export function listenForShellRefresh() {
	window.addEventListener('qm:refresh', onShellRefresh)
	return () => window.removeEventListener('qm:refresh', onShellRefresh)
}

/**
 * On a cold start the shell keeps its launch screen over the web view until
 * the page has painted. Two animation frames after the entry module runs, a
 * frame with the page's content has been put on screen, so the launch screen
 * can go. Posted on every document; the shell ignores it when nothing covers
 * the page.
 */
export function reportLaunchPainted() {
	if (typeof window === 'undefined') return
	requestAnimationFrame(() => {
		requestAnimationFrame(() => post('launch', 'painted'))
	})
}

export type ShellLaunchTiming = {
	shell_init_to_load_ms: number
	shell_load_to_now_ms: number
	/**
	 * From the shell's `load()` to the document's navigation start: WebKit's
	 * processes starting and the navigation being set up. Missing when the
	 * page cannot tell.
	 */
	shell_load_to_navigation_ms?: number
	/**
	 * From navigation start to the document's first byte: the service worker
	 * booting and the document round trip. Missing when unknown.
	 */
	response_start_ms?: number
}

/** Launch timing from the shell's stamps, or null outside the shell. */
export function getShellLaunchTiming(): ShellLaunchTiming | null {
	if (typeof window === 'undefined') return null
	const stamps = window.__qmShell
	if (!stamps) return null
	const { initAt, loadAt } = stamps
	if (!Number.isFinite(initAt) || !Number.isFinite(loadAt)) return null
	const timing: ShellLaunchTiming = {
		shell_init_to_load_ms: loadAt - initAt,
		shell_load_to_now_ms: Date.now() - loadAt,
	}
	if (typeof performance === 'undefined') return timing
	const navigationAt = performance.timeOrigin
	if (Number.isFinite(navigationAt)) {
		timing.shell_load_to_navigation_ms = Math.round(navigationAt - loadAt)
	}
	const navigation =
		typeof performance.getEntriesByType === 'function'
			? (performance.getEntriesByType('navigation')[0] as
					PerformanceNavigationTiming | undefined)
			: undefined
	if (navigation && navigation.responseStart > 0) {
		timing.response_start_ms = Math.round(navigation.responseStart)
	}
	return timing
}
