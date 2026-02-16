import { generateRobotsTxt } from '@nasa-gcn/remix-seo'
import { getDomainUrl } from '#app/utils/misc.tsx'
import { type Route } from './+types/robots[.]txt.ts'

export function loader({ request }: Route.LoaderArgs) {
	return generateRobotsTxt([
		{ type: 'disallow', value: '/settings' },
		{ type: 'disallow', value: '/resources' },
		{ type: 'disallow', value: '/_auth' },
		{ type: 'disallow', value: '/admin' },
		{ type: 'disallow', value: '/household' },
		{ type: 'disallow', value: '/recipes' },
		{ type: 'disallow', value: '/inventory' },
		{ type: 'disallow', value: '/plan' },
		{ type: 'disallow', value: '/shopping' },
		{ type: 'sitemap', value: `${getDomainUrl(request)}/sitemap.xml` },
	])
}
