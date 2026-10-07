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
		} else {
			toast.dismiss(TOAST_ID)
		}
	}, [isOnline])

	return null
}
