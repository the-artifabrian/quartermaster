import { isRouteErrorResponse, Link } from 'react-router'
import { OfflineErrorBoundary } from './offline-error-boundary.tsx'
import { Icon } from './ui/icon.tsx'

type Kind = 'Recipe' | 'Menu'

const BACK: Record<Kind, { to: string; label: string }> = {
	Recipe: { to: '/recipes', label: 'Back to Recipes' },
	Menu: { to: '/recipes/menus', label: 'Back to Menus' },
}

/**
 * What a link to a Recipe or Menu that isn't in the user's Household shows.
 * A deleted one and one from another Household read the same, so the page
 * says nothing about whether the id exists.
 */
function NotInHousehold({ kind }: { kind: Kind }) {
	const back = BACK[kind]
	return (
		<div className="container flex flex-col items-center gap-6 px-6 py-20 text-center">
			<div className="flex max-w-sm flex-col gap-3">
				<h1 className="font-serif text-2xl">{kind} not found</h1>
				<p className="text-muted-foreground">
					This {kind} isn’t in your Household. It may have been deleted, or the
					link is from another Household.
				</p>
			</div>
			<Link to={back.to} className="text-primary underline underline-offset-4">
				<Icon name="arrow-left">{back.label}</Icon>
			</Link>
		</div>
	)
}

/**
 * The boundary for a Recipe or Menu route: a 404, or the 403 for one in
 * another Household, says the thing isn't in this Household, inside the app with its tabs. Offline pages and other errors
 * work as they do for the rest of the tab.
 */
export function NotInHouseholdBoundary({ kind }: { kind: Kind }) {
	return <OfflineErrorBoundary notFound={<NotInHousehold kind={kind} />} />
}

/** The page title when the route's loader found no such Recipe or Menu here. */
export function notFoundTitle(error: unknown, kind: Kind) {
	return isRouteErrorResponse(error) &&
		(error.status === 404 || error.status === 403)
		? `${kind} not found | Quartermaster`
		: null
}
