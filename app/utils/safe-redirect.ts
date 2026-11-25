import { safeRedirect as pathOnly } from 'remix-utils/safe-redirect'

/**
 * Where to send the browser, from a value it sent: a path in this app, or
 * `defaultRedirect`. remix-utils' check turns away other sites' addresses
 * (//, /\, full URLs). This also turns away any control character,
 * whitespace or backslash: browsers drop tabs and newlines from a URL and
 * read a backslash as a slash, so "/\t/evil.com" would land on another site.
 * Import this, never the library's function.
 */
export function safeRedirect(to: unknown, defaultRedirect = '/') {
	if (typeof to !== 'string') return defaultRedirect
	// oxlint-disable-next-line no-control-regex -- control characters are the point
	if (/[\u0000-\u001f\u007f\s\\]/.test(to)) return defaultRedirect
	return pathOnly(to, defaultRedirect)
}
