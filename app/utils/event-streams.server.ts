import { remember } from '@epic-web/remember'

type CloseEventStream = () => void

export function createEventStreamRegistry() {
	const active = new Set<CloseEventStream>()
	let closing = false

	function closeSafely(close: CloseEventStream) {
		try {
			close()
		} catch (error) {
			console.error('Failed to close event stream during shutdown', error)
		}
	}

	return {
		register(close: CloseEventStream) {
			if (closing) {
				closeSafely(close)
				return () => false
			}
			active.add(close)
			return () => active.delete(close)
		},
		closeAll() {
			closing = true
			const streams = [...active]
			active.clear()
			for (const close of streams) closeSafely(close)
		},
	}
}

// The custom HTTP server imports this source module while React Router serves
// a Vite-built copy. `remember` stores the registry on globalThis so both
// module instances close the same streams in production.
const eventStreamRegistry = remember(
	'eventStreamRegistry',
	createEventStreamRegistry,
)

export function registerEventStream(close: CloseEventStream) {
	return eventStreamRegistry.register(close)
}

export function closeEventStreams() {
	eventStreamRegistry.closeAll()
}
