import { remember } from '@epic-web/remember'

type CloseEventStream = () => void

const activeEventStreams = remember(
	'activeEventStreams',
	() => new Set<CloseEventStream>(),
)

export function registerEventStream(close: CloseEventStream) {
	activeEventStreams.add(close)
	return () => activeEventStreams.delete(close)
}

export function closeEventStreams() {
	const streams = [...activeEventStreams]
	activeEventStreams.clear()
	for (const close of streams) {
		try {
			close()
		} catch (error) {
			console.error('Failed to close event stream during shutdown', error)
		}
	}
}
