import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Outlet } from 'react-router'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/_layout.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithHousehold(request)
	return {}
}

/**
 * This loader is purely an auth guard — it returns nothing.
 * Skip revalidation on navigation (child loaders handle their own auth),
 * but respect explicit revalidation requests (useRevalidator).
 */
export function shouldRevalidate({
	defaultShouldRevalidate,
	formAction,
	currentUrl,
	nextUrl,
}: {
	defaultShouldRevalidate: boolean
	formAction?: string
	currentUrl: URL
	nextUrl: URL
}) {
	if (formAction) return defaultShouldRevalidate
	if (
		currentUrl.pathname === nextUrl.pathname &&
		currentUrl.search === nextUrl.search
	) {
		return defaultShouldRevalidate
	}
	return false
}

export default function RecipesLayout() {
	return (
		<div className="flex min-h-[calc(100vh-6rem)] flex-col">
			<Outlet />
		</div>
	)
}
