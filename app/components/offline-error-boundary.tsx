import { useEffect } from 'react'
import {
	isRouteErrorResponse,
	useLocation,
	useRevalidator,
	useRouteError,
} from 'react-router'
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

	useEffect(() => {
		const onOnline = () => void revalidate()
		window.addEventListener('online', onOnline)
		return () => window.removeEventListener('online', onOnline)
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
					if (!unavailable) void revalidate()
				}}
			>
				{retrying ? 'Retrying…' : isOnline ? 'Retry' : 'Connect to retry'}
			</Button>
		</div>
	)
}
