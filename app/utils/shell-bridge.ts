/**
 * The Web app's side of the iOS shell bridge. The shell registers
 * `WKScriptMessageHandler`s named `haptic`, `theme` and `refresh`; every call
 * here checks that its handler exists, so outside the shell (Safari, the Home
 * Screen install, an older shell build) each one does nothing.
 */

export type HapticKind =
	'selection' | 'light' | 'medium' | 'success' | 'warning' | 'error'

type ShellHandlerName = 'haptic' | 'theme' | 'refresh'

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

/** Launch timing from the shell's stamps, or null outside the shell. */
export function getShellLaunchTiming() {
	if (typeof window === 'undefined') return null
	const stamps = window.__qmShell
	if (!stamps) return null
	const { initAt, loadAt } = stamps
	if (!Number.isFinite(initAt) || !Number.isFinite(loadAt)) return null
	return {
		shell_init_to_load_ms: loadAt - initAt,
		shell_load_to_now_ms: Date.now() - loadAt,
	}
}
