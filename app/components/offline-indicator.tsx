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

export function OfflineIndicator() {
	const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

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
