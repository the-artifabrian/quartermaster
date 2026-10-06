import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Outlet } from 'react-router'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { willServeFromCache } from '#app/utils/loader-cache.ts'
import { type Route } from './+types/_layout.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithHousehold(request)
	return {}
}

/**
 * When the child page comes from the loader cache, skip the guard's round trip
 * so the navigation is instant. The child's revalidation right behind it runs
 * this loader on the server.
 */
export async function clientLoader({
	request,
	serverLoader,
}: Route.ClientLoaderArgs) {
	if (willServeFromCache(request)) return {}
	return serverLoader()
}
clientLoader.hydrate = false as const

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
