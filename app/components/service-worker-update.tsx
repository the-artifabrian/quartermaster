import { useCallback, useEffect, useRef, useState } from 'react'
import { useFetchers, useNavigation } from 'react-router'
import {
	PWA_UPDATE_ACCEPTED,
	PWA_UPDATE_PROMPT_SHOWN,
} from '#app/utils/posthog-events.ts'
import { usePostHog } from '#app/utils/posthog-provider.tsx'
import {
	forgetPendingPwaUpdate,
	markPendingPwaUpdateActivated,
	type PwaUpdateTrigger,
	rememberPendingPwaUpdate,
	rememberPwaUpdatePrompt,
} from '#app/utils/pwa-update-telemetry.ts'
import { reloadPage } from '#app/utils/reload-page.client.ts'

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
/** A return from background after this long applies a waiting update. */
export const RESUME_ACTIVATION_AFTER_MS = 30 * 60 * 1000
/**
 * A browser can hold an activation for minutes. Past this, or after a tap or
 * key press, the page no longer reloads when it lands and keeps running
 * against the retained N-1 cache, as another window would.
 */
export const ACTIVATION_RELOAD_DEADLINE_MS = 10 * 1000

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
 * Registers the production worker after first paint and applies a waiting
 * update, without asking, at two moments only: the launch of this document,
 * and a return from background after RESUME_ACTIVATION_AFTER_MS or more. Each
 * moment covers the worker that is waiting when it happens, and the user's
 * first tap or key press ends it, so the page never reloads under someone who
 * has started using it. The same holds while the activation is in flight, and
 * an activation that lands after ACTIVATION_RELOAD_DEADLINE_MS reloads nothing.
 * A worker that becomes waiting mid-session waits for the next moment. Other
 * open windows keep working against the retained N-1 cache until they launch
 * again.
 */
export function ServiceWorkerUpdate() {
	const navigation = useNavigation()
	const fetchers = useFetchers()
	const posthog = usePostHog()
	const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
	// Every document starts as a launch. The moment closes once registration
	// shows no waiting update, on the first interaction, or when it activates.
	const [moment, setMoment] = useState<PwaUpdateTrigger | null>('launch')
	const [isActivating, setIsActivating] = useState(false)
	const activationRequested = useRef(false)
	const activationStartedAt = useRef(0)
	const interactedDuringActivation = useRef(false)
	const reloadRequested = useRef(false)
	/** Reload once for this page's own activation, if it is still unused. */
	const reloadForActivation = useCallback(() => {
		if (!activationRequested.current) return false
		if (
			interactedDuringActivation.current ||
			Date.now() - activationStartedAt.current > ACTIVATION_RELOAD_DEADLINE_MS
		) {
			activationRequested.current = false
			setIsActivating(false)
			setWaitingWorker(null)
			setMoment(null)
			return false
		}
		if (!reloadRequested.current) {
			reloadRequested.current = true
			markPendingPwaUpdateActivated()
			reloadPage()
		}
		return true
	}, [])

	useEffect(() => {
		if (!('serviceWorker' in navigator) || ENV.MODE !== 'production') return
		const serviceWorkers = navigator.serviceWorker

		let disposed = false
		let registration: ServiceWorkerRegistration | null = null
		let lastUpdateCheck = 0
		let hiddenAt: number | null = null
		const observedWorkers = new Map<ServiceWorker, () => void>()

		// During a first registration Chromium can briefly expose the installed
		// worker as `waiting` before activating it. It is only an update when an
		// existing active generation is present.
		function getWaitingUpdate() {
			return registration?.active && registration.waiting
				? registration.waiting
				: null
		}

		function revealWaitingWorker() {
			const worker = getWaitingUpdate()
			if (!disposed && worker) setWaitingWorker(worker)
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
			// The launch moment covers only a worker that was already waiting.
			if (!getWaitingUpdate()) {
				setMoment((current) => (current === 'launch' ? null : current))
			}
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
			if (reloadForActivation()) return

			// Another window applied the update, or this one's landed too late to
			// reload. The page keeps running its code against the N-1 assets until
			// it launches again.
			setWaitingWorker(null)
		}

		function onVisibilityChange() {
			if (document.visibilityState === 'hidden') {
				hiddenAt ??= Date.now()
				return
			}
			if (document.visibilityState !== 'visible') return
			const awayFor = hiddenAt == null ? 0 : Date.now() - hiddenAt
			hiddenAt = null
			const worker = getWaitingUpdate()
			if (awayFor >= RESUME_ACTIVATION_AFTER_MS && worker) {
				setWaitingWorker(worker)
				setMoment('resume')
			}
			checkForUpdate()
		}

		const onOnline = () => checkForUpdate()
		serviceWorkers.addEventListener('controllerchange', onControllerChange)
		document.addEventListener('visibilitychange', onVisibilityChange)
		window.addEventListener('online', onOnline)

		if (document.readyState === 'complete') register()
		else window.addEventListener('load', register, { once: true })

		return () => {
			disposed = true
			window.removeEventListener('load', register)
			document.removeEventListener('visibilitychange', onVisibilityChange)
			window.removeEventListener('online', onOnline)
			serviceWorkers.removeEventListener('controllerchange', onControllerChange)
			registration?.removeEventListener('updatefound', observeInstallingWorker)
			for (const [worker, listener] of observedWorkers) {
				worker.removeEventListener('statechange', listener)
			}
		}
	}, [reloadForActivation])

	// A tap or key press means someone is using the page: leave it alone.
	useEffect(() => {
		if (!moment && !isActivating) return
		const onInteraction = () => {
			setMoment(null)
			if (activationRequested.current) interactedDuringActivation.current = true
		}
		const options = { capture: true, passive: true }
		window.addEventListener('pointerdown', onInteraction, options)
		window.addEventListener('keydown', onInteraction, options)
		return () => {
			window.removeEventListener('pointerdown', onInteraction, options)
			window.removeEventListener('keydown', onInteraction, options)
		}
	}, [isActivating, moment])

	useEffect(() => {
		if (!isActivating || !waitingWorker) return

		// A page left uncontrolled after its first registration will not receive
		// `controllerchange`, so activation itself is also a reload boundary.
		const onStateChange = () => {
			if (waitingWorker.state === 'activated') reloadForActivation()
			if (waitingWorker.state === 'redundant') {
				// A newer deploy installed over this worker. Drop it, so the next
				// moment can apply the newer one.
				activationRequested.current = false
				setIsActivating(false)
				setWaitingWorker(null)
				forgetPendingPwaUpdate()
			}
		}
		waitingWorker.addEventListener('statechange', onStateChange)
		onStateChange()
		return () => waitingWorker.removeEventListener('statechange', onStateChange)
	}, [isActivating, reloadForActivation, waitingWorker])

	// Wait for a pending navigation or mutation, so the reload loses neither.
	const isBusy = hasPendingRouterWork(navigation, fetchers)
	useEffect(() => {
		if (!moment || !waitingWorker || isBusy || activationRequested.current) {
			return
		}
		setMoment(null)
		// Offline the reload could not fetch the new document. Keep the page.
		if (!navigator.onLine) return

		activationRequested.current = true
		activationStartedAt.current = Date.now()
		interactedDuringActivation.current = false
		setIsActivating(true)
		const shown = rememberPwaUpdatePrompt({
			workerState: waitingWorker.state,
			trigger: moment,
		})
		posthog.capture(PWA_UPDATE_PROMPT_SHOWN, shown.properties, {
			uuid: shown.uuid,
			timestamp: new Date(shown.timestamp),
		})
		const acceptance = rememberPendingPwaUpdate({ fromBuild: ENV.APP_BUILD })
		posthog.capture(PWA_UPDATE_ACCEPTED, acceptance.properties, {
			uuid: acceptance.uuid,
			timestamp: new Date(acceptance.timestamp),
		})
		try {
			waitingWorker.postMessage({ type: 'qm-activate-update' })
		} catch {
			activationRequested.current = false
			setIsActivating(false)
			forgetPendingPwaUpdate()
		}
	}, [isBusy, moment, posthog, waitingWorker])

	return null
}
