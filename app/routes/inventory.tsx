// Staples used to live here, when the feature was a pantry. Bookmarks, the iOS
// app's saved page and tabs still running an older build ask for /inventory,
// so every request here is sent on to /staples with its query.
//
// The redirect runs as middleware because middleware runs for every request,
// whatever its method, and for data requests that name only the routes an
// older page knew. A loader would be skipped for those. It reloads the
// document because an older page's route table has no /staples, and a
// client-side redirect would land on its not-found page.

import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { redirectDocument } from 'react-router'
import { type Route } from './+types/inventory.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const middleware: Route.MiddlewareFunction[] = [
	({ url }) => {
		throw redirectDocument(`/staples${url.search}`, 301)
	},
]

// Gives the route a loader, so a client navigation here asks the server and
// meets the middleware. It never runs.
export function loader() {
	return null
}
