import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { OfflineErrorBoundary } from './offline-error-boundary.tsx'
import { Icon } from './ui/icon.tsx'

type Kind = 'Recipe' | 'Menu'

const BACK: Record<Kind, { to: string; label: string }> = {
	Recipe: { to: '/recipes', label: 'Back to Recipes' },
	Menu: { to: '/recipes/menus', label: 'Back to Menus' },
}

// What the route's own loader throws when the Recipe or Menu is missing (404)
// or in another Household (403). Any other 403 or 404, such as one from an
// action on a page that is still there, goes to the usual boundary.
const OWN_ERRORS: Record<Kind, string[]> = {
	Recipe: ['Recipe not found', 'Not authorized'],
	Menu: ['Menu not found', 'Not authorized'],
}

function isNotInHousehold(error: unknown, kind: Kind) {
	return (
		isRouteErrorResponse(error) &&
		(error.status === 404 || error.status === 403) &&
		OWN_ERRORS[kind].includes(String(error.data))
	)
}

/**
 * What a link to a Recipe or Menu that isn't in the user's Household shows.
 * A deleted one and one from another Household show the same page.
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
 * The boundary for a Recipe or Menu route. When the route's loader found no
 * such Recipe or Menu in this Household, it says so inside the app, with its
 * tabs. Offline pages and other errors work as they do for the rest of the
 * tab.
 */
export function NotInHouseholdBoundary({ kind }: { kind: Kind }) {
	const error = useRouteError()
	return (
		<OfflineErrorBoundary
			notFound={
				isNotInHousehold(error, kind) ? (
					<NotInHousehold kind={kind} />
				) : undefined
			}
		/>
	)
}

/** The page title when the route's loader found no such Recipe or Menu here. */
export function notFoundTitle(error: unknown, kind: Kind) {
	return isNotInHousehold(error, kind)
		? `${kind} not found | Quartermaster`
		: null
}
