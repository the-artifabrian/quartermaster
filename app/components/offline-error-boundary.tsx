import { useEffect, useRef } from 'react'
import {
	isRouteErrorResponse,
	useLocation,
	useRevalidator,
	useRouteError,
} from 'react-router'
import { retryTabOnly } from '#app/utils/tab-retry.ts'
import { GeneralErrorBoundary } from './error-boundary.tsx'
import { useIsOnline } from './offline-indicator.tsx'
import { Button } from './ui/button.tsx'

/**
 * The service worker answers Route data it has no copy of with a 503 "Offline"
 * while the network is down. Without a network, any route error response or a
 * failed fetch (TypeError) counts too. Other errors are bugs and go to the
 * general boundary, which reports them.
 */
function isOfflineError(error: unknown) {
	if (
		isRouteErrorResponse(error) &&
		error.status === 503 &&
		error.data === 'Offline'
	) {
		return true
	}
	const offline = typeof navigator !== 'undefined' && !navigator.onLine
	return offline && (isRouteErrorResponse(error) || error instanceof TypeError)
}

// The `online` event can arrive before requests get through (a radio coming
// up; in Chromium, the page before its service worker). A retry that fails
// leaves this notice up, so try a few times; success unmounts it.
const ONLINE_RETRY_DELAYS_MS = [0, 1000, 3000]

const TAB_NAMES: Array<[prefix: string, name: string]> = [
	['/recipes', 'Recipes'],
	['/inventory', 'Staples'],
	['/plan', 'Plan'],
	['/shopping', 'Shopping'],
]

function tabName(pathname: string) {
	return (
		TAB_NAMES.find(
			([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
		)?.[1] ?? 'This page'
	)
}

/**
 * A tab route's boundary. It renders inside the app, so the header and tab bar
 * stay and the user can go back to a page this device already has. The
 * offline toast carries the headline; this says why the page is empty. It
 * retries by itself when the network comes back.
 */
export function OfflineErrorBoundary() {
	const error = useRouteError()
	if (!isOfflineError(error)) return <GeneralErrorBoundary />
	return <OfflineNotice />
}

function OfflineNotice() {
	const { pathname } = useLocation()
	const { revalidate, state } = useRevalidator()
	const isOnline = useIsOnline()

	// One run of attempts at a time, however many online events arrive.
	const running = useRef(false)
	useEffect(() => {
		let cancelled = false
		const onOnline = async () => {
			if (running.current) return
			running.current = true
			try {
				for (const delay of ONLINE_RETRY_DELAYS_MS) {
					await new Promise((resolve) => setTimeout(resolve, delay))
					if (cancelled || !navigator.onLine) return
					await retryTabOnly(revalidate).catch(() => {})
				}
			} finally {
				running.current = false
			}
		}
		const listener = () => void onOnline()
		window.addEventListener('online', listener)
		return () => {
			cancelled = true
			window.removeEventListener('online', listener)
		}
	}, [revalidate])

	const retrying = state === 'loading'
	const unavailable = !isOnline || retrying
	return (
		<div
			role="status"
			className="container flex flex-col items-center gap-4 px-6 py-20 text-center"
		>
			<h1 className="font-serif text-2xl">{tabName(pathname)}</h1>
			<p className="text-muted-foreground max-w-sm">
				This page hasn’t been loaded on this device yet. Connect and try again.
			</p>
			<Button
				variant="outline"
				aria-disabled={unavailable || undefined}
				className="aria-disabled:opacity-50"
				onClick={() => {
					if (!unavailable) void retryTabOnly(revalidate)
				}}
			>
				{retrying ? 'Retrying…' : isOnline ? 'Retry' : 'Connect to retry'}
			</Button>
		</div>
	)
}
