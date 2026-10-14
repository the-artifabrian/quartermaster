import { type Page } from '@playwright/test'

// The iOS app loads the Web app in a WKWebView and appends
// `QuartermasterShell/1` to the user agent. Tests set one of these to see
// the Web app as the iOS app or as Safari on the same phone.
export const SAFARI_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
export const SHELL_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 QuartermasterShell/1'

// Chromium has no home indicator, so env(safe-area-inset-bottom) is 0. This
// gives the page the inset of an iPhone with one (34pt). Call it before goto.
export async function setHomeIndicatorInset(page: Page, bottom = 34) {
	const cdp = await page.context().newCDPSession(page)
	await cdp.send('Emulation.setSafeAreaInsetsOverride', {
		insets: { top: 0, left: 0, right: 0, bottom },
	})
}

// The iOS app sets the screen's insets on <html> at document start, before
// env(safe-area-inset-*) has them (iOS README, "Safe area"). Call it before
// goto. Playwright's init script can run before <html> exists.
export async function setShellSafeArea(
	page: Page,
	insets: { top: number; bottom: number },
) {
	await page.addInitScript((insets) => {
		const apply = () => {
			const root = document.documentElement
			if (!root) return false
			root.style.setProperty('--qm-shell-safe-top', `${insets.top}px`)
			root.style.setProperty('--qm-shell-safe-bottom', `${insets.bottom}px`)
			return true
		}
		if (apply()) return
		new MutationObserver((_, observer) => {
			if (apply()) observer.disconnect()
		}).observe(document, { childList: true })
	}, insets)
}
