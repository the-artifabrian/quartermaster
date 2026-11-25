// Staples used to live here, when the feature was a pantry. Bookmarks, the iOS
// app's saved page and tabs still running an older build ask for /inventory.
//
// A load goes on to /staples with its query, as a 301 that reloads the
// document: an older page's route table has no /staples, and a client-side
// redirect would land on its not-found page. The redirect runs as middleware,
// which runs for data requests that name only the routes an older page knew;
// a loader would be skipped for those.
//
// A form post saves. An older page's Staples forms post here, so a data post
// runs the Staples action, and the page's reload of its data afterwards meets
// the redirect. A post without JavaScript gets a 308, which sends the same
// body on to /staples.

import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { redirect, redirectDocument } from 'react-router'
import { type Route } from './+types/inventory.ts'

export { action } from './staples/index.tsx'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const middleware: Route.MiddlewareFunction[] = [
	({ request, url }, next) => {
		if (request.method === 'GET' || request.method === 'HEAD') {
			throw redirectDocument(`/staples${url.search}`, 301)
		}
		const sent = new URL(request.url)
		if (sent.pathname.endsWith('.data')) return next()
		throw redirect(`/staples${sent.search}`, 308)
	},
]

// A route with a loader is always asked on a client navigation, even when no
// other route on the page reloads, so the middleware above gets to answer.
// The middleware answers every load first, so this never runs.
export function loader() {
	return null
}
