import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Outlet, useMatches } from 'react-router'
import { type NavBarHandle } from '#app/components/nav-bar.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { settingsPageNav } from '#app/utils/nav-back.ts'
import { type Route } from './+types/_layout.tsx'

export type SettingsPageHandle = { pageTitle: string }

// Every page under Settings goes back to Settings; Settings itself (the
// index route) declares its own.
export const handle: SEOHandle & NavBarHandle = {
	getSitemapEntries: () => null,
	nav: settingsPageNav,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Settings | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserId(request)
	return {}
}

export default function SettingsLayout() {
	const matches = useMatches()
	const pageTitle = [...matches]
		.reverse()
		.map((m) => (m.handle as SettingsPageHandle | undefined)?.pageTitle)
		.find(Boolean)

	return (
		<div className="container max-w-3xl pt-8 pb-24">
			<h1 className="mb-6 font-serif text-2xl font-normal">
				{pageTitle ?? 'Settings'}
			</h1>
			<Outlet />
		</div>
	)
}
