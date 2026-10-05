/**
 * The iOS app is a native shell around a web view that loads the Web app. It
 * appends `QuartermasterShell/<version>` to the web view's user agent, and the
 * server keys shell-only behaviour off that token.
 *
 * Anyone can send the token, so it may only hide things or pick safer
 * defaults (a session cookie that survives the app being killed). It must
 * never grant access.
 */
const SHELL_TOKEN = /(?:^|\s)QuartermasterShell\/[1-9]\d*(?=\s|$)/

export function isNativeShell(request: Request): boolean {
	const userAgent = request.headers.get('User-Agent')
	return userAgent !== null && SHELL_TOKEN.test(userAgent)
}
