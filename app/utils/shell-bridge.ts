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
		/**
		 * A link or screenshots shared through the iOS app's own Share
		 * Extension, set by the shell on the import page it opened for them.
		 * Read once with `takeShareImport`.
		 */
		__qmShareImport?: unknown
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

/**
 * The shell dispatches this on the import page after setting
 * `window.__qmShareImport` (iOS README, "Share import").
 */
export const SHARE_IMPORT_EVENT = 'qm:share-import'

/** What the iOS app's own Share Extension shared: a link, or screenshots. */
export type ShareImport =
	{ kind: 'link'; url: string } | { kind: 'images'; files: File[] }

/**
 * Whether the share the shell handed over still belongs here: delivered for
 * this page (`for`, the path and query it was handed to) and before its
 * `expiresAt` (epoch ms). A share handed over while the page was being left
 * must not wait for a later visit.
 */
function isShareFor(value: unknown, where: string, now: number) {
	return (
		typeof value === 'object' &&
		value !== null &&
		'for' in value &&
		value.for === where &&
		'expiresAt' in value &&
		typeof value.expiresAt === 'number' &&
		now <= value.expiresAt
	)
}

/** The page the shell hands shares to: its path and query. */
export function currentSharePage() {
	return `${window.location.pathname}${window.location.search}`
}

/**
 * Drops the handed-over share when it no longer belongs to `where`, or has
 * expired. With nothing to drop, nothing happens.
 */
export function dropStaleShareImport(where: string, now = Date.now()) {
	if (typeof window === 'undefined' || !('__qmShareImport' in window)) return
	if (!isShareFor(window.__qmShareImport, where, now)) {
		delete window.__qmShareImport
	}
}

/** Drops the handed-over share, whatever it is: its page is going away. */
export function discardShareImport() {
	if (typeof window === 'undefined') return
	delete window.__qmShareImport
}

/**
 * The share the shell handed over to `where`, or null. Each delivery is read
 * once: the value is cleared whatever it holds, so a later visit to the same
 * page waits for a tap. Only the shell sets it; nothing in a URL or in storage
 * reaches it. One handed to another page, or expired, counts as none.
 * Screenshots count only as 1 to `maxImages` files.
 */
export function takeShareImport(
	maxImages: number,
	where: string,
	now = Date.now(),
): ShareImport | null {
	if (typeof window === 'undefined' || !('__qmShareImport' in window)) {
		return null
	}
	const value = window.__qmShareImport
	delete window.__qmShareImport
	if (!isShareFor(value, where, now)) return null
	if (typeof value !== 'object' || value === null) return null
	if ('url' in value && typeof value.url === 'string') {
		return { kind: 'link', url: value.url }
	}
	if ('files' in value && Array.isArray(value.files)) {
		const files: unknown[] = value.files
		if (
			files.length >= 1 &&
			files.length <= maxImages &&
			files.every((file) => file instanceof File)
		) {
			return { kind: 'images', files: files as File[] }
		}
	}
	return null
}
