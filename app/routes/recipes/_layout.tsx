import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Outlet } from 'react-router'
import { BottomNav } from '#app/components/bottom-nav.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { type Route } from './+types/_layout.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserId(request)
	return {}
}

export default function RecipesLayout() {
	return (
		<div className="flex min-h-[calc(100vh-6rem)] flex-col pb-20 md:pb-0">
			<Outlet />
			<BottomNav />
		</div>
	)
}
