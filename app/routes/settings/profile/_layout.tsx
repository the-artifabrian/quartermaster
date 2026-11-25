import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Outlet, useMatches } from 'react-router'
import { type NavBarHandle } from '#app/components/nav-bar.tsx'
import { OfflineErrorBoundary } from '#app/components/offline-error-boundary.tsx'
import { TabTitle } from '#app/components/ui/title-add-button.tsx'
import { cn } from '#app/utils/misc.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { settingsPageNav } from '#app/utils/nav-back.ts'
import { type Route } from './+types/_layout.tsx'

export type SettingsPageHandle = { pageTitle: string }

// Every page under Settings goes back to Settings; Settings itself (the
// index route) is a tab root and declares none.
export const handle: SEOHandle & NavBarHandle = {
	getSitemapEntries: () => null,
	nav: settingsPageNav,
}

// A tab's boundary: offline, a page this device has not loaded yet says so
// inside the app, with the tab bar.
export const ErrorBoundary = OfflineErrorBoundary

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
		<div
			className={cn(
				'container max-w-3xl pb-24',
				// A tab's page starts its title near the top on a phone, as the
				// other tabs do; its pushed pages keep their room under the bar.
				pageTitle ? 'pt-8' : 'pt-4 md:pt-8',
			)}
		>
			{pageTitle ? (
				<h1 className="mb-6 font-serif text-2xl">{pageTitle}</h1>
			) : (
				<TabTitle className="mb-6">Settings</TabTitle>
			)}
			<Outlet />
		</div>
	)
}
