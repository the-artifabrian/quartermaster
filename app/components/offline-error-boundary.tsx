import {
	isRouteErrorResponse,
	useRevalidator,
	useRouteError,
} from 'react-router'
import { GeneralErrorBoundary } from './error-boundary.tsx'
import { Button } from './ui/button.tsx'

/**
 * The service worker answers Route data it has no copy of with a 503 "Offline"
 * while the network is down. Any error while the browser reports no network
 * counts too.
 */
function isOfflineError(error: unknown) {
	if (
		isRouteErrorResponse(error) &&
		error.status === 503 &&
		error.data === 'Offline'
	) {
		return true
	}
	return typeof navigator !== 'undefined' && !navigator.onLine
}

/**
 * A tab route's boundary. It renders inside the app, so the header and tab bar
 * stay and the user can go back to a page this device already has. The
 * offline toast carries the headline; this says why the page is empty.
 */
export function OfflineErrorBoundary() {
	const error = useRouteError()
	const { revalidate, state } = useRevalidator()
	if (!isOfflineError(error)) return <GeneralErrorBoundary />

	const retrying = state === 'loading'
	return (
		<div className="container flex flex-col items-center gap-4 px-6 py-20 text-center">
			<p className="text-muted-foreground max-w-sm">
				This page hasn’t been loaded on this device yet. Connect and try again.
			</p>
			<Button
				variant="outline"
				disabled={retrying}
				onClick={() => void revalidate()}
			>
				{retrying ? 'Retrying…' : 'Retry'}
			</Button>
		</div>
	)
}
