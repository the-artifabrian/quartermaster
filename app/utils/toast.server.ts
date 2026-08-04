import { createId as cuid } from '@paralleldrive/cuid2'
import { createCookieSessionStorage, redirect } from 'react-router'
import { z } from 'zod'
import { combineHeaders } from './misc.tsx'
import { TOAST_PENDING_COOKIE } from './toast-pending.ts'

export const toastKey = 'toast'

const ToastSchema = z.object({
	description: z.string(),
	id: z.string().default(() => cuid()),
	title: z.string().optional(),
	type: z.enum(['message', 'success', 'error']).default('message'),
})

export type Toast = z.infer<typeof ToastSchema>
export type ToastInput = z.input<typeof ToastSchema>

export const toastSessionStorage = createCookieSessionStorage({
	cookie: {
		name: 'en_toast',
		sameSite: 'lax',
		path: '/',
		httpOnly: true,
		secrets: process.env.SESSION_SECRET.split(','),
		secure: process.env.NODE_ENV === 'production',
	},
})

export async function redirectWithToast(
	url: string,
	toast: ToastInput,
	init?: ResponseInit,
) {
	return redirect(url, {
		...init,
		headers: combineHeaders(init?.headers, await createToastHeaders(toast)),
	})
}

const secureSuffix = process.env.NODE_ENV === 'production' ? '; Secure' : ''

export async function createToastHeaders(toastInput: ToastInput) {
	const session = await toastSessionStorage.getSession()
	const toast = ToastSchema.parse(toastInput)
	session.flash(toastKey, toast)
	const cookie = await toastSessionStorage.commitSession(session)
	const headers = new Headers()
	headers.append('set-cookie', cookie)
	// Client-readable presence marker (no data, deliberately not httpOnly):
	// root's shouldRevalidate reads it so a pending toast always forces the
	// root loader to run and deliver it, whatever shape the navigation takes.
	headers.append(
		'set-cookie',
		`${TOAST_PENDING_COOKIE}=1; Path=/; SameSite=Lax${secureSuffix}`,
	)
	return headers
}

export async function getToast(request: Request) {
	const cookieHeader = request.headers.get('cookie')
	const session = await toastSessionStorage.getSession(cookieHeader)
	const result = ToastSchema.safeParse(session.get(toastKey))
	const toast = result.success ? result.data : null
	// Clear the marker whenever it's present, toast or not — a stale marker
	// (e.g. left by a document load that consumed the toast in a response
	// whose Set-Cookie clearing was lost) would force root revalidation on
	// every navigation until the browser session ends.
	const hasPendingMarker =
		cookieHeader?.includes(`${TOAST_PENDING_COOKIE}=`) ?? false
	let headers: Headers | null = null
	if (toast || hasPendingMarker) {
		headers = new Headers()
		if (toast) {
			headers.append(
				'set-cookie',
				await toastSessionStorage.destroySession(session),
			)
		}
		headers.append(
			'set-cookie',
			`${TOAST_PENDING_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secureSuffix}`,
		)
	}
	return { toast, headers }
}
