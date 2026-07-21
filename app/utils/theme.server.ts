import * as cookie from 'cookie'

const cookieName = 'en_theme'
export type Theme = 'light' | 'dark'

export function getTheme(request: Request): Theme | null {
	const cookieHeader = request.headers.get('cookie')
	const parsed = cookieHeader
		? cookie.parseCookie(cookieHeader)[cookieName]
		: 'light'
	if (parsed === 'light' || parsed === 'dark') return parsed
	return null
}

export function setTheme(theme: Theme | 'system') {
	if (theme === 'system') {
		return cookie.stringifySetCookie({
			name: cookieName,
			value: '',
			path: '/',
			maxAge: -1,
		})
	} else {
		return cookie.stringifySetCookie({
			name: cookieName,
			value: theme,
			path: '/',
			maxAge: 31536000,
		})
	}
}
