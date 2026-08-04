/**
 * Client-readable marker set alongside the httpOnly flash-toast cookie
 * (`en_toast`, toast.server.ts). The toast itself stays httpOnly and signed;
 * this cookie carries no data. Its presence tells root's `shouldRevalidate` —
 * which runs in the browser and cannot see the real cookie — that the next
 * root-loader run has a toast to render and clear, so no revalidation-skipping
 * heuristic can strand a flash message. Set by `createToastHeaders`, cleared
 * by `getToast`.
 */
export const TOAST_PENDING_COOKIE = 'en_toast_pending'

export function hasPendingToastCookie() {
	if (typeof document === 'undefined') return false
	return document.cookie
		.split('; ')
		.some((cookie) => cookie.startsWith(`${TOAST_PENDING_COOKIE}=`))
}
