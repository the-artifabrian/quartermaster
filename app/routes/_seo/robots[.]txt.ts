import { generateRobotsTxt } from '@nasa-gcn/remix-seo'
import { getAppOrigin } from '#app/utils/app-origin.server.ts'

export function loader() {
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
		{ type: 'sitemap', value: `${getAppOrigin()}/sitemap.xml` },
	])
}
