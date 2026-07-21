import { generateSitemap } from '@nasa-gcn/remix-seo'
import { getDomainUrl } from '#app/utils/misc.tsx'
import { type Route } from './+types/sitemap[.]xml.ts'

export async function loader({ request }: Route.LoaderArgs) {
	// Imported at request time (not statically) because the server build is
	// this bundle itself in prod — the loader runs long after module init, so
	// the circular import is fully resolved by then. This avoids passing the
	// build through getLoadContext, which under RR8 would require constructing
	// a RouterContextProvider whose class identity differs between Vite's SSR
	// module runner (development build) and the natively-loaded express
	// adapter (production build) in dev.
	const serverBuild = await import('virtual:react-router/server-build')
	return generateSitemap(request, serverBuild.routes, {
		siteUrl: getDomainUrl(request),
		headers: {
			'Cache-Control': `public, max-age=${60 * 5}`,
		},
	})
}
