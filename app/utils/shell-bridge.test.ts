/**
 * @vitest-environment jsdom
 */
import { expect, test, vi } from 'vitest'
import {
	connectShellRefresh,
	getShellLaunchTiming,
	haptic,
	type HapticKind,
	listenForShellRefresh,
	postTheme,
} from './shell-bridge.ts'

type Handler = { postMessage: (message: unknown) => void }

function installHandlers(handlers: Record<string, Handler | undefined>) {
	window.webkit = { messageHandlers: handlers } as Window['webkit']
}

function recordingHandler() {
	const messages: unknown[] = []
	return {
		messages,
		handler: { postMessage: (m: unknown) => messages.push(m) },
	}
}

// Every test starts outside the shell and leaves no shell globals behind.
function shellGlobals() {
	return {
		[Symbol.dispose]() {
			vi.unstubAllGlobals()
			delete window.webkit
			delete window.__qmShell
			vi.useRealTimers()
		},
	}
}

// --- haptic -----------------------------------------------------------------

test('does nothing on the Home Screen install, which has no webkit object', () => {
	using _globals = shellGlobals()
	expect(() => haptic('selection')).not.toThrow()
})

test('does nothing when webkit has no message handlers', () => {
	using _globals = shellGlobals()
	window.webkit = {} as Window['webkit']
	expect(() => haptic('selection')).not.toThrow()
})

test('does nothing when the shell build has no haptic handler', () => {
	using _globals = shellGlobals()
	const theme = recordingHandler()
	installHandlers({ theme: theme.handler })
	expect(() => haptic('success')).not.toThrow()
	expect(theme.messages).toEqual([])
})

test('does nothing when the handler has no postMessage', () => {
	using _globals = shellGlobals()
	installHandlers({ haptic: {} as Handler })
	expect(() => haptic('selection')).not.toThrow()
})

test('swallows a postMessage that throws, so a haptic never breaks a Shopping check', () => {
	using _globals = shellGlobals()
	installHandlers({
		haptic: {
			postMessage: () => {
				throw new Error('handler gone')
			},
		},
	})
	expect(() => haptic('selection')).not.toThrow()
})

test('drops an unknown kind instead of posting it', () => {
	using _globals = shellGlobals()
	const recorded = recordingHandler()
	installHandlers({ haptic: recorded.handler })
	haptic('heavy' as HapticKind)
	expect(recorded.messages).toEqual([])
})

test('posts a known kind once, to the haptic handler only', () => {
	using _globals = shellGlobals()
	const hapticHandler = recordingHandler()
	const theme = recordingHandler()
	installHandlers({ haptic: hapticHandler.handler, theme: theme.handler })
	haptic('warning')
	expect(hapticHandler.messages).toEqual(['warning'])
	expect(theme.messages).toEqual([])
})

test('does nothing during a server render, where there is no window', () => {
	using _globals = shellGlobals()
	vi.stubGlobal('window', undefined)
	expect(() => haptic('selection')).not.toThrow()
})

// --- theme ------------------------------------------------------------------

test('posts a resolved theme to the theme handler', () => {
	using _globals = shellGlobals()
	const recorded = recordingHandler()
	installHandlers({ theme: recorded.handler })
	postTheme('dark')
	postTheme('light')
	expect(recorded.messages).toEqual(['dark', 'light'])
})

test('never posts an unresolved preference such as system', () => {
	using _globals = shellGlobals()
	const recorded = recordingHandler()
	installHandlers({ theme: recorded.handler })
	postTheme('system' as 'light')
	postTheme(undefined as unknown as 'light')
	expect(recorded.messages).toEqual([])
})

// --- pull to refresh --------------------------------------------------------

function deferred() {
	let resolve!: () => void
	let reject!: (error: unknown) => void
	const promise = new Promise<void>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function setUpRefresh() {
	const refresh = recordingHandler()
	installHandlers({ refresh: refresh.handler })
	const stopListening = listenForShellRefresh()
	return {
		messages: refresh.messages,
		pull: () => window.dispatchEvent(new CustomEvent('qm:refresh')),
		[Symbol.dispose]: stopListening,
	}
}

test('answers done at once when the page has not hydrated yet', () => {
	using _globals = shellGlobals()
	using refresh = setUpRefresh()
	refresh.pull()
	expect(refresh.messages).toEqual(['done'])
})

test('answers done at once when a revalidation is already in flight', () => {
	using _globals = shellGlobals()
	using refresh = setUpRefresh()
	const revalidate = vi.fn(() => Promise.resolve())
	const disconnect = connectShellRefresh(() => ({
		state: 'loading',
		revalidate,
	}))
	refresh.pull()
	expect(refresh.messages).toEqual(['done'])
	expect(revalidate).not.toHaveBeenCalled()
	disconnect()
})

test('revalidates and answers done only once the revalidation settles', async () => {
	using _globals = shellGlobals()
	using refresh = setUpRefresh()
	const pending = deferred()
	const revalidate = vi.fn(() => pending.promise)
	const disconnect = connectShellRefresh(() => ({ state: 'idle', revalidate }))
	refresh.pull()
	expect(revalidate).toHaveBeenCalledTimes(1)
	await Promise.resolve()
	expect(refresh.messages).toEqual([])
	pending.resolve()
	await vi.waitFor(() => expect(refresh.messages).toEqual(['done']))
	disconnect()
})

test('still answers done when the revalidation fails', async () => {
	using _globals = shellGlobals()
	using refresh = setUpRefresh()
	const pending = deferred()
	const disconnect = connectShellRefresh(() => ({
		state: 'idle',
		revalidate: () => pending.promise,
	}))
	refresh.pull()
	pending.reject(new Error('offline'))
	await vi.waitFor(() => expect(refresh.messages).toEqual(['done']))
	disconnect()
})

test('answers done at once again after the root unmounts', () => {
	using _globals = shellGlobals()
	using refresh = setUpRefresh()
	const revalidate = vi.fn(() => Promise.resolve())
	const disconnect = connectShellRefresh(() => ({ state: 'idle', revalidate }))
	disconnect()
	refresh.pull()
	expect(refresh.messages).toEqual(['done'])
	expect(revalidate).not.toHaveBeenCalled()
})

// --- launch timing ----------------------------------------------------------

test('reports no shell timing for a Home Screen launch', () => {
	using _globals = shellGlobals()
	expect(getShellLaunchTiming()).toBeNull()
})

test('reports no shell timing when the shell sent a malformed stamp', () => {
	using _globals = shellGlobals()
	window.__qmShell = { initAt: 1000 } as Window['__qmShell']
	expect(getShellLaunchTiming()).toBeNull()
	window.__qmShell = {
		initAt: '1000',
		loadAt: 1200,
	} as unknown as Window['__qmShell']
	expect(getShellLaunchTiming()).toBeNull()
	window.__qmShell = { initAt: Number.NaN, loadAt: 1200 }
	expect(getShellLaunchTiming()).toBeNull()
})

test('measures shell init to load and load to now', () => {
	using _globals = shellGlobals()
	vi.useFakeTimers({ now: 5000 })
	window.__qmShell = { initAt: 1000, loadAt: 1800 }
	expect(getShellLaunchTiming()).toEqual({
		shell_init_to_load_ms: 800,
		shell_load_to_now_ms: 3200,
	})
})
