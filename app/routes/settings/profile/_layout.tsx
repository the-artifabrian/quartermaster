import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link, Outlet, useMatches } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { type Route } from './+types/_layout.tsx'

export type SettingsPageHandle = { pageTitle: string }

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
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
			{pageTitle ? (
				<div className="mb-6 flex items-center gap-3">
					<Link
						to="/settings/profile"
						className="text-muted-foreground hover:text-foreground -ml-1 flex items-center gap-1"
					>
						<Icon name="arrow-left" size="md" />
						<span className="text-sm">Settings</span>
					</Link>
				</div>
			) : null}
			<h1 className="mb-6 text-2xl font-bold">
				{pageTitle ?? 'Settings'}
			</h1>
			<Outlet />
		</div>
	)
}
