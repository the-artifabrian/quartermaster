const running = new Set<Promise<unknown>>()

/**
 * Every deliberately unawaited server Promise must pass through this helper.
 * Background work may fail, but its rejection must never terminate the process.
 */
export function runInBackground(promise: Promise<unknown>, label: string) {
	const task = promise
		.catch((error: unknown) => {
			console.error(`Background task failed: ${label}`, error)
		})
		.finally(() => running.delete(task))
	running.add(task)
}

/**
 * Waits until the background work started so far has finished, including
 * work it starts in turn. Tests use it to read what that work wrote.
 */
export async function backgroundWorkSettled() {
	while (running.size > 0) await Promise.all(running)
}
