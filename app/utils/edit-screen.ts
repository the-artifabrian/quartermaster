/**
 * Sent by a hydrated edit screen with its Save or Delete. The action then
 * answers `{ done: path }` instead of redirecting, and the screen leaves by
 * itself (edit-screen.tsx): back to the page it was opened from where it can,
 * so the history behind is as if the edit screen was dismissed. Without
 * JavaScript the field is missing and the action redirects as before.
 */
export const CLIENT_LEAVES_FIELD = '_clientLeaves'

export function clientLeaves(formData: FormData) {
	return formData.get(CLIENT_LEAVES_FIELD) === '1'
}

/**
 * What an action answers a hydrated edit screen once it is done. `notice` is
 * a message the screen shows as it leaves. It can't go in a toast cookie:
 * leaving cancels the root reload that would read the cookie, so on a slow
 * load the toast is lost.
 */
export type EditScreenDone = { done: string; notice?: string }

export function isEditScreenDone(value: unknown): value is EditScreenDone {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { done?: unknown }).done === 'string'
	)
}
