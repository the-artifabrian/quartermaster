import { useEffect, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

function subscribe(callback: () => void) {
	window.addEventListener('online', callback)
	window.addEventListener('offline', callback)
	return () => {
		window.removeEventListener('online', callback)
		window.removeEventListener('offline', callback)
	}
}

function getSnapshot() {
	return navigator.onLine
}

function getServerSnapshot() {
	return true
}

const TOAST_ID = 'offline-indicator'
/**
 * Whether this component showed the notice and has not dismissed it since,
 * even if the × closed it. Outside the component, so a remount knows.
 */
let shown = false

/** Whether the browser reports a network; true during server rendering. */
export function useIsOnline() {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function OfflineIndicator() {
	const isOnline = useIsOnline()

	useEffect(() => {
		if (!isOnline) {
			toast.warning("You're offline", {
				id: TOAST_ID,
				description: 'Some features may be unavailable.',
				duration: Infinity,
			})
			shown = true
		} else if (shown) {
			// Only a notice that was shown: Sonner applies a dismiss a frame or
			// two later, so one sent as the page hydrates online would close a
			// notice opened right after it.
			toast.dismiss(TOAST_ID)
			shown = false
		}
	}, [isOnline])

	return null
}
