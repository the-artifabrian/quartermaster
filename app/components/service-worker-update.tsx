import { useCallback, useEffect, useRef, useState } from 'react'
import { useFetchers, useNavigation } from 'react-router'
import { reloadPage } from '#app/utils/reload-page.client.ts'
import { Button } from './ui/button.tsx'

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

const UPDATE_CONFIRMATION =
	'Update Quartermaster now? The app will reload and unsaved edits may be lost.'

type RouterNavigation = { state: 'idle' | 'loading' | 'submitting' }
type RouterFetcher = {
	state: 'idle' | 'loading' | 'submitting'
	formMethod?: string
}

export function hasPendingRouterWork(
	navigation: RouterNavigation,
	fetchers: RouterFetcher[],
) {
	if (navigation.state !== 'idle') return true
	return fetchers.some(
		(fetcher) =>
			fetcher.state !== 'idle' &&
			fetcher.formMethod != null &&
			fetcher.formMethod.toUpperCase() !== 'GET',
	)
}

/**
 * Registers the production worker after first paint and exposes an explicit
 * update boundary. A waiting worker cannot replace the running page until the
 * user accepts; other open windows keep working against the retained N-1 cache.
 */
export function ServiceWorkerUpdate() {
	const navigation = useNavigation()
	const fetchers = useFetchers()
	const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
	const [isActivating, setIsActivating] = useState(false)
	const [isOnline, setIsOnline] = useState(true)
	const activationRequested = useRef(false)
	const reloadRequested = useRef(false)
	const reloadOnce = useCallback(() => {
		if (reloadRequested.current) return
		reloadRequested.current = true
		reloadPage()
	}, [])

	useEffect(() => {
		if (!('serviceWorker' in navigator) || ENV.MODE !== 'production') return
		const serviceWorkers = navigator.serviceWorker

		let disposed = false
		let registration: ServiceWorkerRegistration | null = null
		let lastUpdateCheck = 0
		const observedWorkers = new Map<ServiceWorker, () => void>()
		setIsOnline(navigator.onLine)

		function revealWaitingWorker() {
			// During a first registration Chromium can briefly expose the installed
			// worker as `waiting` before activating it. It is only an update when an
			// existing active generation is present.
			if (!disposed && registration?.active && registration.waiting) {
				setWaitingWorker(registration.waiting)
			}
		}

		function observeInstallingWorker() {
			const worker = registration?.installing
			if (!worker || observedWorkers.has(worker)) return

			const onStateChange = () => {
				if (worker.state === 'installed') revealWaitingWorker()
				if (worker.state === 'activated' || worker.state === 'redundant') {
					worker.removeEventListener('statechange', onStateChange)
					observedWorkers.delete(worker)
				}
			}
			observedWorkers.set(worker, onStateChange)
			worker.addEventListener('statechange', onStateChange)
			onStateChange()
		}

		function observeRegistration(next: ServiceWorkerRegistration) {
			if (disposed) return
			registration = next
			registration.addEventListener('updatefound', observeInstallingWorker)
			revealWaitingWorker()
			observeInstallingWorker()
		}

		function register() {
			lastUpdateCheck = Date.now()
			void serviceWorkers
				.register('/sw.js')
				.then(observeRegistration)
				.catch(() => {})
		}

		function checkForUpdate() {
			if (
				document.visibilityState !== 'visible' ||
				!navigator.onLine ||
				!registration ||
				Date.now() - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS
			) {
				return
			}

			// Throttle attempts, not only successes: a long outage must not cause an
			// update request on every visibility event.
			lastUpdateCheck = Date.now()
			void registration
				.update()
				.then(revealWaitingWorker)
				.catch(() => {})
		}

		function onControllerChange() {
			if (activationRequested.current) {
				reloadOnce()
				return
			}

			// Another window may have accepted the same update. Do not reload this
			// window without its user's consent; N-1 assets keep its old code usable.
			setWaitingWorker(null)
			setIsActivating(false)
		}

		const onVisibilityChange = () => checkForUpdate()
		const onOnline = () => {
			setIsOnline(true)
			checkForUpdate()
		}
		const onOffline = () => setIsOnline(false)
		serviceWorkers.addEventListener('controllerchange', onControllerChange)
		document.addEventListener('visibilitychange', onVisibilityChange)
		window.addEventListener('online', onOnline)
		window.addEventListener('offline', onOffline)

		if (document.readyState === 'complete') register()
		else window.addEventListener('load', register, { once: true })

		return () => {
			disposed = true
			window.removeEventListener('load', register)
			document.removeEventListener('visibilitychange', onVisibilityChange)
			window.removeEventListener('online', onOnline)
			window.removeEventListener('offline', onOffline)
			serviceWorkers.removeEventListener('controllerchange', onControllerChange)
			registration?.removeEventListener('updatefound', observeInstallingWorker)
			for (const [worker, listener] of observedWorkers) {
				worker.removeEventListener('statechange', listener)
			}
		}
	}, [reloadOnce])

	useEffect(() => {
		if (!isActivating || !waitingWorker) return

		// A page left uncontrolled after its first registration will not receive
		// `controllerchange`, so activation itself is also a reload boundary.
		const onStateChange = () => {
			if (waitingWorker.state === 'activated') reloadOnce()
		}
		waitingWorker.addEventListener('statechange', onStateChange)
		onStateChange()
		return () =>
			waitingWorker.removeEventListener('statechange', onStateChange)
	}, [isActivating, reloadOnce, waitingWorker])

	const isBusy = hasPendingRouterWork(navigation, fetchers)
	if (!waitingWorker || isBusy) return null

	function acceptUpdate() {
		if (
			!waitingWorker ||
			isActivating ||
			!navigator.onLine ||
			!window.confirm(UPDATE_CONFIRMATION)
		) {
			return
		}

		activationRequested.current = true
		setIsActivating(true)
		try {
			waitingWorker.postMessage({ type: 'qm-activate-update' })
		} catch {
			activationRequested.current = false
			setIsActivating(false)
		}
	}

	return (
		<div className="bg-card border-border shadow-warm-lg fixed right-4 bottom-24 z-50 flex items-center gap-3 rounded-lg border p-3 md:bottom-4">
			<span
				role="status"
				aria-live="polite"
				className="text-foreground text-sm"
			>
				A new version is ready.
			</span>
			<Button
				type="button"
				size="sm"
				onClick={acceptUpdate}
				disabled={isActivating || !isOnline}
			>
				{isActivating
					? 'Updating…'
					: isOnline
						? 'Update available'
						: 'Update when online'}
			</Button>
		</div>
	)
}
