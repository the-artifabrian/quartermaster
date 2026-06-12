/**
 * System notifications for kitchen timers — the local layer.
 *
 * The in-page Web-Audio beep dies the moment the tab is backgrounded or the
 * phone switches apps; a service-worker notification survives on desktop tabs
 * and Android. (iOS suspends a backgrounded PWA's JS wholesale, so anything
 * scheduled client-side sleeps with it — reliable lock-screen delivery there
 * needs a server-scheduled Web Push, deliberately not built yet.)
 */

/**
 * Ask for notification permission the first time a timer starts. Must be
 * called from a user gesture. Declining quietly degrades to the in-page
 * beep-and-vibrate behavior.
 */
export function maybeRequestTimerNotificationPermission() {
	try {
		if (typeof Notification === 'undefined') return
		if (Notification.permission === 'default') {
			void Notification.requestPermission()
		}
	} catch {
		// Notification API unavailable (some webviews) — in-page alarm still works
	}
}

/**
 * Show a "timer done" system notification via the service worker. No-op when
 * permission wasn't granted or no service worker is registered (dev mode).
 */
export async function showTimerDoneNotification(timer: {
	id: string
	label: string
}) {
	try {
		if (
			typeof Notification === 'undefined' ||
			Notification.permission !== 'granted' ||
			!('serviceWorker' in navigator)
		) {
			return
		}
		const registration = await navigator.serviceWorker.ready
		await registration.showNotification('Timer done', {
			body: timer.label,
			tag: `qm-timer-${timer.id}`,
			icon: '/favicons/android-chrome-192x192.png',
			badge: '/favicons/android-chrome-192x192.png',
			// vibrate is Android-only and missing from lib.dom's options type
			...({ vibrate: [200, 100, 200, 100, 200] } as object),
		})
	} catch {
		// Notification failed — the in-page alarm already played/will play
	}
}
