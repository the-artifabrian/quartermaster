// Matches any URL no other route does. The loader and action throw a 404, so
// the response carries the right status and the error boundary renders the
// page.

import { Link, useLocation } from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Icon } from '#app/components/ui/icon.tsx'

export function loader() {
	throw new Response('Not found', { status: 404 })
}

export function action() {
	throw new Response('Not found', { status: 404 })
}

export default function NotFound() {
	// The loader always throws, so this never renders.
	return <ErrorBoundary />
}

export function ErrorBoundary() {
	const location = useLocation()
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: () => (
					<div className="flex flex-col items-center gap-6 py-12 text-center">
						<div className="flex flex-col gap-3">
							<h1 className="font-serif text-2xl">Page not found</h1>
							<p className="text-muted-foreground">
								There's nothing at{' '}
								<code className="bg-muted rounded px-1.5 py-0.5 text-sm break-all">
									{location.pathname}
								</code>
							</p>
						</div>
						<Link to="/" className="text-primary underline underline-offset-4">
							<Icon name="arrow-left">Back to home</Icon>
						</Link>
					</div>
				),
			}}
		/>
	)
}
