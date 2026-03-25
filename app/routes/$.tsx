// This is called a "splat route" and as it's in the root `/app/routes/`
// directory, it's a catchall. If no other routes match, this one will and we
// can know that the user is hitting a URL that doesn't exist. By throwing a
// 404 from the loader, we can force the error boundary to render which will
// ensure the user gets the right status code and we can display a nicer error
// message for them than the Remix and/or browser default.

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
	// due to the loader, this component will never be rendered, but we'll return
	// the error boundary just in case.
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
						<Link
							to="/"
							className="text-primary underline underline-offset-4"
						>
							<Icon name="arrow-left">Back to home</Icon>
						</Link>
					</div>
				),
			}}
		/>
	)
}
