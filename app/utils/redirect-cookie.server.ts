import * as cookie from 'cookie'

const key = 'redirectTo'
export const destroyRedirectToHeader = cookie.stringifySetCookie({
	name: key,
	value: '',
	maxAge: -1,
})

export function getRedirectCookieHeader(redirectTo?: string) {
	return redirectTo && redirectTo !== '/'
		? cookie.stringifySetCookie({
				name: key,
				value: redirectTo,
				maxAge: 60 * 10,
			})
		: null
}

export function getRedirectCookieValue(request: Request) {
	const rawCookie = request.headers.get('cookie')
	const parsedCookies = rawCookie ? cookie.parseCookie(rawCookie) : {}
	const redirectTo = parsedCookies[key]
	return redirectTo || null
}
