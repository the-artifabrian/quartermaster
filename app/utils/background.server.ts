/**
 * Every deliberately unawaited server Promise must pass through this helper.
 * Background work may fail, but its rejection must never terminate the process.
 */
export function runInBackground(promise: Promise<unknown>, label: string) {
	void promise.catch((error: unknown) => {
		console.error(`Background task failed: ${label}`, error)
	})
}
